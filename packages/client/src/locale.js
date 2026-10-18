/**
 * Client dictionaries for the `dshGameMarket` locale namespace.
 *
 * Only this module may contain user-facing copy. Components call `t(key, params)`
 * from the slot kit (or `makeT` as a fallback) and never inline strings.
 */

export const NS = 'dshGameMarket';

export const ZH = Object.freeze({
  'sidebar.label': 'Game Market',
  'panel.title': 'Game Market',
  'panel.backToConversation': '返回会话',
  'panel.tab.market': '市场',
  'panel.tab.mygames': '我的游戏',
  'panel.loading': '正在加载游戏列表',
  'panel.retry': '重试',
  'panel.synced': '更新于 {relativeTime}',

  'common.cancel': '取消',
  'common.close': '关闭',
  'common.retry': '重试',
  'common.back': '返回',

  'market.section.all': '全部游戏',
  'market.loading': '正在加载游戏列表…',
  'market.error.title': '游戏列表加载失败',
  'market.error.retry': '重试',
  'market.empty.all': '暂时没有可显示的游戏',
  'market.card.installed': '已安装',
  'market.card.continue': '继续',
  'market.card.play': '开始游戏',
  'market.card.best': '最高 {score}',
  'market.card.noBest': '暂无最高分',
  'market.card.lastPlayed': '上次游玩 {relativeTime}',
  'market.card.neverPlayed': '还没玩过',
  'market.card.authorMeta': '{author} · {category}',
  'market.card.continueAvailable': '可继续',
  'market.source.builtin': '内置',
  'market.waiting.banner': 'Agent 需要你处理一下',
  'market.waiting.action': '去处理',
  'market.refreshed': '更新于 {relativeTime}',

  'mygames.title': '我的游戏',
  'mygames.loading': '正在加载游戏库…',
  'mygames.error.load': '游戏库加载失败',
  'mygames.empty.title': '我的游戏还是空的',
  'mygames.empty.action': '去市场看看',
  'mygames.row.best': '最高 {score}',
  'mygames.row.lastPlayed': '{relativeTime}玩过',
  'mygames.row.neverPlayed': '还没玩过',
  'mygames.action.continue': '继续',
  'mygames.action.play': '开始',

  'entry.chip.running.resume': 'Agent 正在工作 · 继续上一局',
  'entry.chip.running.choose': 'Agent 正在工作 · 选择一个游戏',
  'entry.chip.resume': '继续游戏',
  'entry.chip.waiting': '需要你处理',
  'entry.chip.a11y.running': 'Agent 正在工作。按下打开游戏菜单',
  'entry.chip.a11y.waiting': 'Agent 需要你处理。按下回到会话',
  'entry.chip.a11y.resume': '存在暂停的游戏。按下继续游戏',
  'entry.menu.a11y': 'Game Market 菜单',
  'entry.menu.resume': '继续上一局',
  'entry.menu.resume.meta': '《{gameName}》 · 上次 {relativeTime}',
  'entry.menu.choose': '选择一个游戏',
  'entry.menu.dismiss': '暂时忽略',
  'entry.toast.dismissed': '本次不再提醒',
  'entry.waiting.title': 'Agent 在等你',
  'entry.waiting.approval': '需要你确认一项操作',
  'entry.waiting.question': '需要你回答一个问题',
  'entry.waiting.generic': 'Agent 在等你',
  'entry.waiting.action': '回到会话处理',
  'entry.waiting.later': '稍后处理',
  'entry.sidebar.running': 'Game Market，Agent 正在工作',
  'entry.sidebar.waiting': 'Game Market，需要你处理',
  'entry.sidebar.completed': 'Game Market，有未查看的结果',
  'entry.sidebar.resume': 'Game Market，有暂停的游戏',
  'entry.sidebar.error': 'Game Market，Agent 遇到问题',

  'agent.state.running': '正在工作…',
  'agent.state.idle': 'Agent 空闲',
  'agent.state.test': '正在运行测试…',
  'agent.state.build': '正在构建…',
  'agent.state.search': '正在查找资料…',
  'agent.state.read': '正在查看文件…',
  'agent.state.write': '正在修改文件…',
  'agent.state.command': '正在执行命令…',
  'agent.state.saving': '正在保存本局…',
  'agent.state.waiting.approval': '需要你确认一项操作',
  'agent.state.waiting.question': '需要你回答一个问题',
  'agent.state.waiting.generic': 'Agent 在等你',
  'agent.state.completed': '任务完成啦',
  'agent.state.error': '遇到了一点问题',
  'agent.action.results': '查看结果',
  'agent.action.view': '查看',
  'agent.action.answer': '去处理',
  'agent.action.returnWork': '返回工作',
  'agent.pill.waiting': '需要你',
  'agent.pill.completed': '任务完成',
  'agent.pill.error': '有问题',
  'agent.a11y.whale': 'Agent 状态：{state}。按下{action}',
  'agent.a11y.bubble': 'Agent 状态提示',
  'agent.a11y.saveBusy': '正在保存本局…',

  'runtime.stage.a11y': '游戏区域',
  'runtime.loading': '正在加载《{gameName}》',
  'runtime.loading.slow': '加载时间有点久',
  'runtime.loading.wait': '继续等待',
  'runtime.loading.back': '返回市场',
  'runtime.action.back': '返回市场',
  'runtime.action.save': '手动保存',
  'runtime.action.pause': '暂停菜单',
  'runtime.action.resume': '继续游戏',
  'runtime.save.saved': '已保存',
  'runtime.save.saving': '保存中…',
  'runtime.save.failed': '保存失败',
  'runtime.save.retry': '重试保存',
  'runtime.pause.title': '已暂停',
  'runtime.pause.resume': '继续',
  'runtime.pause.saveReturn': '保存并返回工作',
  'runtime.pause.exitMarket': '退出到市场',
  'runtime.pause.audioNote': '游戏内声音由游戏控制。',
  'runtime.leave.blocked.title': '暂时无法保存',
  'runtime.leave.blocked.body': '当前进度没有保存成功。现在离开可能丢失最近 30 秒的进度。',
  'runtime.leave.blocked.unresponsive': '游戏没有响应。现在离开可能丢失本局进度。',
  'runtime.leave.retry': '重试保存',
  'runtime.leave.stay': '留在游戏',
  'runtime.leave.force': '仍然离开',
  'runtime.resume.title': '已恢复上一局',
  'runtime.resume.body': '进度已经读回来了。准备好后再继续。',
  'runtime.resume.action': '继续游戏',
  'runtime.exited.title': '游戏已退出',
  'runtime.exited.body': '这一局已经结束，可以返回市场再开一局。',
  'runtime.exited.back': '返回市场',
  'runtime.error.package': '游戏文件缺失',
  'runtime.error.package.body': '重新安装后可以继续，存档会保留。',
  'runtime.error.incompatible': '此游戏需要更新版本的 Runtime',
  'runtime.error.loadTimeout': '游戏加载超时',
  'runtime.error.loadTimeout.body': '可以重新加载，最近的存档会恢复。',
  'runtime.error.crashed': '游戏意外停止',
  'runtime.error.crashed.body': '可以重新加载，最近的存档会恢复。',
  'runtime.error.saveCorrupt': '存档损坏，无法恢复',
  'runtime.error.saveCorrupt.body': '可以开始新的一局。',
  'runtime.error.noRuntime': '游戏运行时暂不可用',
  'runtime.error.noRuntime.body': '当前安装还没有包含 Game Runtime。可以返回市场，或稍后重试。',
  'runtime.error.generic': '出了点问题',
  'runtime.error.generic.body': '可以重试，或返回市场。',
  'runtime.error.newGame': '开始新游戏',
  'runtime.error.reload': '重新加载',
  'runtime.error.retry': '重试',
  'runtime.error.backMarket': '返回市场',
  'runtime.diagnostic': '问题编号 {code}',
  'runtime.diagnostic.copy': '复制问题编号',
  'runtime.diagnostic.copied': '已复制',
  'runtime.toast.resumed': '已恢复上一局',
  'runtime.toast.saveGap': '上次未能保存，已从更早的存档恢复',

  'a11y.live.waiting': 'Agent 需要你处理。按下按钮回到会话。',
  'a11y.live.completed': 'Agent 已完成任务。',
  'a11y.live.error': 'Agent 遇到问题。',
  'a11y.live.returned': '已返回会话。',
});

