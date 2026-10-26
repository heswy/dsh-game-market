/**
 * V1.5 M0 S-Q1/S-Q2 probe — Host half.
 *
 * This is a *probe bundle*, not product code. It exists to prove, against the
 * DSH build the user actually has installed, what a third-party plugin can and
 * cannot do with the native `ctx.userQuestions` / `uiSession.sessionStatus`
 * question surface.
 *
 * Two jobs:
 *   1. Register a scripted, local LLM adapter (`provider: "qprobe"`) so a real
 *      Agent loop can run a real turn and call the **native**
 *      `ask_user_question` tool without any model credential or network. The
 *      question therefore travels the same code path a real model tool call
 *      travels (dsh-tool-ask-user -> ctx.userQuestions -> scoped waterfall ->
 *      Remote Event -> native Client UI). This is NOT a model question and the
 *      evidence report labels it "scripted local model, not a real DeepSeek
 *      model call".
 *   2. Expose a tiny file-based command bus under `<config.dir>` so the probe
 *      runner can inspect Host-side state (Session events, projections, live
 *      agents) and exercise `askTimed` / `attachWait` ownership/deadline
 *      semantics directly. No HTTP route is added, so the probe never widens
 *      the Host's network surface.
 *
 * No project code is imported and no third-party dependency is required.
 */
import fs from 'node:fs';
import path from 'node:path';

const LOG = '[qprobe/host]';
const ASK_TOOL = 'ask_user_question';
const PROVIDER = 'qprobe';
const MODEL = 'qprobe-script';

/** Services this probe needs before it can act. */
export const inject = ['llm'];

/** Build one question batch for the scripted model's native tool call. */
function questionArgs(scenario) {
  const mode = typeof scenario?.mode === 'string' ? scenario.mode : 'text';
  if (mode === 'multi') {
    return {
      timeout: -1,
      questions: [
        {
          id: 'probe-q1',
          header: 'Probe multi',
          question: 'QPROBE_MULTI_SELECT',
          multi_select: true,
          options: [{ label: 'QPROBE_OPT_A' }, { label: 'QPROBE_OPT_B' }],
        },
        {
          id: 'probe-q2',
          header: 'Probe text',
          question: 'QPROBE_FREE_TEXT',
        },
      ],
    };
  }
  const timeout = mode === 'timed' ? Number(scenario?.timeoutSeconds ?? 6) : -1;
  return {
    timeout,
    questions: [
      {
        id: 'probe-q1',
        header: 'Probe question',
        question: scenario?.question ?? 'QPROBE_OPEN_QUESTION',
        options: [{ label: 'QPROBE_OPT_A' }, { label: 'QPROBE_OPT_B' }],
      },
    ],
  };
}

/** Whether one request carries the native ask_user_question tool schema. */
function hasAskTool(tools) {
  return Array.isArray(tools) && tools.some((tool) => tool && tool.name === ASK_TOOL);
}

/** Count ask_user_question tool calls already in the conversation history. */
function askCallCount(messages) {
  let count = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block && block.type === 'tool-call' && block.name === ASK_TOOL) count += 1;
    }
  }
  return count;
}

/** Yield a plain assistant text turn that ends the model step. */
function* textStream(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

/** Yield one native ask_user_question tool call and stop the model step. */
function* toolCallStream(argumentsObject, callId) {
  const json = JSON.stringify(argumentsObject);
  yield { type: 'block-start', index: 0, blockType: 'tool-call' };
  yield { type: 'tool-call-delta', index: 0, id: callId, name: ASK_TOOL, argumentsDelta: json };
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: ASK_TOOL, arguments: json } };
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: json.length } };
  yield { type: 'finish', reason: { kind: 'tool-calls' } };
}

