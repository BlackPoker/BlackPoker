/**
 * PlaytestSeed.ts
 *
 * Playtest用 Seed Mode 定義および Auto Seed 生成ユーティリティ。
 * Game Core（Engine）に Auto 概念を持ち込まず、UI/Playtest層において
 * 決定論的かつ再現可能な具象 Seed (uint32: 0..4294967295) を確定・管理します。
 */

export type PlaytestSeedMode = "auto" | "manual";

export const UINT32_MAX = 4294967295;

/**
 * 自動対戦用 Seed (uint32: 0..4294967295) を生成します。
 *
 * @param source テスト注入用乱数源 (0 <= x <= 1 の有限数を返す関数)。未指定時は crypto.getRandomValues (優先) または Math.random (fallback)。
 * @returns 0 以上 4294967295 以下の整数
 * @throws {Error} source が有限数でない場合 (NaN, Infinity, -Infinity) または 0 未満 / 1 超過の場合 (fail-closed)
 */
export function generateAutoSeed(source?: () => number): number {
  if (source !== undefined) {
    if (typeof source !== "function") {
      throw new Error("Invalid random source: source must be a function returning a number");
    }
    const raw = source();
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`Invalid random source value: expected a finite number between 0 and 1, received ${raw}`);
    }
    if (raw < 0 || raw > 1) {
      throw new Error(`Invalid random source value: expected a finite number between 0 and 1, received ${raw}`);
    }
    if (raw === 1) {
      return UINT32_MAX;
    }
    const scaled = Math.floor(raw * 4294967296);
    return Math.max(0, Math.min(UINT32_MAX, scaled));
  }

  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0];
  }

  return Math.floor(Math.random() * 4294967296);
}

/**
 * 直前（または現在対戦中）の Seed と確実に異なる次回用 Seed を生成します。
 *
 * @param previousSeed 直前の Seed (uint32)
 * @param source テスト注入用乱数源
 * @returns previousSeed とは異なる 0 以上 4294967295 以下の整数
 */
export function generateNextAutoSeed(previousSeed: number, source?: () => number): number {
  const candidate = generateAutoSeed(source);
  if (candidate !== previousSeed) {
    return candidate;
  }
  return previousSeed === UINT32_MAX ? 0 : previousSeed + 1;
}
