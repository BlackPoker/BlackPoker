import { RulePackage } from "../../domain/rules/RulePackage";

/**
 * Playtest でサポートされるアクションID一覧（Single Source of Truth）
 */
export const PLAYTEST_SUPPORTED_ACTION_IDS = new Set<string>([
  "action.attack",
  "action.block",
  "action.damageJudge",
  "action.end",
  "action.charge",
  "action.draw",
  "action.twist",
  "action.up",
  "action.down",
  "action.counterattack",
  "action.nextGeneration",
  "action.revolutionDraw",
]);

/**
 * Core Battle Playtest 用に、Playtest でサポートされているアクションのみにフィルタリングした RulePackage を生成します。
 * （ブラウザ、Node.js、CLI、シミュレーション共通）
 */
export function getCoreBattlePlaytestRulePackage(fullRulePackage: RulePackage): RulePackage {
  const filteredActions = fullRulePackage.actions.filter((a) => PLAYTEST_SUPPORTED_ACTION_IDS.has(a.id));

  return {
    ...fullRulePackage,
    actions: filteredActions,
  };
}

/**
 * 下位互換用エイリアス
 */
export const getPlaytestRulePackage = getCoreBattlePlaytestRulePackage;