/** Keep only the durable, assertable shape of a Session event. */
function trimEvent(event) {
  const out = { seq: event.seq, type: event.type };
  const data = event.data ?? {};
  switch (event.type) {
    case 'turn/start':
    case 'turn/end':
      out.turn = data.turn;
      if (data.cause !== undefined) out.cause = data.cause;
      break;
    case 'step/start':
    case 'step/end':
      out.step = data.step;
      if (data.turn !== undefined) out.turn = data.turn;
      break;
    case 'tool/call':
      out.callId = data.callId;
      out.name = data.name;
      try {
        const parsed = JSON.parse(data.arguments);
        out.arguments = {
          timeout: parsed.timeout,
          questions: (parsed.questions ?? []).map((question) => ({
            id: question.id,
            multiSelect: question.multi_select === true,
            optionLabels: (question.options ?? []).map((option) => option.label),
          })),
        };
      } catch {
        out.arguments = { unparsed: true };
      }
      break;
    case 'tool/result': {
      out.callId = data.message?.toolCallId;
      out.isError = data.message?.isError === true;
      out.errorCode = data.error?.code ?? null;
      const text = (data.message?.content ?? []).find((block) => block.type === 'text');
      if (text !== undefined) {
        try {
          const parsed = JSON.parse(text.text);
          out.result = {
            pending: parsed.pending === true,
            callId: parsed.callId ?? null,
            answers: Array.isArray(parsed.answers)
              ? parsed.answers.map((answer) => ({
                  id: answer.id,
                  selected: answer.selected,
                  custom: answer.custom ?? null,
                }))
              : null,
          };
        } catch {
          out.result = { unparsed: true };
        }
      }
      break;
    }
    case 'user/message': {
      out.source = data.source;
      const text = (data.content ?? []).find((block) => block.type === 'text');
      if (text !== undefined) {
        try {
          const parsed = JSON.parse(text.text);
          out.reply = {
            kind: parsed.kind ?? null,
            tool: parsed.tool ?? null,
            callId: parsed.callId ?? null,
            answers: Array.isArray(parsed.answers)
              ? parsed.answers.map((answer) => ({
                  id: answer.id,
                  selected: answer.selected,
                  custom: answer.custom ?? null,
                }))
              : null,
          };
        } catch {
          out.reply = { unparsed: true };
        }
      }
      break;
    }
    case 'request/header':
      out.config = data.header?.config ?? null;
      break;
    default:
      break;
  }
  return out;
}

/** Short random suffix for probe-owned session identities. */
function randomSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Write one JSON file atomically (rename), so readers never see a partial file. */
function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

/**
 * Probe plugin body.
 * @param ctx - Host Cordis context.
 * @param config - `{ dir }`: absolute scratch directory owned by the probe runner.
 */
