/**
 * M0 reconnaissance probe: capability census of an isolated DSH profile.
 *
 * Answers "what can the running Host actually see" for the services the V1.5
 * update adapter depends on. Read-only: it performs no install, no removal and
 * no profile write.
 *
 * Capability detection is SAMPLED over time on purpose. `hmr` is a Cordis
 * Service whose registration happens in an async `Service.init`; a single
 * early `ctx.get('hmr')` reported "absent" on a profile where the row is
 * active, so a boolean read once at plugin load is not trustworthy.
 *
 * The sample that decides plugin-update behaviour is `managerContext.hmr`,
 * because `installBundle` reads `hmr` from the manager's OWN context.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const inject = ['pluginManager'];

const SAMPLE_DELAYS_MS = [0, 2000, 4000, 8000, 15000];

function snapshot(ctx, manager) {
  const owner = manager?.ownerContext;
  const loader = ctx.get('loader');
  let hmrEntry = null;
  try {
    hmrEntry = [...loader.entries()].find((e) => e.options?.id === 'hmr') ?? null;
  } catch { /* loader may not enumerate yet */ }
  return {
    at: new Date().toISOString(),
    probeScope: {
      hmr: ctx.get('hmr') !== undefined,
      connection: ctx.get('connection') !== undefined,
      userQuestions: ctx.get('userQuestions') !== undefined,
      sessions: ctx.get('sessions') !== undefined,
    },
    managerContext: owner === undefined ? null : {
      hmr: owner.get('hmr') !== undefined,
      hmrCtor: owner.get('hmr')?.constructor?.name ?? null,
      profileContext: owner.get('profileContext') !== undefined,
      pluginPackages: owner.get('pluginPackages') !== undefined,
      loaderInternal: owner.get('loader')?.internal !== undefined,
    },
    hmrRow: hmrEntry === null ? null : {
      disabledOption: hmrEntry.options?.disabled ?? null,
      hasFiber: hmrEntry.fiber !== undefined,
      fiberState: hmrEntry.fiber?.state ?? null,
      fiberError: hmrEntry.fiber?.error === undefined
        ? null
        : String(hmrEntry.fiber.error?.message ?? hmrEntry.fiber.error),
    },
  };
}

export async function apply(ctx, config) {
  const out = config?.out;
  const report = {
    profile: config?.profile ?? null,
    dshVersion: null,
    execArgv: process.execArgv,
    samples: [],
    error: null,
  };
  try {
    const manager = ctx.get('pluginManager');
    report.dshVersion = manager?.profileContext === undefined
      ? null
      : (ctx.get('profileContext')?.dshVersion ?? null);
    for (const delay of SAMPLE_DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay - SAMPLE_DELAYS_MS[SAMPLE_DELAYS_MS.indexOf(delay) - 1]));
      report.samples.push(snapshot(ctx, manager));
    }
    if (manager !== undefined) {
      const bundles = await manager.listBundles();
      report.bundles = bundles.map((b) => ({
        name: b.name,
        version: b.version ?? null,
        enabled: b.enabled,
        installed: b.installed,
        removable: b.removable,
      }));
      report.managerMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(manager))
        .filter((k) => k !== 'constructor')
        .sort();
    }
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
  } catch (error) {
    report.error = String(error && error.message ? error.message : error);
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
  }
  ctx.logger?.info?.('[v15-capability-probe] samples=%d', report.samples.length);
}
