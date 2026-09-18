import type { EffectInterpreter } from "./EffectInterpreter";
import { getCharacterType } from "./characterUtils";
import { GraveTopCoordinator } from "./GraveTopCoordinator";

export interface MoveUnitMetadata {
  cause?: { type: string; command?: string; actionId?: string; [key: string]: any };
  combatSnapshot?: { role?: string; blocksUnitId?: string; targetPlayerKey?: string; attackerPlayerKey?: string; [key: string]: any };
  characterType?: string;
  [key: string]: any;
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
  const player = state.players?.[playerKey];
  if (!player) {
    throw new Error(`moveUnitToHand: プレイヤーが見つかりません: ${playerKey} (fail-closed)`);
  }

  // --- 事前バリデーション (all-or-nothing: 変更前に全件検証) ---
  if (!unit || !unit.unitId) {
    throw new Error("moveUnitToHand: 対象ユニットが無効です (fail-closed)");
  }

  if (!Array.isArray(unit.cards) || unit.cards.length === 0) {
    throw new Error(`moveUnitToHand: ユニット (${unit.unitId}) の構成カードが0枚または不正です (fail-closed)`);
  }

  const cardIds = new Set<string>();
  for (const card of unit.cards) {
    if (!card || !card.id) {
      throw new Error(`moveUnitToHand: ユニット (${unit.unitId}) のカードにIDが存在しません (fail-closed)`);
    }
    if (cardIds.has(card.id)) {
      throw new Error(`moveUnitToHand: ユニット (${unit.unitId}) 内に重複カードIDが存在します: ${card.id} (fail-closed)`);
    }
    cardIds.add(card.id);
  }

  // 手札に既に同一カードIDが存在しないか検証
  if (Array.isArray(player.hand)) {
    for (const card of unit.cards) {
      if (player.hand.some((c: any) => c?.id === card.id)) {
        throw new Error(`moveUnitToHand: カード (${card.id}) は既に手札に存在します (fail-closed)`);
      }
    }
  }

  // フィールド上にユニットが存在するか検証
  if (!Array.isArray(player.field)) {
    throw new Error(`moveUnitToHand: プレイヤー (${playerKey}) の field が配列ではありません (fail-closed)`);
  }
  const unitIndex = player.field.findIndex((u: any) => u.unitId === unit.unitId);
  if (unitIndex === -1) {
    throw new Error(`moveUnitToHand: ユニット (${unit.unitId}) がプレイヤー (${playerKey}) のフィールドに見つかりません (fail-closed)`);
  }

  // --- 状態変更処理 ---
  // 移動前に battle snapshot と characterType を保持
  const combatSnapshot = metadata?.combatSnapshot || (unit.battle ? { ...unit.battle } : undefined);
  const characterType = metadata?.characterType || getCharacterType(unit, context?.components);

  // フィールドから除外
  player.field.splice(unitIndex, 1);

  // battle 情報を完全に削除
  if (unit.battle) {
    delete unit.battle;
  }

  if (!Array.isArray(player.hand)) {
    player.hand = [];
  }

  // physical cards を hand 末尾へ追加（Unit.cards の既存順序を完全維持）
  // Unit wrapper 自体は hand へ入れず、カード実体のみを格納
  for (const card of unit.cards) {
    player.hand.push(card);
  }

  // 各カードについて cardMoved イベントを発行 (fromZone: "field", toZone: "hand")
  for (const card of unit.cards) {
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
