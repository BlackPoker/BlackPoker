import gen8CandidateJson from "../../data/ai/gen8-prod-g0-ind7-cross7.json";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { GenomePolicy } from "./GenomePolicy";
import { SemanticSHA256 } from "./SemanticSHA256";

/**
 * Gen 8 Candidate DNA の SHA-256 ダイジェストを算出
 * gen8HoldoutRunner.ts と完全に一致する正規化シリアライズを使用
 */
export function computeGen8DnaDigest(dna: unknown): string {
  return SemanticSHA256.hash(JSON.stringify(dna));
}

/**
 * Gen 8 Champion Candidate Contract Constants
 * Source: BP-SIM-AI-V92-WORK4-5-GEN8-OFFICIAL-HOLDOUT
 */
export const GEN8_CHAMPION_CANDIDATE_POLICY_ID = "gen8-champion-candidate" as const;
export const GEN8_CHAMPION_CANDIDATE_GENOME_ID = "gen8-prod-g0-ind7-cross7" as const;
export const GEN8_CHAMPION_CANDIDATE_FEATURE_SCHEMA_VERSION = 6 as const;
export const GEN8_CHAMPION_CANDIDATE_DNA_FORMAT_VERSION = 1 as const;
export const GEN8_CHAMPION_CANDIDATE_TOTAL_WEIGHTS = 23738 as const;
export const GEN8_CHAMPION_CANDIDATE_PATTERN_WEIGHTS_COUNT = 143 as const;
export const GEN8_CHAMPION_CANDIDATE_CONTEXT_PATTERN_WEIGHTS_COUNT = 23595 as const;

export const GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST =
  "11fff0f578c92af376eece46ff90f9eba3785e59d0cf64d5eeffc7967946445e" as const;

export const GEN8_CHAMPION_CANDIDATE_SUPPORTED_REGULATION_ID = "standard-pack" as const;
export const GEN8_CHAMPION_CANDIDATE_SUPPORTED_FRAME_ID = "pack" as const;

/**
 * UI 表示用メタデータ定義
 */
export interface Gen8PolicyUIInfo {
  readonly id: typeof GEN8_CHAMPION_CANDIDATE_POLICY_ID;
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

export const GEN8_CHAMPION_CANDIDATE_UI_INFO: Gen8PolicyUIInfo = {
  id: GEN8_CHAMPION_CANDIDATE_POLICY_ID,
  label: "Gen 8 Champion Candidate（正式Holdout検証済み）",
  description:
    "スタンダード＋パック向け進化AI。Gen 7との正式Holdout 240試合で147勝93敗。人間との対戦品質は評価中。",
  generation: "Gen 8 (g0-ind7-cross7)",
  baselineRecord: "正式Holdout 240試合 147勝93敗 (勝率61.25%, 95% CI [55.22%, 67.28%])",
  dnaSchema: "v6",
  humanPerformance: "評価中",
  disclaimer:
    "※正式Holdout 240試合でGen 7に統計的優位性 (p = 0.0001663) を確立。人間対戦における戦術の自然さ・操作感は現在評価中です。",
  fullDnaDigest: GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
  supportedRegulationId: GEN8_CHAMPION_CANDIDATE_SUPPORTED_REGULATION_ID,
};

/**
 * Gen 8 Candidate DNA を読み込み、Fail-Closed で厳密検証
 *
 * 合成 DNA へのフォールバックは厳格に禁止されており、
 * 不一致や破損時は必ず例外をスローして停止します。
 */
export function loadAndValidateGen8ChampionCandidateDNA(customDna?: unknown): DecisionDNA {
  const candidate = (customDna !== undefined ? customDna : gen8CandidateJson) as any;

  // 1. 基本形式検証 (Codec)
  DecisionDNACodec.validate(candidate);

  // 2. バージョン検証
  if (candidate.dnaFormatVersion !== GEN8_CHAMPION_CANDIDATE_DNA_FORMAT_VERSION) {
    throw new Error(
      `Gen 8 DNA validation failed: invalid dnaFormatVersion (expected ${GEN8_CHAMPION_CANDIDATE_DNA_FORMAT_VERSION}, got ${candidate.dnaFormatVersion})`
    );
  }

  if (candidate.featureSchemaVersion !== GEN8_CHAMPION_CANDIDATE_FEATURE_SCHEMA_VERSION) {
    throw new Error(
      `Gen 8 DNA validation failed: invalid featureSchemaVersion (expected ${GEN8_CHAMPION_CANDIDATE_FEATURE_SCHEMA_VERSION}, got ${candidate.featureSchemaVersion})`
    );
  }

  // 3. 重み数・次元数の厳密一致検証
  if (candidate.patternWeights.length !== GEN8_CHAMPION_CANDIDATE_PATTERN_WEIGHTS_COUNT) {
    throw new Error(
      `Gen 8 DNA validation failed: patternWeights length mismatch (expected ${GEN8_CHAMPION_CANDIDATE_PATTERN_WEIGHTS_COUNT}, got ${candidate.patternWeights.length})`
    );
  }

  if (
    candidate.contextPatternWeights.length !==
    GEN8_CHAMPION_CANDIDATE_CONTEXT_PATTERN_WEIGHTS_COUNT
  ) {
    throw new Error(
      `Gen 8 DNA validation failed: contextPatternWeights length mismatch (expected ${GEN8_CHAMPION_CANDIDATE_CONTEXT_PATTERN_WEIGHTS_COUNT}, got ${candidate.contextPatternWeights.length})`
    );
  }

  const totalWeights = candidate.patternWeights.length + candidate.contextPatternWeights.length;
  if (totalWeights !== GEN8_CHAMPION_CANDIDATE_TOTAL_WEIGHTS) {
    throw new Error(
      `Gen 8 DNA validation failed: totalWeights mismatch (expected ${GEN8_CHAMPION_CANDIDATE_TOTAL_WEIGHTS}, got ${totalWeights})`
    );
  }

  // 4. SHA-256 ダイジェスト厳密一致検証 (Fail-Closed)
  const computedFullDigest = computeGen8DnaDigest(candidate);
  if (computedFullDigest !== GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST) {
    throw new Error(
      `Gen 8 DNA digest mismatch (expected ${GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST}, computed ${computedFullDigest}). Execution locked.`
    );
  }

  return candidate as DecisionDNA;
}

/**
 * Gen 8 Champion Candidate 用 GenomePolicy を生成
 */
export function createGen8ChampionCandidatePolicy(customDna?: unknown): GenomePolicy {
  const verifiedDna = loadAndValidateGen8ChampionCandidateDNA(customDna);
  return new GenomePolicy(verifiedDna, "Gen 8 Champion Candidate");
}
