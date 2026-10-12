/**
 * Genetic Operator Types (BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2 / BP-SIM-AI-GENETIC-OPERATORS-V1)
 *
 * BlackPoker Simulator AI基盤における遺伝的操作子（Crossover, Mutation, Parent Pairing, Offspring）の型定義。
 * 設計仕様書: tools/simulator/docs/ai-genetic-operators-design-v1.md
 *
 * 最重要設計原則:
 * 1. "Victory is the objective. Life is a resource, not a score."
 * 2. DNA と Fitness の厳格な分離 (Fitness スコアを DNA や Lineage メタデータへ書き込まない)
 * 3. 既存 deriveSeed(baseSeed, streamKey) の再利用と固定ストリームキー規約
 * 4. PRNG 消費規約の固定 (nextUint32V1, uint16 upper 16-bit, 1 draw/word)
 * 5. Crossover / Mutation / Retry の乱数ストリーム完全分離
 * 6. 決定論的 Offspring Identity (UUID・時刻・ランダムの完全排除)
 * 7. ルール・アクション非依存 (Rule-Agnostic)
 */

import { DecisionDNA } from "./DecisionDNATypes";
import { SelectedParent } from "./PopulationSelectionTypes";

/**
 * 遺伝的操作子の設定パラメータ
 */
export interface GeneticOperatorConfig {
  /** 各重みが変異対象となる確率 (0 <= rate <= 1) */
  readonly mutationRate: number;
  /** 摂動規模・正規ノイズ標準偏差 (有限非負数 >= 0) */
  readonly mutationSigma: number;
  /** 変異後の重み下限値 (有限数) */
  readonly mutationClampMin: number;
  /** 変異後の重み上限値 (有限数, clampMin < clampMax) */
  readonly mutationClampMax: number;
  /** 自己交配検知時の最大リトライ回数 (有限整数 >= 0) */
  readonly maxSelfMatingRetries: number;
}

/**
 * 遺伝的操作子設定の初期仮値 (Provisional Engineering Defaults)
 */
export const DEFAULT_GENETIC_OPERATOR_CONFIG: GeneticOperatorConfig = Object.freeze({
  mutationRate: 0.01,
  mutationSigma: 0.05,
  mutationClampMin: -10.0,
  mutationClampMax: 10.0,
  maxSelfMatingRetries: 3,
});

/**
 * 遺伝的操作子設定値の不備を示すエラー (Fail-Fast)
 */
export class GeneticOperatorConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneticOperatorConfigurationError";
  }
}

/**
 * 遺伝的操作実行中のエラー (Fail-Closed)
 */
export class GeneticOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneticOperatorError";
  }
}

/**
 * 交叉対象の確定済み親ペア入力
 */
export interface GeneticParentPair {
  readonly parentA: SelectedParent;
  readonly parentB: SelectedParent;
}

/**
 * 子個体の系統メタデータ (Lineage DTO)
 *
 * 【最重要原則】
 * Fitness スコアは系統メタデータには絶対に記録しない。
 */
export interface OffspringLineageMetadata {
  /** 決定論的ゲノム識別子 (例: "gen-000012-offspring-000042") */
  readonly genomeId: string;
  /** 当該個体が属する世代番号 */
  readonly generation: number;
  /** 世代内のオフスプリングインデックス */
  readonly offspringIndex: number;
  /** 親個体のゲノム識別子配列 (通常 [parentAId, parentBId]) */
  readonly parentGenomeIds: readonly string[];
  /** 交叉オペレータ版数 */
  readonly crossoverOperatorVersion: "block-segmented-uniform-v1" | "none";
  /** 突然変異オペレータ版数 */
  readonly mutationOperatorVersion: "deterministic-normal-approx-v1" | "none";
  /** シード導出アルゴリズム版数 */
  readonly seedDerivationVersion: "derive-seed-fnv1a-v1";
  /** 子個体ベースシード */
  readonly offspringSeed: number;
  /** 交叉用独立シード */
  readonly crossoverSeed?: number;
  /** 突然変異用独立シード */
  readonly mutationSeed?: number;
}

/**
 * 生成された子個体実体と系統情報のペア
 */
export interface GeneratedOffspring {
  readonly dna: DecisionDNA;
  readonly lineage: OffspringLineageMetadata;
}

/**
 * 単一 Offspring 生成の入力パラメータ
 */
export interface GenerateOffspringParams {
  /** 確定済みの親ペア */
  readonly parentPair: GeneticParentPair;
  /** 目標世代番号 (非負整数) */
  readonly generation: number;
  /** 世代内のオフスプリングインデックス (非負整数) */
  readonly offspringIndex: number;
  /** 世代ベースシード */
  readonly generationSeed: number;
  /** オプションの遺伝操作設定 */
  readonly config?: Partial<GeneticOperatorConfig>;
}

/**
 * Evolution 用 Canonical Stream Key 定数
 */
export const EVOLUTION_SELECTION_STREAM_KEY = "evolution-selection-v1";
export const EVOLUTION_OFFSPRING_STREAM_PREFIX = "evolution-offspring-v1";
export const EVOLUTION_CROSSOVER_STREAM_KEY = "evolution-crossover-v1";
export const EVOLUTION_MUTATION_STREAM_KEY = "evolution-mutation-v1";
export const EVOLUTION_SELF_MATING_RETRY_PREFIX = "evolution-self-mating-retry-v1";

export const STREAM_KEY_SELECTION = EVOLUTION_SELECTION_STREAM_KEY;
export const STREAM_KEY_CROSSOVER = EVOLUTION_CROSSOVER_STREAM_KEY;
export const STREAM_KEY_MUTATION = EVOLUTION_MUTATION_STREAM_KEY;

/**
 * オフスプリングベースシード用 Stream Key を取得
 */
export function getOffspringStreamKey(offspringIndex: number): string {
  return `${EVOLUTION_OFFSPRING_STREAM_PREFIX}-${offspringIndex}`;
}

/**
 * 自己交配リトライ用 Stream Key を取得
 */
export function getSelfMatingRetryStreamKey(retryIndex: number): string {
  return `${EVOLUTION_SELF_MATING_RETRY_PREFIX}-${retryIndex}`;
}

export function selectionStreamKey(): string {
  return EVOLUTION_SELECTION_STREAM_KEY;
}

export function crossoverStreamKey(): string {
  return EVOLUTION_CROSSOVER_STREAM_KEY;
}

export function mutationStreamKey(): string {
  return EVOLUTION_MUTATION_STREAM_KEY;
}

export function offspringStreamKey(offspringIndex: number): string {
  return getOffspringStreamKey(offspringIndex);
}

export function selfMatingRetryStreamKey(retryIndex: number): string {
  return getSelfMatingRetryStreamKey(retryIndex);
}
