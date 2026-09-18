import { PlayerKey } from "../../domain/decision/DecisionSource";
import type { CommandContext } from "./CommandRegistry";

/**
 * 2人対戦における対戦相手のプレイヤーキーを取得します。
 * 将来的に複数人対戦やチーム戦へ拡張された場合も、この関数を集約修正することで対応可能にします。
 */
export function getOpponentPlayerKey(playerKey: string | PlayerKey, state?: any): PlayerKey {
  if (state?.players) {
    const keys = Object.keys(state.players) as PlayerKey[];
    if (keys.length === 2) {
      return keys.find((k) => k !== playerKey) || (playerKey === "p1" ? "p2" : "p1");
    }
  }
  return playerKey === "p1" ? "p2" : "p1";
}

/**
 * 次のプレイヤーキーを取得します。
 */
export function getNextPlayerKey(current: PlayerKey, state: any): PlayerKey {
  const playerKeys = Object.keys(state?.players || {}) as PlayerKey[];
  if (playerKeys.length <= 1) return current;
  const currentIndex = playerKeys.indexOf(current);
  if (currentIndex === -1) return playerKeys[0];
  const nextIndex = (currentIndex + 1) % playerKeys.length;
  return playerKeys[nextIndex];
}

/**
 * 盤面（field）からユニットの所有プレイヤー（Owner）を特定・検証します。
 * 現行Simulatorでは、ユニットが格納されている players[pX].field がOwnerのSSOTです。
 * - ちょうど1人のフィールドに存在: そのプレイヤーキーを返却
 * - 0人（存在しない）: Error を throw (fail-closed)
 * - 2人以上（重複存在）: malformed state Error を throw (fail-closed)
 */
export function findUnitOwnerPlayerKey(state: any, unitId: string): PlayerKey {
  if (!unitId || typeof unitId !== "string") {
    throw new Error(`findUnitOwnerPlayerKey: 不正な unitId です: ${JSON.stringify(unitId)}`);
  }
  if (!state?.players || typeof state.players !== "object") {
    throw new Error("findUnitOwnerPlayerKey: state.players が存在しません。");
  }

  const matches: PlayerKey[] = [];
  for (const [pKey, player] of Object.entries<any>(state.players)) {
    if (Array.isArray(player?.field)) {
      const exists = player.field.some((u: any) => u && u.unitId === unitId);
      if (exists) {
        matches.push(pKey as PlayerKey);
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`findUnitOwnerPlayerKey: ユニット (${unitId}) がどのプレイヤーのフィールドにも見つかりません。`);
  }
  if (matches.length > 1) {
    throw new Error(`findUnitOwnerPlayerKey: ユニット (${unitId}) が複数のプレイヤーのフィールドに重複存在しています: ${matches.join(", ")}`);
  }

  return matches[0];
}

/**
 * 効果解決およびコマンドハンドラにおいて、DSL のプレイヤー参照（spec）を厳格に解決します。
 *
 * 参照規約:
 * - undefined, "self", "controller": context.playerKey (アクション実行者)
 * - "opponent": 2人対戦における対戦相手
 * - "targetPlayer": context.targetPlayerKey (Request Target として確定したプレイヤー。存在しない場合は fail-closed)
 * - "targetOwner": 対象ユニットまたは対象プレイヤーの所有者 (存在しない場合は fail-closed)
 * - "turnPlayer": context.state.turnPlayer (存在しない場合は fail-closed)
 * - "nonTurnPlayer": context.state.nonTurnPlayer || 対戦相手 (turnPlayer が未定義なら fail-closed)
 * - 明示的プレイヤーID (例: "p1", "p2"): context.state.players[spec] が存在すれば返却
 * - 未知の参照文字列: fail-closed (サイレントフォールバック禁止)
 */
export function resolveEffectPlayerKey(
  spec: string | undefined,
  context: CommandContext
): PlayerKey {
  if (!spec || spec === "self" || spec === "controller") {
    return context.playerKey;
  }
  if (spec === "opponent") {
    return getOpponentPlayerKey(context.playerKey, context.state);
  }
  if (spec === "targetPlayer") {
    if (!context.targetPlayerKey) {
      throw new Error("resolveEffectPlayerKey: targetPlayer reference requires context.targetPlayerKey (fail-closed)");
    }
    return context.targetPlayerKey as PlayerKey;
  }
  if (spec === "targetOwner") {
    if (context.targetPlayerKey) {
      return context.targetPlayerKey as PlayerKey;
    }
    if (context.targetComponent && context.state) {
      return findUnitOwnerPlayerKey(context.state, context.targetComponent.unitId);
    }
    throw new Error("resolveEffectPlayerKey: targetOwner reference requires context.targetComponent or context.targetPlayerKey (fail-closed)");
  }
  if (spec === "turnPlayer") {
    if (!context.state?.turnPlayer) {
      throw new Error("resolveEffectPlayerKey: turnPlayer does not exist in state (fail-closed)");
    }
    return context.state.turnPlayer;
  }
  if (spec === "nonTurnPlayer") {
    if (context.state?.nonTurnPlayer) {
      return context.state.nonTurnPlayer;
    }
    if (context.state?.turnPlayer) {
      return getOpponentPlayerKey(context.state.turnPlayer, context.state);
    }
    throw new Error("resolveEffectPlayerKey: nonTurnPlayer resolution requires state.turnPlayer (fail-closed)");
  }
  if (context.state?.players?.[spec]) {
    return spec as PlayerKey;
  }
  throw new Error(`resolveEffectPlayerKey: unknown player reference '${spec}' (fail-closed)`);
}

