/**
 * 決定論的シミュレーションおよび AI Policy 用の乱数生成器抽象インターフェース。
 */
export interface RandomSource {
  /** シード値 */
  readonly seed: number;

  /**
   * [0, 1) の擬似乱数浮動小数点数を生成
   */
  next(): number;

  /**
   * [min, max] の範囲内の整数を生成 (両端を含む)
   */
  nextInt(min: number, max: number): number;

  /**
   * 配列からランダムに要素を1つ選択 (空配列の場合は undefined)
   */
  choice<T>(array: readonly T[]): T | undefined;

  /**
   * 現在のシード状態から派生した新しい RandomSource を生成
   */
  fork(): RandomSource;
}

/**
 * Mulberry32 アルゴリズムに基づく高速かつ高品質な決定論的 32-bit PRNG。
 * 同じ seed で初期化された場合、完全に同一の擬似乱数列を再現します。
 */
export class SeededRandom implements RandomSource {
  private state: number;
  public readonly seed: number;

  constructor(seed: number = 0) {
    this.seed = seed >>> 0;
    // 0 の場合でも状態を適切に初期化
    this.state = (this.seed ^ 0x6d2b79f5) >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    if (min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    const r = this.next();
    return Math.floor(r * (max - min + 1)) + min;
  }

  choice<T>(array: readonly T[]): T | undefined {
    if (!array || array.length === 0) {
      return undefined;
    }
    const idx = this.nextInt(0, array.length - 1);
    return array[idx];
  }

  fork(): RandomSource {
    const nextSeed = (this.state ^ Math.imul(this.nextInt(1, 0x7fffffff), 0x9e3779b9)) >>> 0;
    return new SeededRandom(nextSeed);
  }
}
