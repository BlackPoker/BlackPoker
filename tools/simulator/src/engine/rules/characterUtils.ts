import { ComponentDefinition } from "../../domain/rules/RulePackage";

/**
 * ユニットが「キャラクター (character)」コンポーネントであるかを判定します。
 * ComponentDefinition が存在する場合はその type === "character" を正とします。
 */
export function isCharacterComponent(unit: any, components: readonly ComponentDefinition[] = []): boolean {
  if (!unit) return false;

  const compDef = components.find((c) => c.id === unit.componentId);
  if (compDef) {
    return compDef.type === "character";
  }

  // --- Legacy compatibility fallback ---
  // ComponentDefinition が取得できない旧テスト/モック環境用のフォールバック
  const compId = unit.componentId || "";
  return compId.startsWith("character.") || compId.startsWith("char.") || unit.kind !== undefined;
}

/**
 * ユニットが指定されたラベル（例: "攻撃", "防御"）を持っているかを判定します。
 * 日英表記の揺れ（"攻撃"/"attack", "防御"/"defense"）を統一的に解決します。
 */
export function hasUnitLabel(
  unit: any,
  targetLabel: string,
  components: readonly ComponentDefinition[] = []
): boolean {
  if (!unit) return false;

  const compDef = components.find((c) => c.id === unit.componentId);

  const rawLabels: string[] = [
    ...(compDef?.display?.labels || []),
    ...((compDef as any)?.labels || []),
    ...(unit.labels || []),
  ];

  const normalizedTarget = targetLabel.toLowerCase();
  const isAttackTarget = normalizedTarget === "攻撃" || normalizedTarget === "attack";
  const isDefenseTarget = normalizedTarget === "防御" || normalizedTarget === "defense";

  for (const label of rawLabels) {
    const l = label.toLowerCase();
    if (l === normalizedTarget) return true;
    if (isAttackTarget && (l === "攻撃" || l === "attack")) return true;
    if (isDefenseTarget && (l === "防御" || l === "defense")) return true;
  }

  return false;
}

/**
 * ユニットの意味的な characterType（"soldier", "bulwark" 等）を取得します。
 * ComponentDefinition が存在する場合は、その properties.characterType を正とします。
 */
export function getCharacterType(unit: any, components: readonly ComponentDefinition[] = []): string {
  if (!unit) return "";

  const compDef = components.find((c) => c.id === unit.componentId);

  // 1. ComponentDefinition の properties.characterType を最優先
  if (compDef) {
    if (compDef.properties?.characterType) {
      return compDef.properties.characterType;
    }
    // ComponentDefinition が存在するが characterType が未定義の場合は空文字
    // （定義があるにもかかわらず ID 文字列等から勝手に推測補完しない）
    return "";
  }

  // 2. ユニットの直接プロパティ
  if (unit.properties?.characterType) {
    return unit.properties.characterType;
  }

  // --- Legacy compatibility fallback ---
  // ComponentDefinition が存在しない旧環境用のフォールバック
  const kind = unit.kind || "";
  if (kind === "一般兵" || kind === "兵士" || kind === "soldier") {
    return "soldier";
  }
  if (kind === "防壁" || kind === "bulwark") {
    return "bulwark";
  }

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
 * ユニットがアタッカー候補としての資格（charge状態、character、<攻撃>ラベル）を満たすか判定します。
 */
export function isLegalAttackerCandidate(unit: any, components: readonly ComponentDefinition[] = []): boolean {
  if (!unit || unit.state !== "charge") return false;
  if (!isCharacterComponent(unit, components)) return false;
  return hasUnitLabel(unit, "攻撃", components);
}

/**
 * ユニットがブロッカー候補としての資格（charge状態、character、<防御>ラベル）を満たすか判定します。
 */
export function isLegalBlockerCandidate(unit: any, components: readonly ComponentDefinition[] = []): boolean {
  if (!unit || unit.state !== "charge") return false;
  if (!isCharacterComponent(unit, components)) return false;
  return hasUnitLabel(unit, "防御", components);
}

/**
 * ユニットが「速攻 (haste)」能力を持っているかを判定します。
 */
export function hasHaste(unit: any, components: readonly ComponentDefinition[] = []): boolean {
  if (!unit) return false;
  const compDef = components.find((c) => c.id === unit.componentId);

  const rawAbilities: string[] = [
    ...(compDef?.display?.labels || []),
    ...((compDef as any)?.labels || []),
    ...((compDef as any)?.abilities || []),
    ...(unit.abilities || []),
    ...(unit.labels || []),
  ];

  for (const ab of rawAbilities) {
    const l = String(ab).toLowerCase();
    if (l === "速攻" || l === "haste" || l === "quickattack" || l === "<速攻>") return true;
  }
  return false;
}

