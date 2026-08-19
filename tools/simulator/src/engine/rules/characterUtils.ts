import { ComponentDefinition } from "../../domain/rules/RulePackage";

/**
 * ユニットの意味的な characterType を取得します。
 * 特定の componentId 文字列の完全一致だけに依存せず、ComponentDefinition の定義や properties を優先して判定します。
 */
export function getCharacterType(unit: any, components: readonly ComponentDefinition[] = []): string {
  if (!unit) return "";

  const compDef = components.find((c) => c.id === unit.componentId);

  // 1. properties.characterType を最優先
  if (compDef?.properties?.characterType) {
    return compDef.properties.characterType;
  }
  if (unit.properties?.characterType) {
    return unit.properties.characterType;
  }

  // 2. kind による判定
  const kind = unit.kind || compDef?.name || compDef?.display?.kind;
  if (kind === "一般兵" || kind === "兵士" || kind === "soldier") {
    return "soldier";
  }
  if (kind === "防壁" || kind === "bulwark") {
    return "bulwark";
  }

  // 3. componentId の末尾・識別子判定
  const compId = unit.componentId || "";
  if (compId.includes("soldier") || compId.endsWith(".soldier")) {
    return "soldier";
  }
  if (compId.includes("bulwark") || compId.endsWith(".bulwark")) {
    return "bulwark";
  }

  return kind || compId;
}

/**
 * ユニットが「兵士タイプ」であるかを判定します。
 */
export function isSoldierType(unit: any, components: readonly ComponentDefinition[] = []): boolean {
  return getCharacterType(unit, components) === "soldier";
}

/**
 * ユニットが「防壁タイプ」であるかを判定します。
 */
export function isBulwarkType(unit: any, components: readonly ComponentDefinition[] = []): boolean {
  return getCharacterType(unit, components) === "bulwark";
}

/**
 * ユニットがブロッカー候補としての資格（<防御>ラベル、charge状態、character）を満たすか判定します。
 */
export function isLegalBlockerCandidate(unit: any, components: readonly ComponentDefinition[] = []): boolean {
  if (!unit || unit.state !== "charge") return false;

  const compDef = components.find((c) => c.id === unit.componentId);

  // character 判定
  const isCharacter = compDef ? compDef.type === "character" : unit.componentId?.startsWith("character.");
  if (!isCharacter) return false;

  // <防御> / defense ラベル判定
  const labels: string[] = [
    ...(compDef?.display?.labels || []),
    ...(compDef as any)?.labels || [],
    ...(unit.labels || []),
  ];

  return labels.includes("防御") || labels.includes("defense");
}
