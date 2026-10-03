import type { EffectInterpreter } from "./EffectInterpreter";
import { getCharacterType } from "./characterUtils";
import { GraveTopCoordinator } from "./GraveTopCoordinator";
import { isCanonicalPrintedCard } from "./cardUtils";

export interface MoveUnitMetadata {
  cause?: { type: string; command?: string; actionId?: string; [key: string]: any };
  combatSnapshot?: { role?: string; blocksUnitId?: string; targetPlayerKey?: string; attackerPlayerKey?: string; [key: string]: any };
  characterType?: string;
  [key: string]: any;
}

/**
 * 盤面（field）から指定された unitId を持つユニットを一意に検索・検証します。
 * - ちょうど1件存在: そのユニットと所有者キーを返却
 * - 0件: Error を throw (fail-closed)
 * - 2件以上（重複存在）: malformed state Error を throw (fail-closed)
 */
export function resolveUniqueFieldUnitById(
  state: any,
  unitId: string
): { unit: any; ownerKey: string } {
  if (!unitId || typeof unitId !== "string") {
    throw new Error(`resolveUniqueFieldUnitById: 不正な unitId です: ${JSON.stringify(unitId)} (fail-closed)`);
  }
  if (!state?.players || typeof state.players !== "object") {
    throw new Error("resolveUniqueFieldUnitById: state.players が存在しません (fail-closed)");
  }

  const matches: { unit: any; ownerKey: string }[] = [];
  for (const [pKey, player] of Object.entries<any>(state.players)) {
    if (Array.isArray(player?.field)) {
      for (const u of player.field) {
        if (u && u.unitId === unitId) {
          matches.push({ unit: u, ownerKey: pKey });
        }
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`resolveUniqueFieldUnitById: ユニット (${unitId}) がどのプレイヤーのフィールドにも見つかりません (fail-closed)`);
  }
  if (matches.length > 1) {
    throw new Error(`resolveUniqueFieldUnitById: ユニット (${unitId}) が複数のフィールドに重複存在しています: ${matches.map(m => m.ownerKey).join(", ")} (fail-closed)`);
  }

  return matches[0];
}

/**
 * ユニットをフィールドから墓地へ移動する共通処理
 * 墓地に移動する前に unit.battle を完全に削除し、カードごとに cardMoved イベントを発行する
 */
export function moveUnitToGraveyard(
  unit: any,
  playerKey: string,
  state: any,
  effectInterpreter: EffectInterpreter,
  context: any,
  metadata?: MoveUnitMetadata
) {
  const player = state.players[playerKey];
  if (!player) return;

  // 移動前に battle snapshot を保持
  const combatSnapshot = metadata?.combatSnapshot || (unit.battle ? { ...unit.battle } : undefined);
  const characterType = metadata?.characterType || getCharacterType(unit, context?.components);

  // フィールドから除外
  if (player.field) {
    player.field = player.field.filter((u: any) => u.unitId !== unit.unitId);
  }

  // 墓地に送る前に battle 情報を完全に削除する
  if (unit.battle) {
    delete unit.battle;
  }

  // 墓地へ追加 (GraveTopCoordinator経由でTOP状態およびPending選択を管理)
  GraveTopCoordinator.addUnitToGrave(
    player,
    unit,
    state,
    playerKey,
    context?.logRecorder
  );

  // 各カードについて cardMoved イベントを発行
  if (unit.cards && Array.isArray(unit.cards)) {
    for (const card of unit.cards) {
      const event = {
        type: "cardMoved",
        payload: {
          card: card,
          fromZone: "field",
          toZone: "grave",
          playerKey: playerKey,
          cause: metadata?.cause,
          combat: combatSnapshot,
          characterType: characterType,
        },
      };
      effectInterpreter.dispatchEvent(event, context);
    }
  }
}

/**
 * ユニットをフィールドから手札へ移動する共通処理 (Phase 3.0-G generic primitive)
 * フィールドからユニットを除去し、unit.battle を削除した上で、
 * ユニットを構成する physical cards をオーナーの手札（hand）末尾へ追加する。
 * （Unit wrapper 自体は手札に入れない）
 * 各カードについて cardMoved (from: "field", to: "hand") を発行する。
 */
export function moveUnitToHand(
  unit: any,
  playerKey: string,
  state: any,
  effectInterpreter: EffectInterpreter,
  context: any,
  metadata?: MoveUnitMetadata
): void {
  const player = state?.players?.[playerKey];
  if (!player) {
    throw new Error(`moveUnitToHand: プレイヤーが見つかりません: ${playerKey} (fail-closed)`);
  }

  // --- 事前バリデーション (all-or-nothing: 変更前に全件検証) ---
  if (!unit || !unit.unitId || typeof unit.unitId !== "string" || unit.unitId.trim().length === 0) {
    throw new Error("moveUnitToHand: 対象ユニットが無効です (fail-closed)");
  }

  // 1. unitId の一意検証と所有者一致確認 (fail-closed)
  const resolved = resolveUniqueFieldUnitById(state, unit.unitId);
  if (resolved.ownerKey !== playerKey) {
    throw new Error(`moveUnitToHand: ユニット (${unit.unitId}) の所有者 (${resolved.ownerKey}) と指定プレイヤー (${playerKey}) が一致しません (fail-closed)`);
  }

  const canonicalUnit = resolved.unit;
  if (!canonicalUnit) {
    throw new Error(`moveUnitToHand: ユニット (${unit.unitId}) の実体が存在しません (fail-closed)`);
  }

  if (!Array.isArray(canonicalUnit.cards) || canonicalUnit.cards.length === 0) {
    throw new Error(`moveUnitToHand: ユニット (${canonicalUnit.unitId}) の構成カードが0枚または不正です (fail-closed)`);
  }

  const cardIds = new Set<string>();
  for (const card of canonicalUnit.cards) {
    if (!card || !card.id || typeof card.id !== "string" || card.id.trim().length === 0) {
      throw new Error(`moveUnitToHand: ユニット (${canonicalUnit.unitId}) のカードに有効なIDが存在しません (fail-closed)`);
    }
    if (cardIds.has(card.id)) {
      throw new Error(`moveUnitToHand: ユニット (${canonicalUnit.unitId}) 内に重複カードIDが存在します: ${card.id} (fail-closed)`);
    }
    cardIds.add(card.id);

    if (!isCanonicalPrintedCard(card)) {
      throw new Error(`moveUnitToHand: ユニット (${canonicalUnit.unitId}) に非Canonicalカードが含まれています: ${JSON.stringify(card)} (fail-closed)`);
    }
  }

  // 手札に既に同一カードIDが存在しないか検証
  if (Array.isArray(player.hand)) {
    for (const card of canonicalUnit.cards) {
      if (player.hand.some((c: any) => c?.id === card.id)) {
        throw new Error(`moveUnitToHand: カード (${card.id}) は既に手札に存在します (fail-closed)`);
      }
    }
  }

  // フィールド上にユニットが存在するか検証
  if (!Array.isArray(player.field)) {
    throw new Error(`moveUnitToHand: プレイヤー (${playerKey}) の field が配列ではありません (fail-closed)`);
  }
  const unitIndex = player.field.findIndex((u: any) => u.unitId === canonicalUnit.unitId);
  if (unitIndex === -1) {
    throw new Error(`moveUnitToHand: ユニット (${canonicalUnit.unitId}) がプレイヤー (${playerKey}) のフィールドに見つかりません (fail-closed)`);
  }

  // --- 状態変更処理 ---
  // 移動前に battle snapshot と characterType を保持 (canonicalUnit を SSOT とする)
  const combatSnapshot = metadata?.combatSnapshot || (canonicalUnit.battle ? { ...canonicalUnit.battle } : undefined);
  const characterType = metadata?.characterType || getCharacterType(canonicalUnit, context?.components);

  // フィールドから除外
  player.field.splice(unitIndex, 1);

  // battle 情報を完全に削除
  if (canonicalUnit.battle) {
    delete canonicalUnit.battle;
  }

  if (!Array.isArray(player.hand)) {
    player.hand = [];
  }

  // physical cards を hand 末尾へ追加（canonicalUnit.cards の既存順序を完全維持）
  // Unit wrapper 自体は hand へ入れず、カード実体のみを格納
  for (const card of canonicalUnit.cards) {
    player.hand.push(card);
  }

  // 各カードについて cardMoved イベントを発行 (fromZone: "field", toZone: "hand")
  for (const card of canonicalUnit.cards) {
    const event = {
      type: "cardMoved",
      payload: {
        card: card,
        fromZone: "field",
        toZone: "hand",
        playerKey: playerKey,
        cause: metadata?.cause,
        combat: combatSnapshot,
        characterType: characterType,
      },
    };
    effectInterpreter.dispatchEvent(event, context);
  }
}
