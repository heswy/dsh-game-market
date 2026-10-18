/**
 * All visible copy lives here (PRD §8.2.9 item 9). Add a locale by adding a
 * dictionary; the game picks the DSH locale reported by `game.runtime.locale`.
 */

export const DICTIONARIES = {
  zh: {
    title: __GAME_TITLE_JSON__,
    score: '分数',
    best: '最高分',
    lives: '生命',
    time: '时间',
    paused: '已暂停',
    pausedHint: '按「继续」回到游戏',
    ready: '准备开始',
    readyHint: '接住落下的星星，别让它们掉到地上',
    continue: '继续上一局',
    continueHint: '检测到未完成的存档，按空格继续',
    newGame: '新游戏',
    gameOver: '游戏结束',
    finalScore: '本局得分',
    restartHint: '按空格再来一局',
    loading: '正在连接 Game Runtime…',
    readyFailed: '游戏启动失败：{code}',
    saveFailed: '存档失败：{code}',
    saveOk: '已自动保存',
    scoreRange: '分数超出游戏声明范围：{code}',
    catchHint: '← → / A D 移动，鼠标或触摸也可控制；Tab 离开画布',
    seconds: '{value} 秒',
  },
  en: {
    title: __GAME_TITLE_JSON__,
    score: 'Score',
    best: 'Best',
    lives: 'Lives',
    time: 'Time',
    paused: 'Paused',
    pausedHint: 'Press Resume to continue',
    ready: 'Ready',
    readyHint: 'Catch the falling stars before they hit the ground',
    continue: 'Continue',
    continueHint: 'An unfinished save was found — press Space to continue',
    newGame: 'New game',
    gameOver: 'Game over',
    finalScore: 'Final score',
    restartHint: 'Press Space to play again',
    loading: 'Connecting to the Game Runtime…',
    readyFailed: 'Game failed to start: {code}',
    saveFailed: 'Could not save: {code}',
    saveOk: 'Autosaved',
    scoreRange: 'Score is outside the declared range: {code}',
    catchHint: 'Move with ← → / A D, mouse or touch; Tab leaves the canvas',
    seconds: '{value}s',
  },
};

export function normalizeLocale(locale) {
  return String(locale || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function createI18n(locale) {
  const language = normalizeLocale(locale);
  const dictionary = DICTIONARIES[language];
  function t(key, variables) {
    const template = dictionary[key] === undefined ? String(key) : String(dictionary[key]);
    if (!variables) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      variables[name] === undefined ? match : String(variables[name])
    );
  }
  return { language, locale, t };
}