export const EN = Object.freeze({
  'sidebar.label': 'Game Market',
  'panel.title': 'Game Market',
  'panel.backToConversation': 'Back to conversation',
  'panel.tab.market': 'Market',
  'panel.tab.mygames': 'My Games',
  'panel.loading': 'Loading games',
  'panel.retry': 'Retry',
  'panel.synced': 'Updated {relativeTime}',

  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.retry': 'Retry',
  'common.back': 'Back',

  'market.section.all': 'All games',
  'market.loading': 'Loading games…',
  'market.error.title': 'Could not load games',
  'market.error.retry': 'Retry',
  'market.empty.all': 'No games to show yet',
  'market.card.installed': 'Installed',
  'market.card.continue': 'Continue',
  'market.card.play': 'Play',
  'market.card.best': 'Best {score}',
  'market.card.noBest': 'No best score yet',
  'market.card.lastPlayed': 'Played {relativeTime}',
  'market.card.neverPlayed': 'Not played yet',
  'market.card.authorMeta': '{author} · {category}',
  'market.card.continueAvailable': 'Continue available',
  'market.source.builtin': 'Built-in',
  'market.waiting.banner': 'The agent needs you',
  'market.waiting.action': 'Handle it',
  'market.refreshed': 'Updated {relativeTime}',

  'mygames.title': 'My Games',
  'mygames.loading': 'Loading your library…',
  'mygames.error.load': 'Could not load your library',
  'mygames.empty.title': 'Your library is empty',
  'mygames.empty.action': 'Browse the market',
  'mygames.row.best': 'Best {score}',
  'mygames.row.lastPlayed': 'Played {relativeTime}',
  'mygames.row.neverPlayed': 'Not played yet',
  'mygames.action.continue': 'Continue',
  'mygames.action.play': 'Play',

  'entry.chip.running.resume': 'Agent working · Resume last game',
  'entry.chip.running.choose': 'Agent working · Pick a game',
  'entry.chip.resume': 'Resume game',
  'entry.chip.waiting': 'Needs you',
  'entry.chip.a11y.running': 'Agent is working. Press to open the game menu.',
  'entry.chip.a11y.waiting': 'Agent needs you. Press to return to the conversation.',
  'entry.chip.a11y.resume': 'A game is paused. Press to resume.',
  'entry.menu.a11y': 'Game Market menu',
  'entry.menu.resume': 'Resume last game',
  'entry.menu.resume.meta': '{gameName} · Last played {relativeTime}',
  'entry.menu.choose': 'Choose a game',
  'entry.menu.dismiss': 'Not now',
  'entry.toast.dismissed': 'Hidden for this task',
  'entry.waiting.title': 'Agent is waiting for you',
  'entry.waiting.approval': 'Needs your approval',
  'entry.waiting.question': 'Has a question for you',
  'entry.waiting.generic': 'Agent is waiting for you',
  'entry.waiting.action': 'Go to conversation',
  'entry.waiting.later': 'Later',
  'entry.sidebar.running': 'Game Market, agent working',
  'entry.sidebar.waiting': 'Game Market, needs you',
  'entry.sidebar.completed': 'Game Market, unread result',
  'entry.sidebar.resume': 'Game Market, paused game',
  'entry.sidebar.error': 'Game Market, agent issue',

  'agent.state.running': 'Working…',
  'agent.state.idle': 'Agent idle',
  'agent.state.test': 'Running tests…',
  'agent.state.build': 'Building…',
  'agent.state.search': 'Searching the web…',
  'agent.state.read': 'Reading files…',
  'agent.state.write': 'Editing files…',
  'agent.state.command': 'Running a command…',
  'agent.state.saving': 'Saving your run…',
  'agent.state.waiting.approval': 'Needs your approval',
  'agent.state.waiting.question': 'Has a question for you',
  'agent.state.waiting.generic': 'Agent is waiting for you',
  'agent.state.completed': 'Task complete',
  'agent.state.error': 'Something went wrong',
  'agent.action.results': 'View result',
  'agent.action.view': 'View',
  'agent.action.answer': 'Handle it',
  'agent.action.returnWork': 'Back to work',
  'agent.pill.waiting': 'Needs you',
  'agent.pill.completed': 'Done',
  'agent.pill.error': 'Issue',
  'agent.a11y.whale': 'Agent status: {state}. Press to {action}.',
  'agent.a11y.bubble': 'Agent status message',
  'agent.a11y.saveBusy': 'Saving your run…',

  'runtime.stage.a11y': 'Game area',
  'runtime.loading': 'Loading {gameName}',
  'runtime.loading.slow': 'This is taking a while',
  'runtime.loading.wait': 'Keep waiting',
  'runtime.loading.back': 'Back to market',
  'runtime.action.back': 'Back to market',
  'runtime.action.save': 'Save now',
  'runtime.action.pause': 'Pause menu',
  'runtime.action.resume': 'Resume game',
  'runtime.save.saved': 'Saved',
  'runtime.save.saving': 'Saving…',
  'runtime.save.failed': 'Save failed',
  'runtime.save.retry': 'Retry save',
  'runtime.pause.title': 'Paused',
  'runtime.pause.resume': 'Resume',
  'runtime.pause.saveReturn': 'Save and return to work',
  'runtime.pause.exitMarket': 'Exit to market',
  'runtime.pause.audioNote': 'In-game audio is controlled by the game.',
  'runtime.leave.blocked.title': 'Can’t save right now',
  'runtime.leave.blocked.body': 'Your progress was not saved. Leaving now may lose the last 30 seconds.',
  'runtime.leave.blocked.unresponsive': 'The game is not responding. Leaving now may lose this run.',
  'runtime.leave.retry': 'Retry save',
  'runtime.leave.stay': 'Stay in game',
  'runtime.leave.force': 'Leave anyway',
  'runtime.resume.title': 'Resumed your last run',
  'runtime.resume.body': 'Your progress is back. Continue when you are ready.',
  'runtime.resume.action': 'Continue',
  'runtime.exited.title': 'Game exited',
  'runtime.exited.body': 'This run has ended. Go back to the market to start another.',
  'runtime.exited.back': 'Back to market',
  'runtime.error.package': 'Game files are missing',
  'runtime.error.package.body': 'Reinstall to continue. Your save is kept.',
  'runtime.error.incompatible': 'This game needs a newer Runtime',
  'runtime.error.loadTimeout': 'The game took too long to load',
  'runtime.error.loadTimeout.body': 'Reload to restore the latest save.',
  'runtime.error.crashed': 'The game stopped unexpectedly',
  'runtime.error.crashed.body': 'Reload to restore the latest save.',
  'runtime.error.saveCorrupt': 'Save data is corrupted',
  'runtime.error.saveCorrupt.body': 'You can start a new run.',
  'runtime.error.noRuntime': 'Game Runtime is not available',
  'runtime.error.noRuntime.body': 'This install does not include the Game Runtime yet. Go back to the market or try again later.',
  'runtime.error.generic': 'Something went wrong',
  'runtime.error.generic.body': 'Retry, or go back to the market.',
  'runtime.error.newGame': 'Start new game',
  'runtime.error.reload': 'Reload',
  'runtime.error.retry': 'Retry',
  'runtime.error.backMarket': 'Back to market',
  'runtime.diagnostic': 'Issue ID {code}',
  'runtime.diagnostic.copy': 'Copy issue ID',
  'runtime.diagnostic.copied': 'Copied',
  'runtime.toast.resumed': 'Resumed your last run',
  'runtime.toast.saveGap': 'Last save failed; restored an earlier save',

  'a11y.live.waiting': 'Agent needs you. Press the button to return to the conversation.',
  'a11y.live.completed': 'Agent finished the task.',
  'a11y.live.error': 'The agent ran into a problem.',
  'a11y.live.returned': 'Back in the conversation.',
});

