import type { EffectInterpreter } from "./EffectInterpreter";
import { getCharacterType } from "./characterUtils";

export interface MoveUnitMetadata {
  cause?: { type: string; command?: string; actionId?: string; [key: string]: any };
  combatSnapshot?: { role?: string; blocksUnitId?: string; targetPlayerKey?: string; [key: string]: any };
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

  // 墓地へ追加
  if (!player.grave) {
    player.grave = [];
  }
  player.grave.push(unit);

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
