import evolutionG1BestJson from "../../data/ai/evolution-g1-best-v6.json";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { GenomePolicy } from "./GenomePolicy";
import { SemanticSHA256 } from "./SemanticSHA256";

/**
 * Evolution g1 Best Individual Contract Constants
 * Source Baseline: BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1-R1
 */
export const EVOLUTION_G1_BEST_POLICY_ID = "evolution-g1-best" as const;
export const EVOLUTION_G1_BEST_GENOME_ID = "gen-000001-offspring-000003" as const;
export const EVOLUTION_G1_BEST_GENERATION = 1 as const;
export const EVOLUTION_G1_BEST_FEATURE_SCHEMA_VERSION = 6 as const;
export const EVOLUTION_G1_BEST_DNA_FORMAT_VERSION = 1 as const;
export const EVOLUTION_G1_BEST_TOTAL_WEIGHTS = 23738 as const;
export const EVOLUTION_G1_BEST_PATTERN_WEIGHTS_COUNT = 143 as const;
export const EVOLUTION_G1_BEST_CONTEXT_PATTERN_WEIGHTS_COUNT = 23595 as const;

export const EVOLUTION_G1_BEST_FULL_DIGEST =
  "e5f69e36c3dac0f4700d6013d92a5471009f1b185078ebf168e082193c14502b" as const;
export const EVOLUTION_G1_BEST_PATTERN_DIGEST =
  "7299c74dfe2518640dbdc271c21a1a687bcc21c915430cf82217e476594cd5c8" as const;
export const EVOLUTION_G1_BEST_CONTEXT_PATTERN_DIGEST =
  "e7dac493883cfecc0bd777d04bb54e353f8112e244db77557a0267351f29b950" as const;

export const EVOLUTION_G1_BEST_SUPPORTED_REGULATION_ID = "light-entry16" as const;

/**
 * UI 表示用メタデータ定義
 */
export interface EvolutionPolicyUIInfo {
  readonly id: typeof EVOLUTION_G1_BEST_POLICY_ID;
  readonly label: string;
  readonly description: string;
  readonly generation: string;
  readonly baselineRecord: string;
  readonly dnaSchema: string;
  readonly humanPerformance: string;
  readonly disclaimer: string;
  readonly fullDnaDigest: string;
  readonly supportedRegulationId: string;
}

export const EVOLUTION_G1_BEST_UI_INFO: EvolutionPolicyUIInfo = {
  id: EVOLUTION_G1_BEST_POLICY_ID,
  label: "Evolution g1 Best (Experimental)",
  description: "進化学習で生成されたGenome AI。Baseline内で9勝1敗。対人戦の強さは未検証です。",
  generation: "g1",
  baselineRecord: "9勝1敗",
  dnaSchema: "v6",
  humanPerformance: "未評価",
  disclaimer: "※「9勝1敗」は同一世代母集団内での実験戦績であり、対人戦での一般的な強さを保証するものではありません。",
  fullDnaDigest: EVOLUTION_G1_BEST_FULL_DIGEST,
  supportedRegulationId: EVOLUTION_G1_BEST_SUPPORTED_REGULATION_ID,
};

/**
 * DNA の全重み・構成情報から SHA-256 ダイジェストを算出 (SemanticSHA256使用)
 */
export function computeFullDnaDigest(dna: DecisionDNA): string {
  const canonical = JSON.stringify({
    dnaFormatVersion: dna.dnaFormatVersion,
    featureSchemaVersion: dna.featureSchemaVersion,
    scoringModel: dna.scoringModel,
    contextDimension: dna.contextDimension,
    patternDimension: dna.patternDimension,
    patternWeights: dna.patternWeights,
    contextPatternWeights: dna.contextPatternWeights,
  });
  return SemanticSHA256.hash(canonical);
}

/**
 * Pattern重み配列の SHA-256 ダイジェストを算出
 */
export function computePatternWeightsDigest(dna: DecisionDNA): string {
  return SemanticSHA256.hash(JSON.stringify(dna.patternWeights));
}

/**
 * Context-Pattern重み配列の SHA-256 ダイジェストを算出
 */
export function computeContextPatternWeightsDigest(dna: DecisionDNA): string {
  return SemanticSHA256.hash(JSON.stringify(dna.contextPatternWeights));
}

/**
 * 保存済み DNA Artifact を読み込み、Fail-Closed で厳密検証
 */
export function loadAndValidateEvolutionG1BestDNA(customDna?: unknown): DecisionDNA {
  const candidate = (customDna ?? evolutionG1BestJson) as any;

  // 1. 基本形式検証 (Codec)
  DecisionDNACodec.validate(candidate);

  // 2. バージョン検証
  if (candidate.dnaFormatVersion !== EVOLUTION_G1_BEST_DNA_FORMAT_VERSION) {
    throw new Error(
      `Evolution DNA validation failed: invalid dnaFormatVersion (expected ${EVOLUTION_G1_BEST_DNA_FORMAT_VERSION}, got ${candidate.dnaFormatVersion})`
    );
  }
  if (candidate.featureSchemaVersion !== EVOLUTION_G1_BEST_FEATURE_SCHEMA_VERSION) {
    throw new Error(
      `Evolution DNA validation failed: invalid featureSchemaVersion (expected ${EVOLUTION_G1_BEST_FEATURE_SCHEMA_VERSION}, got ${candidate.featureSchemaVersion})`
    );
  }

  // 3. 次元数および重み長検証
  if (candidate.patternWeights.length !== EVOLUTION_G1_BEST_PATTERN_WEIGHTS_COUNT) {
    throw new Error(
      `Evolution DNA validation failed: invalid patternWeights length (expected ${EVOLUTION_G1_BEST_PATTERN_WEIGHTS_COUNT}, got ${candidate.patternWeights.length})`
    );
  }
  if (candidate.contextPatternWeights.length !== EVOLUTION_G1_BEST_CONTEXT_PATTERN_WEIGHTS_COUNT) {
    throw new Error(
      `Evolution DNA validation failed: invalid contextPatternWeights length (expected ${EVOLUTION_G1_BEST_CONTEXT_PATTERN_WEIGHTS_COUNT}, got ${candidate.contextPatternWeights.length})`
    );
  }

  // 4. メタデータ検証
  if (candidate.metadata?.id !== EVOLUTION_G1_BEST_GENOME_ID) {
    throw new Error(
      `Evolution DNA validation failed: genomeId mismatch (expected ${EVOLUTION_G1_BEST_GENOME_ID}, got ${candidate.metadata?.id})`
    );
  }

  // 5. SHA-256 ダイジェスト検証
  const fullDigest = computeFullDnaDigest(candidate);
  if (fullDigest !== EVOLUTION_G1_BEST_FULL_DIGEST) {
    throw new Error(
      `Evolution DNA validation failed: fullDnaDigest mismatch! (expected ${EVOLUTION_G1_BEST_FULL_DIGEST}, got ${fullDigest})`
    );
  }

  return candidate as DecisionDNA;
}

/**
 * 検証済み DNA を渡して GenomePolicy インスタンスを生成
 * 不正時は例外を投げて Fail-Closed とし、ZeroGenome や FirstLegal へ無断フォールバックしない
 */
export function createEvolutionG1BestPolicy(customDna?: unknown): GenomePolicy {
  const validatedDna = loadAndValidateEvolutionG1BestDNA(customDna);
  return new GenomePolicy(validatedDna, "Evolution g1 Best (Experimental)");
}
