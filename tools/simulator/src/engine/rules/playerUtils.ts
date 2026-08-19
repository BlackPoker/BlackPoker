import { PlayerKey } from "../../domain/decision/DecisionSource";

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
