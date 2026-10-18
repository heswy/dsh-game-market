/**
 * Visible copy for the React template (PRD §8.2.9 item 9). Add locales here;
 * DSH passes the current UI locale through `game.runtime.locale`.
 */

export type Language = 'zh' | 'en';

type Dictionary = Record<string, string>;

const DICTIONARIES: Record<Language, Dictionary> = {
  zh: {
    title: __GAME_TITLE_JSON__,
    score: '分数',
    best: '最高分',
    lives: '生命',
    time: '时间',
    paused: '已暂停',
    pausedHint: '按「继续」回到游戏',
    ready: '准备开始',
    readyHint: '接住落下的星星',
    continue: '继续上一局',
    continueHint: '检测到未完成的存档，按空格继续',
    gameOver: '游戏结束',
    finalScore: '本局得分',
    restartHint: '按空格再来一局',
    loading: '正在连接 Game Runtime…',
    readyFailed: '游戏启动失败：{code}',
    saveFailed: '存档失败：{code}',
    scoreRange: '分数超出声明范围：{code}',
    controls: '← → / A D 移动；鼠标或触摸也可控制；Tab 离开画布',
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
    readyHint: 'Catch the falling stars',
    continue: 'Continue',
    continueHint: 'An unfinished save was found — press Space to continue',
    gameOver: 'Game over',
    finalScore: 'Final score',
    restartHint: 'Press Space to play again',
    loading: 'Connecting to the Game Runtime…',
    readyFailed: 'Game failed to start: {code}',
    saveFailed: 'Could not save: {code}',
    scoreRange: 'Score is outside the declared range: {code}',
    controls: 'Move with ← → / A D, mouse or touch; Tab leaves the canvas',
  },
};

export function createI18n(locale: string | undefined): { language: Language; t: (key: string, values?: Record<string, string | number>) => string } {
  const language: Language = String(locale || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  return {
    language,
    t(key: string, values?: Record<string, string | number>): string {
      const template = DICTIONARIES[language][key] ?? key;
      if (!values) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        values[name] === undefined ? match : String(values[name])
      );
    },
  };
}
