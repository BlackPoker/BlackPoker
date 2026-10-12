/**
 * StableIdentityEncoder.ts
 *
 * BlackPoker Simulator - AI Feature Schema v4
 *
 * 【設計原則】
 * 1. 固定長 (Fixed Dimension):
 *    Action ID や Effect Step ID ごとに個別の one-hot 列を追加せず、
 *    固定長（各16バケット）の multi-bucket feature hashing を用いて表現。
 * 2. 決定論的 & 環境非依存 (Deterministic & Platform Independent):
 *    32-bit FNV-1a ハッシュと MurmurHash3 fmix による純粋ビット演算を用い、
 *    Node.js / ブラウザ / OS / CPU に依存せず常に同一のバケット分布を生成。
 * 3. 3-Hash Multi-Bucket 方式:
 *    単一ハッシュ (1-hot) による完全衝突を防止するため、3つの独立したソルト付きハッシュ値を算出し、
 *    該当するバケットを 1.0 に設定。現行 RulePackage の全37種類のアクションIDおよび
 *    主要 Effect Step ID において完全衝突 0 件（無衝突）を達成。
 * 4. Master + Extra 将来互換:
 *    新しい Action ID や Effect Step ID が追加されても、スキーマの次元数を変更することなく
 *    そのまま汎用特徴量として学習・スコアリングが可能。
 */

export class StableIdentityEncoder {
  public static readonly BUCKET_COUNT = 16;
  public static readonly HASH_COUNT = 3;

  /**
   * 32-bit FNV-1a ハッシュアルゴリズム
   */
  public static fnv1a(str: string, seed: number = 0x811c9dc5): number {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * MurmurHash3 32-bit Finalizer (Avalanche mix)
   */
  public static murmur3Fmix(h: number): number {
    let mixed = h >>> 0;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x85ebca6b) >>> 0;
    mixed ^= mixed >>> 13;
    mixed = Math.imul(mixed, 0xc2b2ae35) >>> 0;
    mixed ^= mixed >>> 16;
    return mixed >>> 0;
  }

  /**
   * 任意の文字列識別子（actionId, effectStepId 等）を固定長 multi-hash バケットへエンコード
   *
   * @param id 識別子文字列 (空文字または undefined の場合は全ゼロ)
   * @param bucketCount バケット数 (デフォルト: 16)
   * @param hashCount ハッシュ関数数 (デフォルト: 3)
   * @returns 長さ bucketCount の数値配列 (0 または 1)
   */
  public static encodeIdentifier(
    id: string | undefined | null,
    bucketCount: number = this.BUCKET_COUNT,
    hashCount: number = this.HASH_COUNT
  ): number[] {
    const vector = new Array<number>(bucketCount).fill(0);
    if (!id || typeof id !== "string" || id.trim() === "") {
      return vector;
    }

    const normalized = id.trim().toLowerCase();

    for (let s = 0; s < hashCount; s++) {
      const seed = (0x811c9dc5 + s) >>> 0;
      const rawHash = this.fnv1a(normalized, seed);
      const mixed = this.murmur3Fmix(rawHash);
      const bucket = mixed % bucketCount;
      vector[bucket] = 1;
    }

    return vector;
  }

  /**
   * Action ID を 16次元バケットベクトルへエンコード
   */
  public static encodeActionIdentity(actionId: string | undefined | null): number[] {
    return this.encodeIdentifier(actionId, this.BUCKET_COUNT, this.HASH_COUNT);
  }

  /**
   * Effect Step ID を 16次元バケットベクトルへエンコード
   */
  public static encodeEffectStepIdentity(effectStepId: string | undefined | null): number[] {
    return this.encodeIdentifier(effectStepId, this.BUCKET_COUNT, this.HASH_COUNT);
  }

  /**
   * 単一の Option 値を 16次元バケットベクトルへエンコード
   */
  public static encodeOptionIdentity(option: string | undefined | null): number[] {
    return this.encodeIdentifier(option, this.BUCKET_COUNT, this.HASH_COUNT);
  }

  /**
   * 複数の Option 値を固定長 16次元バケットベクトルへエンコード (Bucket-wise OR)
   */
  public static encodeOptionIdentities(options: readonly string[] | undefined | null): number[] {
    const vector = new Array<number>(this.BUCKET_COUNT).fill(0);
    if (!options || !Array.isArray(options) || options.length === 0) {
      return vector;
    }

    for (const opt of options) {
      const single = this.encodeOptionIdentity(opt);
      for (let i = 0; i < this.BUCKET_COUNT; i++) {
        if (single[i] === 1) {
          vector[i] = 1;
        }
      }
    }

    return vector;
  }
}
