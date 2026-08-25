import { RulePackage } from "../../domain/rules/RulePackage";

/**
 * Core Battle Playtest 用に、Playtest でサポートされているアクションのみにフィルタリングした RulePackage を生成します。
 * （ブラウザ、Node.js、CLI、シミュレーション共通）
 */
export function getCoreBattlePlaytestRulePackage(fullRulePackage: RulePackage): RulePackage {
  // Playtest でサポートされるアクションID一覧
  const supportedActionIds = new Set([
    "action.attack",
    "action.block",
    "action.damageJudge",
    "action.end",
    "action.charge",
    "action.draw",
    "action.twist",
    "action.counterattack",
    "action.nextGeneration",
    "action.revolutionDraw",
  ]);

  const filteredActions = fullRulePackage.actions.filter((a) => supportedActionIds.has(a.id));

  return {
    ...fullRulePackage,
    actions: filteredActions,
  };
}

/**
 * 下位互換用エイリアス
 */
export const getPlaytestRulePackage = getCoreBattlePlaytestRulePackage;