export const LOCALES = Object.freeze({
  zh: ZH,
  en: EN,
});

/** Every dictionary key, sorted, useful for parity tests and diagnostics. */
export const LOCALE_KEYS = Object.freeze(Object.keys(ZH).sort());

/** Normalize a BCP-47-ish tag to a dictionary id. */
export function normalizeLocale(tag) {
  if (typeof tag !== 'string' || tag.length === 0) return 'zh';
  return tag.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
}

/** Browser language, falling back to the zh-first V0 default. */
export function detectLocale() {
  try {
    const nav = globalThis.navigator;
    if (nav && typeof nav.language === 'string' && nav.language.length > 0) return normalizeLocale(nav.language);
  } catch (_error) {
    // Browser globals are optional in tests.
  }
  return 'zh';
}

/** Look up a key in one dictionary. */
export function lookup(locale, key) {
  const dict = LOCALES[normalizeLocale(locale)];
  if (!dict) return null;
  const value = dict[key];
  return typeof value === 'string' ? value : null;
}

/** Replace `{name}` placeholders; unknown placeholders stay visible. */
export function interpolate(template, params) {
  if (typeof template !== 'string') return '';
  if (!params || typeof params !== 'object') return template;
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, function replace(match, name) {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
    const value = params[name];
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * Translate against a plain locale id; used by the sidebar label thunk and as
 * the last-resort fallback when the host locale seat is missing or broken.
 */
export function translate(locale, key, params) {
  const primary = lookup(locale, key);
  const zh = lookup('zh', key);
  const en = lookup('en', key);
  const template = primary || zh || en || key;
  return interpolate(template, params);
}

/**
 * Wrap the slot-kit `t` seat. The host can return the raw key or throw while a
 * dictionary is still being registered; both cases fall back to the built-in
 * dictionary so the plugin never renders an empty control.
 */
export function makeT(seat, locale) {
  const fallbackLocale = normalizeLocale(locale || 'zh');
  return function t(key, params) {
    let value = null;
    if (typeof seat === 'function') {
      try {
        value = seat(key);
      } catch (_error) {
        value = null;
      }
    }
    if (typeof value !== 'string' || value.length === 0 || value === key) {
      const fallback = lookup(fallbackLocale, key);
      const zh = lookup('zh', key);
      const en = lookup('en', key);
      value = fallback || zh || en || key;
    }
    return interpolate(value, params);
  };
}
