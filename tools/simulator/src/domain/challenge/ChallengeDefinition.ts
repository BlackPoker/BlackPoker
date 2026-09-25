/**
 * Challenge Definition Schema V1 (BP-SIM-CHALLENGE-1.0-WIN-CURRENT-TURN)
 *
 * BlackPokerにおける局面チャレンジの宣言的定義。
 * GameState や action ID, Stage, Request などの実行時内部状態は含めず、
 * 達成すべきゴールのみを純粋に定義します。
 */

export const CHALLENGE_SCHEMA_VERSION = 1 as const;

export type ChallengeKind = "WIN_CURRENT_TURN";

export interface ChallengeDefinitionV1 {
  readonly version: 1;
  readonly kind: "WIN_CURRENT_TURN";
}

export function isChallengeDefinitionV1(val: unknown): val is ChallengeDefinitionV1 {
  if (!val || typeof val !== "object") return false;
  const c = val as Record<string, unknown>;
  return c.version === 1 && c.kind === "WIN_CURRENT_TURN";
}

export function parseChallengeDefinitionV1(
  raw: unknown
):
  | { readonly success: true; readonly definition: ChallengeDefinitionV1 }
  | { readonly success: false; readonly error: string } {
  if (!raw || typeof raw !== "object") {
    return { success: false, error: "チャレンジ定義がオブジェクトではありません。" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== CHALLENGE_SCHEMA_VERSION) {
    return {
      success: false,
      error: `未対応のチャレンジバージョンです (version: ${obj.version})。`,
    };
  }
  if (obj.kind !== "WIN_CURRENT_TURN") {
    return {
      success: false,
      error: `未対応のチャレンジ種別です (kind: ${obj.kind})。`,
    };
  }
  return {
    success: true,
    definition: {
      version: 1,
      kind: "WIN_CURRENT_TURN",
    },
  };
}