export function apply(ctx, config = {}) {
  const dir = config.dir;
  if (typeof dir !== 'string' || dir === '') throw new Error('qprobe: config.dir is required');
  const commandsDir = path.join(dir, 'commands');
  const resultsDir = path.join(dir, 'results');
  const processedDir = path.join(dir, 'processed');
  for (const folder of [dir, commandsDir, resultsDir, processedDir]) fs.mkdirSync(folder, { recursive: true });
  const logger = ctx.logger ?? console;
  const scenarioFile = path.join(dir, 'scenario.json');
  const state = {
    startedAt: new Date().toISOString(),
    adapterRegistered: false,
    timedPresetRegistered: false,
    timedPresetError: null,
    adapterCalls: [],
    commands: 0,
    errors: [],
    askSequence: 0,
  };

  const readScenario = () => {
    try {
      return JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
    } catch {
      return { mode: 'text' };
    }
  };

  const scriptedAdapter = {
    providerInfo(provider) {
      return { id: provider, name: 'QProbe scripted local model' };
    },
    providerRetryPolicy() {
      return undefined;
    },
    listModels(provider) {
      return Promise.resolve([{ id: MODEL, name: 'QProbe scripted', provider }]);
    },
    resolveModel(provider, model) {
      return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 128000 } });
    },
    /** The llm runtime requires an adapter-generation binding entry point. */
    async prepareCall(provider, model) {
      return {
        model: await scriptedAdapter.resolveModel(provider, model),
        stream: (options) => scriptedAdapter.stream(options),
      };
    },
    async *stream(options) {
      const call = {
        at: new Date().toISOString(),
        provider: options.provider,
        model: options.model,
        messageCount: Array.isArray(options.messages) ? options.messages.length : 0,
        hasAskTool: hasAskTool(options.tools),
        askCallsInHistory: askCallCount(options.messages),
        emitted: null,
      };
      state.adapterCalls.push(call);
      if (state.adapterCalls.length > 40) state.adapterCalls.splice(0, state.adapterCalls.length - 40);
      if (options.signal?.aborted) {
        call.emitted = 'aborted';
        return;
      }
      if (!call.hasAskTool) {
        // Title generation / any non-agent-loop call: plain text, no tool call.
        call.emitted = 'plain-text';
        yield* textStream('QPROBE_TITLE');
        return;
      }
      const scenario = readScenario();
      if(scenario.mode === 'model-error') throw new Error('QPROBE_SYNTHETIC_MODEL_ERROR');
      if(call.askCallsInHistory === 0 && scenario.delayMs) await new Promise(resolve=>setTimeout(resolve,Math.min(3000,Number(scenario.delayMs)||0)));
      if (call.askCallsInHistory > 0) {
        // The native ask_user_question tool already ran in this turn/thread.
        call.emitted = 'final-text';
        yield* textStream('QPROBE_TURN_DONE');
        return;
      }
      state.askSequence += 1;
      const callId = `qprobe_call_${state.askSequence}_${Date.now().toString(36)}`;
      call.emitted = 'ask-tool-call';
      call.scenarioMode = scenario.mode ?? 'text';
      call.callId = callId;
      if ((scenario.mode ?? 'text') === 'text') {
        yield* textStream('QPROBE_NO_QUESTION');
        return;
      }
      yield* toolCallStream(questionArgs(scenario), callId);
    },
  };

  ctx.effect(() => {
    const handle = ctx.llm.registerAdapter([PROVIDER], scriptedAdapter);
    state.adapterRegistered = true;
    logger.info?.(LOG, 'scripted LLM adapter registered', `provider=${PROVIDER}`, `model=${MODEL}`);
    return () => {
      state.adapterRegistered = false;
      handle?.();
    };
  }, 'qprobe: scripted LLM adapter');

  // A probe-only Agent preset that composes the native ask_user_question tool
  // in its *timed* mode. The shipped `standard` preset composes the legacy
  // blocking tool, so this preset is what lets a real Session exercise the
  // timed -> continued question path without touching the profile's presets.
  const TIMED_PRESET = {
    id: 'qprobe-timed',
    name: 'QProbe timed questions',
    description: 'Probe-only composition: native timed ask_user_question, no other capability.',
    order: 99,
    plugins: [
      {
        id: 'qprobe-persona',
        name: '@deepseek-ai/dsh-persona',
        config: { prefix: 'You are a deterministic probe model.' },
      },
      {
        id: 'qprobe-tool-ask-user',
        name: '@deepseek-ai/dsh-tool-ask-user',
        config: { mode: 'timed', timeout: 120 },
      },
    ],
  };
  let presetUnregister = null;
  let presetAttempted = false;
  const tryRegisterTimedPreset = () => {
    if (presetAttempted || state.timedPresetRegistered) return;
    const registry = ctx.get('agentPresets');
    if (registry === undefined || typeof registry.register !== 'function') return;
    presetAttempted = true;
    Promise.resolve(registry.register(TIMED_PRESET)).then(
      (unregister) => {
        presetUnregister = unregister;
        state.timedPresetRegistered = true;
        logger.info?.(LOG, 'probe timed preset registered', `id=${TIMED_PRESET.id}`);
      },
      (error) => {
        state.timedPresetError = String(error?.message ?? error);
        logger.warn?.(LOG, 'probe timed preset registration failed', state.timedPresetError);
      },
    );
  };
  ctx.effect(() => () => {
    try {
      presetUnregister?.();
    } catch {
      /* probe teardown */
    }
  }, 'qprobe: timed preset teardown');

  // --- Host-side helpers ---------------------------------------------------

  const rootAgents = () => {
    const agents = ctx.get('agents');
    return agents === undefined ? [] : agents.roots();
  };
  const findAgent = (agentId) => {
    const agents = ctx.get('agents');
    if (agents === undefined) return undefined;
    if (agentId === undefined) return agents.roots()[0];
    return agents.get(agentId);
  };
  const sessionEvents = (sessionId) => {
    const sessions = ctx.get('sessions');
    const session = sessions === undefined ? undefined : sessions.get(sessionId);
    if (session === undefined) throw new Error(`qprobe: no live session ${sessionId}`);
    return session.snapshotEvents().map(trimEvent);
  };
  const projectionState = (sessionId) => {
    const sessions = ctx.get('sessions');
    const projections = ctx.get('sessionProjections');
    const session = sessions === undefined ? undefined : sessions.get(sessionId);
    if (session === undefined) throw new Error(`qprobe: no live session ${sessionId}`);
    const view = projections === undefined
      ? undefined
      : projections.stateOf(session, 'userQuestions');
    const questions = view?.questions ?? { active: [], settled: [] };
    return {
      active: (questions.active ?? []).map((row) => ({
        callId: row.callId,
        state: row.state,
        questionIds: (row.questions ?? []).map((question) => question.id),
      })),
      settled: (questions.settled ?? []).map((row) => ({
        callId: row.callId,
        answerIds: (row.answers ?? []).map((answer) => answer.id),
        answerCount: (row.answers ?? []).length,
      })),
    };
  };
  const waitAgentIdle = async (agentId, timeoutMs) => {
    const started = Date.now();
    const agents = ctx.get('agents');
    while (Date.now() - started < timeoutMs) {
      const agent = agentId === undefined ? agents?.roots()[0] : agents?.get(agentId);
      if (agent !== undefined && agent.status === 'idle') return { idle: true, waitedMs: Date.now() - started, agentId: agent.id };
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const agent = agentId === undefined ? agents?.roots()[0] : agents?.get(agentId);
    return { idle: false, waitedMs: Date.now() - started, agentId: agent?.id, status: agent?.status };
  };

  const handlers = {
    async status() {
      const agents = ctx.get('agents');
      const sessions = ctx.get('sessions');
      return {
        probe: {
          startedAt: state.startedAt,
          adapterRegistered: state.adapterRegistered,
          timedPresetRegistered: state.timedPresetRegistered,
          timedPresetError: state.timedPresetError,
        },
        provider: { name: PROVIDER, model: MODEL },
        services: ['agents', 'sessions', 'userQuestions', 'sessionProjections', 'llm']
          .filter((name) => ctx.get(name) !== undefined),
        agents: (agents === undefined ? [] : agents.list()).map((agent) => ({
          id: agent.id,
          status: agent.status,
          root: agents.roots().includes(agent),
          sessionId: agent.session?.id,
        })),
        sessions: (sessions === undefined ? [] : sessions.list()).map((session) => ({
          id: session.id,
          events: session.snapshotEvents().length,
        })),
        adapter: {
          calls: state.adapterCalls.length,
          recent: state.adapterCalls.slice(-10),
        },
        scenario: readScenario(),
      };
    },
    async 'preset-status'() {
      const registry = ctx.get('agentPresets');
      let list = null;
      if (registry !== undefined && typeof registry.list === 'function') {
        try {
          list = (await registry.list()).map((row) => ({ id: row.id, broken: row.broken ?? null }));
        } catch (error) {
          list = { error: String(error?.message ?? error) };
        }
      }
      return {
        registryAvailable: registry !== undefined,
        timedPresetRegistered: state.timedPresetRegistered,
        timedPresetError: state.timedPresetError,
        presetAttempted,
        list,
      };
    },
    async 'set-scenario'(command) {
      const scenario = command.scenario ?? { mode: 'text' };
      writeJsonAtomic(scenarioFile, scenario);
      return { scenario };
    },
    async events(command) {
      return { sessionId: command.sessionId, events: sessionEvents(command.sessionId) };
    },
    async projection(command) {
      return { sessionId: command.sessionId, projection: projectionState(command.sessionId) };
    },
    async sessions() {
      const sessions = ctx.get('sessions');
      return {
        sessions: (sessions === undefined ? [] : sessions.list()).map((session) => ({
          id: session.id,
          events: session.snapshotEvents().length,
        })),
      };
    },
    async 'wait-idle'(command) {
      return waitAgentIdle(command.agentId, Number(command.timeoutMs ?? 30000));
    },
    /** Create one live root Agent without any browser: used for Host-only lifecycle probes. */
    async 'create-agent'(command) {
      const agents = ctx.get('agents');
      if (agents === undefined) throw new Error('qprobe: agents service is unavailable');
      const sessionId = command.sessionId ?? `qprobe-direct-${randomSuffix()}`;
      const cwd = command.cwd ?? path.join(dir, 'direct-cwd');
      fs.mkdirSync(cwd, { recursive: true });
      const handle = await agents.create({
        sessionId,
        agentOptions: { provider: PROVIDER, model: MODEL },
        meta: { cwd },
      });
      return { agentId: handle.agent.id, sessionId: handle.agent.session.id, provider: PROVIDER, model: MODEL };
    },
    async 'ask-timed-direct'(command) {
      const service = ctx.get('userQuestions');
      if (service === undefined) throw new Error('qprobe: userQuestions service is unavailable');
      const agent = findAgent(command.agentId);
      if (agent === undefined) throw new Error('qprobe: no live root agent');
      const timeoutMs = Number(command.timeoutMs ?? 1000);
      const callId = command.callId ?? `qprobe_direct_${Date.now().toString(36)}`;
      const controller = new AbortController();
      const startedAt = Date.now();
      const request = {
        agent,
        signal: controller.signal,
        questions: [
          {
            id: 'probe-direct',
            header: 'Probe direct',
            question: 'QPROBE_DIRECT_QUESTION',
            options: [{ label: 'QPROBE_OPT_A' }],
          },
        ],
      };
      const result = await service.askTimed(request, callId, timeoutMs);
      return {
        callId,
        agentId: agent.id,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        pending: result.pending === true,
        answers: Array.isArray(result.answers) ? result.answers : null,
      };
    },
    async 'attach-wait'(command) {
      const service = ctx.get('userQuestions');
      if (service === undefined) throw new Error('qprobe: userQuestions service is unavailable');
      const agent = findAgent(command.agentId);
      if (agent === undefined) throw new Error('qprobe: no live root agent');
      const callId = command.callId;
      const holdMs = Number(command.holdMs ?? 1000);
      const controller = new AbortController();
      const iterator = service.attachWait(agent, callId, controller.signal)[Symbol.asyncIterator]();
      const startedAt = Date.now();
      const first = await iterator.next();
      const frames = [];
      if (first.done === true) return { attached: false, frames, attachedMs: Date.now() - startedAt };
      frames.push({ atMs: Date.now() - startedAt, remainingMs: first.value?.remainingMs });
      setTimeout(() => controller.abort(new Error('qprobe: claim hold ended')), holdMs);
      // Resolve after the claim's stream ends (abort from our controller).
      let ended = false;
      while (true) {
        const next = await iterator.next();
        if (next.done === true) {
          ended = true;
          break;
        }
        frames.push({ atMs: Date.now() - startedAt, remainingMs: next.value?.remainingMs });
      }
      return { attached: true, frames, attachedMs: Date.now() - startedAt, endedAtMs: Date.now() - startedAt, ended };
    },
  };

  // --- File command bus ----------------------------------------------------

  let busy = false;
  const runHandler = async (name, command) => {
    const handler = handlers[command.cmd];
    if (typeof handler !== 'function') throw new Error(`qprobe: unknown command ${String(command.cmd)}`);
    const startedAt = new Date().toISOString();
    try {
      const result = await handler(command);
      writeJsonAtomic(path.join(resultsDir, name), {
        ok: true,
        cmd: command.cmd,
        startedAt,
        finishedAt: new Date().toISOString(),
        result,
      });
    } catch (error) {
      state.errors.push({ at: new Date().toISOString(), cmd: command.cmd, message: String(error?.message ?? error) });
      writeJsonAtomic(path.join(resultsDir, name), {
        ok: false,
        cmd: command.cmd,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: { message: String(error?.message ?? error), code: error?.code ?? null },
      });
    }
  };
  const poll = () => {
    if (busy) return;
    let names;
    try {
      names = fs.readdirSync(commandsDir).filter((name) => name.endsWith('.json')).sort();
    } catch {
      return;
    }
    if (names.length === 0) return;
    busy = true;
    const name = names[0];
    const file = path.join(commandsDir, name);
    let command;
    try {
      command = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      state.errors.push({ at: new Date().toISOString(), message: `unreadable command ${name}: ${error?.message ?? error}` });
      busy = false;
      fs.renameSync(file, path.join(processedDir, name));
      return;
    }
    state.commands += 1;
    fs.renameSync(file, path.join(processedDir, name));
    if (command.async === true) {
      // Fire-and-forget: report "started" immediately, overwrite the result file
      // when the long-running command settles.
      writeJsonAtomic(path.join(resultsDir, name), {
        ok: true,
        cmd: command.cmd,
        started: true,
        startedAt: new Date().toISOString(),
      });
      busy = false;
      void runHandler(name, command);
      return;
    }
    void runHandler(name, command).finally(() => {
      busy = false;
    });
  };
  const timer = setInterval(poll, 150);
  if (typeof timer.unref === 'function') timer.unref();

  const heartbeat = () => {
    try {
      tryRegisterTimedPreset();
      const agents = ctx.get('agents');
      const sessions = ctx.get('sessions');
      writeJsonAtomic(path.join(dir, 'host-state.json'), {
        updatedAt: new Date().toISOString(),
        probe: {
          startedAt: state.startedAt,
          adapterRegistered: state.adapterRegistered,
          timedPresetRegistered: state.timedPresetRegistered,
          timedPresetError: state.timedPresetError,
          commands: state.commands,
        },
        scenario: readScenario(),
        agents: (agents === undefined ? [] : agents.list()).map((agent) => ({
          id: agent.id,
          status: agent.status,
          root: agents.roots().includes(agent),
        })),
        sessions: (sessions === undefined ? [] : sessions.list()).map((session) => ({ id: session.id, events: session.snapshotEvents().length })),
        adapterCalls: state.adapterCalls.slice(-10),
        errors: state.errors.slice(-10),
      });
    } catch (error) {
      logger.warn?.(LOG, 'heartbeat-failed', String(error?.message ?? error));
    }
  };
  const heartbeatTimer = setInterval(heartbeat, 400);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  heartbeat();

  ctx.effect(() => () => {
    clearInterval(timer);
    clearInterval(heartbeatTimer);
  }, 'qprobe: command bus timers');

  logger.info?.(LOG, 'probe host ready', `dir=${dir}`, `provider=${PROVIDER}`);
}
