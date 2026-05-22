import { ActionDefinition } from "../../domain/rules/RulePackage";

/**
 * アクション定義から短縮表記のサマリーテキストを生成します。
 * 例:
 * - アップ: "アップ @直接-通常-クイック | $D | ★♡A-10 | 対象: 兵士1体"
 * - 兵士召喚: "兵士召喚 @直接-通常-メイン | $BL | ★2-10"
 */
export function formatActionSummary(action: ActionDefinition): string {
  const triggerMap: Record<string, string> = { direct: "直接", triggered: "誘発" };
  const speedMap: Record<string, string> = { normal: "通常", immediate: "即時" };
  const timingMap: Record<string, string> = { main: "メイン", quick: "クイック" };

  const trigger = triggerMap[action.request.trigger] || action.request.trigger;
  const speed = speedMap[action.request.speed] || action.request.speed;
  const timing = timingMap[action.request.timing] || action.request.timing;
  const reqStr = `@${trigger}-${speed}-${timing}`;

  const costStr = action.cost ? `$${action.cost}` : "";

  // キーカード条件の解析
  let keyStr = "";
  if (action.key) {
    const suitMap: Record<string, string> = { heart: "♡", spade: "♠", diamond: "♢", club: "♣" };
    if (action.key.condition && action.key.condition.card) {
      const card = action.key.condition.card;
      const suit = card.suit ? suitMap[card.suit] || card.suit : "";
      const rank = (card.rank || "").replace(/\.\./g, "-");
      keyStr = `★${suit}${rank}`;
    } else if (action.key.conditions) {
      // 複数キーカード条件の解析
      const subKeys = action.key.conditions.map((cond: any) => {
        const card = cond.card || cond;
        const suit = card.suit ? suitMap[card.suit] || card.suit : "";
        const rank = (card.rank || "").replace(/\.\./g, "-");
        return `${suit}${rank}`;
      });
      keyStr = `★${subKeys.join(" + ")}`;
    }
  }

  // 対象条件の解析
  let targetStr = "";
  if (action.targets && action.targets.length > 0) {
    const target = action.targets[0];
    if (target.condition) {
      if (target.condition.component === "character.soldier") {
        targetStr = "対象: 兵士1体";
      } else if (target.condition.component === "character.bulwark") {
        targetStr = "対象: 防壁1体";
      } else {
        targetStr = `対象: ${target.condition.component}`;
      }
    }
  }

  const parts = [
    action.name,
    reqStr,
    costStr,
    keyStr,
    targetStr
  ].filter(Boolean);

  // name と request 以外は `|` で区切る
  const [name, req, ...rest] = parts;
  if (rest.length > 0) {
    return `${name} ${req} | ${rest.join(" | ")}`;
  }
  return `${name} ${req}`;
}
