import { RandomSource } from "./RandomSource";

/**
 * ベースシードとストリームキーから、32-bit FNV-1a ハッシュを用いて独立した決定論的シード値を導出します。
 */
export function deriveSeed(baseSeed: number, streamKey: string): number {
  const str = `${baseSeed}:${streamKey}`;
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Fisher-Yates アルゴリズムによる決定論的カード配列シャッフル。
 * 既存の Setup Shuffle と完全同一のアルゴリズム・順序を保証します。
 */
export function shuffleDeterministic<T>(cards: readonly T[], rng: RandomSource): T[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * 既存コードとの後方互換エイリアス
 */
export const shuffleCards = shuffleDeterministic;

/**
 * ゲーム中（Runtime）ゾーンシャッフル用の決定論的シードキープレフィックス契約
 */
export const RUNTIME_SHUFFLE_STREAM_PREFIX = "runtime-shuffle";

/**
 * Match Seed と実行カウンタから、ゲーム中ゾーンシャッフル用の独立シード値を導出します。
 * streamKey は "runtime-shuffle-${counter}" として固定契約されます。
 */
export function deriveRuntimeShuffleSeed(matchSeed: number, counter: number): number {
  return deriveSeed(matchSeed, `${RUNTIME_SHUFFLE_STREAM_PREFIX}-${counter}`);
}
