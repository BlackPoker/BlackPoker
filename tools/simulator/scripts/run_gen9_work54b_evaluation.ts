/**
 * run_gen9_work54b_evaluation.ts
 *
 * BlackPoker Simulator - Gen 9 PASS戦術評価の適用条件改善後の限定評価 (Work 5-4B Evidence Correction)
 *
 * 【検証目的】
 * 1. 未使用の診断用 Seed (780001〜780030, 30ペア＝60試合) を用いて、
 *    Gen 8, Work 5-1 R4, G0人手設計個体 (G0_IND2, G0_IND7), G3進化個体 (G3_IND3) について
 *    修正前 (v7.1-unified-block-assignment) と修正後 (v7.2-unified-block-conditional-pass) を比較。
 * 2. 【Work 5-4B Evidence Correction】:
 *    過去の誤った重み設定 (G0 IND7 が R4 相当、G3 IND3 が確定値と不一致) を、
 *    正本 (Gen9BenchmarkWeights.ts / Work 5-3 / Work 5-4A) の確定値へ修正して全対戦を再計測。
 * 3. 相手リクエスト存在下で、有効な対抗手段がない場合の PASS 減点免除が正しく作動した件数、
 *    および不要なアクション (action.packOpen 等) から PASS への選択復帰件数を計測。
 * 4. 過去の結果ファイル (.artifacts/gen9-work5-2-*.json, .artifacts/gen9-work5-3-*.json,
 *    .artifacts/gen9-work5-4a-block-evaluation.json, .artifacts/gen9-work5-4b-pass-evaluation.json) は
 *    一切上書きせず SHA-256 により保護し、新規ファイル
 *    .artifacts/gen9-work5-4b-pass-evaluation-corrected.json に保存する。
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { performance } from "perf_hooks";
import { loadRegulationCatalog } from "../src/engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../src/engine/rules/RuleLoader.js";
import { OfficialRegulationMatchSetup } from "../src/engine/regulation/OfficialRegulationMatchSetup.js";
import { GameSession } from "../src/engine/session/GameSession.js";
import { SimulationRunner } from "../src/engine/simulation/SimulationRunner.js";
import { DecisionPolicy, PolicyDescriptor } from "../src/engine/simulation/DecisionPolicy.js";
import { GenomePolicy } from "../src/engine/ai/GenomePolicy.js";
import { Gen9TacticalPrototypePolicy } from "../src/engine/ai/Gen9TacticalPrototypePolicy.js";
import {
  Gen9LearnableTacticalPolicy,
  Gen9TacticalGenome,
  fromV6DNA,
  hasEffectiveCounterMeasure,
  TACTICAL_FEATURE_ENCODER_VERSION_V71,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
} from "../src/engine/ai/Gen9LearnableTacticalPolicy.js";
import {
  G0_IND2_WEIGHTS,
  G0_IND7_WEIGHTS,
  G3_IND3_WEIGHTS,
  R4_PRESET_TACTICAL_WEIGHTS,
  GEN9_TACTICAL_FEATURE_DEFINITIONS,
  formatTacticalWeightsWithDefinitions,
} from "../src/engine/ai/Gen9BenchmarkWeights.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";

// =============================================================================
// 1. 禁止 Seed 範囲の厳格保護 (Holdout・Training・Validation・過去診断 Seed を完全ブロック)
// =============================================================================
export const WORK54B_FORBIDDEN_SEED_RANGES: readonly {
  name: string;
  start: number;
  end: number;
}[] = [
  { name: "Official Holdout v1", start: 95001, end: 95030 },
  { name: "Official Holdout v2", start: 250001, end: 250120 },
  { name: "Future Final Holdout", start: 350001, end: 350300 },
  { name: "Work 5-1 Benchmark Seeds", start: 500001, end: 500030 },
  { name: "Work 5-1 R2/R3 Validation Seeds", start: 600001, end: 600030 },
  { name: "Work 5-2 Baseline Seeds", start: 700001, end: 700050 },
  { name: "Work 5-2 R1 Training Seeds", start: 710001, end: 710400 },
  { name: "Work 5-2 R1 Validation Seeds", start: 720001, end: 720050 },
  { name: "Work 5-2 R2 Training Seeds", start: 730001, end: 730400 },
  { name: "Work 5-2 R2 Selection Arena Seeds", start: 740001, end: 740100 },
  { name: "Work 5-2 R2 Final Comparison Seeds", start: 750001, end: 750100 },
  { name: "Work 5-3 Diagnostic Seeds", start: 760001, end: 760030 },
  { name: "Work 5-4A Diagnostic Seeds", start: 770001, end: 770030 },
  { name: "Original Human Diagnostic Seed", start: 4127992094, end: 4127992094 },
];

export const WORK54B_DIAGNOSTIC_SEEDS: readonly number[] = Object.freeze(
  Array.from({ length: 30 }, (_, i) => 780001 + i)
);

export function assertWork54BSafeSeedRange(
  label: string,
  start: number,
  count: number
): void {
  const end = start + count - 1;
  for (const forbidden of WORK54B_FORBIDDEN_SEED_RANGES) {
    const overlaps =
      Math.max(start, forbidden.start) <= Math.min(end, forbidden.end);
    if (overlaps) {
      throw new Error(
        `[SEED_VIOLATION] ${label} (${start}..${end}) が禁止領域 ${forbidden.name} (${forbidden.start}..${forbidden.end}) と重複しています`
      );
    }
  }
}

// =============================================================================
// 2. 過去の誤った重み定義 (証跡記録・無効化区別用)
// =============================================================================
export const DEPRECATED_INVALID_G0_IND7_WEIGHTS: readonly number[] = Object.freeze([
  -2.5, -0.8, -0.35, -1.8, -0.5, -0.25,
  +2.2, +1.8, +1.0, +0.2,
  +0.2, +0.25, +0.05, -0.35, +0.2, -2.5, -0.5,
  +0.1, +2.0, +2.5,
]);

export const DEPRECATED_INVALID_G3_IND3_WEIGHTS: readonly number[] = Object.freeze([
  -2.2858, -0.8719, -0.3671, -1.6115, -0.4908, -0.2764,
  +2.1384, +1.6429, +0.9412, +0.1873,
  +0.2195, +0.2743, +0.0489, -0.3217, +0.2148, -2.3912, -0.5218,
  +0.0914, +2.1042, +2.3871,
]);

// =============================================================================
// 3. 計測用ラッパーおよび統計関数
// =============================================================================
class TimedPolicyWrapper implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  private readonly target: DecisionPolicy;
  public totalDecisions = 0;
  public totalTimeNs = 0n;

  constructor(target: DecisionPolicy) {
    this.target = target;
    this.descriptor = target.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const t0 = process.hrtime.bigint();
    const res = this.target.choose(request);
    const t1 = process.hrtime.bigint();
    this.totalTimeNs += t1 - t0;
    this.totalDecisions++;
    return res;
  }
}

function calculateConfidenceInterval(wins: number, total: number): {
  lower: number;
  upper: number;
} {
  if (total <= 0) return { lower: 0, upper: 0 };
  const z = 1.96;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const spread =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
    denominator;
  return {
    lower: Math.max(0, Number((center - spread).toFixed(4))),
    upper: Math.min(1, Number((center + spread).toFixed(4))),
  };
}

export interface SeatSwappedMatchSummary {
  readonly matchupName: string;
  readonly policyAName: string;
  readonly policyBName: string;
  readonly encoderVersionA: string;
  readonly encoderVersionB: string;
  readonly seedPairs: number;
  readonly totalMatches: number;
  readonly winsA: number;
  readonly winsB: number;
  readonly draws: number;
  readonly winRateA: number;
  readonly confidenceIntervalA: { lower: number; upper: number };
  readonly avgDecisionTimeUsA: number;
  readonly avgDecisionTimeUsB: number;
  readonly exceptions: number;
  readonly incompleteOrFailed: number;
}

function runSeatSwappedMatchup(params: {
  reg: any;
  frame: any;
  rulePackage: any;
  seeds: readonly number[];
  matchupName: string;
  policyA: DecisionPolicy;
  policyB: DecisionPolicy;
  encoderVersionA: string;
  encoderVersionB: string;
  checkTimeout: () => void;
}): SeatSwappedMatchSummary {
  const {
    reg,
    frame,
    rulePackage,
    seeds,
    matchupName,
    policyA,
    policyB,
    encoderVersionA,
    encoderVersionB,
    checkTimeout,
  } = params;

  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let exceptions = 0;
  let incompleteOrFailed = 0;
  const timedA = new TimedPolicyWrapper(policyA);
  const timedB = new TimedPolicyWrapper(policyB);

  const origLog = console.log;
  try {
    console.log = () => {};
    for (const seed of seeds) {
      checkTimeout();
      for (const aIsP1 of [true, false]) {
        try {
          const setup = OfficialRegulationMatchSetup.setupMatch(
            reg,
            frame,
            rulePackage,
            seed,
            {
              playerNames: aIsP1
                ? { p1: policyA.descriptor.name, p2: policyB.descriptor.name }
                : { p1: policyB.descriptor.name, p2: policyA.descriptor.name },
            }
          );
          const session = new GameSession((setup as any).state, rulePackage, {
            matchSeed: seed,
          });
          const simRes = SimulationRunner.run(
            session,
            aIsP1 ? { p1: timedA, p2: timedB } : { p1: timedB, p2: timedA },
            { maxDecisions: 1000 }
          );

          const targetSeat = aIsP1 ? "p1" : "p2";
          if (!simRes.completed) {
            // INCOMPLETE や FAILED は決して DRAW と混同しない
            incompleteOrFailed++;
          } else if (simRes.winner === targetSeat) {
            winsA++;
          } else if (
            simRes.winner !== undefined &&
            simRes.winner !== "draw" &&
            simRes.winner !== targetSeat
          ) {
            winsB++;
          } else if (simRes.winner === "draw") {
            draws++;
          } else {
            incompleteOrFailed++;
          }
        } catch {
          exceptions++;
        }
      }
    }
  } finally {
    console.log = origLog;
  }

  const totalMatches = seeds.length * 2;
  const winRateA = (winsA + 0.5 * draws) / totalMatches;
  const avgDecisionTimeUsA =
    timedA.totalDecisions > 0
      ? Number(timedA.totalTimeNs) / 1000 / timedA.totalDecisions
      : 0;
  const avgDecisionTimeUsB =
    timedB.totalDecisions > 0
      ? Number(timedB.totalTimeNs) / 1000 / timedB.totalDecisions
      : 0;

  return {
    matchupName,
    policyAName: policyA.descriptor.name,
    policyBName: policyB.descriptor.name,
    encoderVersionA,
    encoderVersionB,
    seedPairs: seeds.length,
    totalMatches,
    winsA,
    winsB,
    draws,
    winRateA: Number(winRateA.toFixed(4)),
    confidenceIntervalA: calculateConfidenceInterval(winsA + 0.5 * draws, totalMatches),
    avgDecisionTimeUsA: Number(avgDecisionTimeUsA.toFixed(2)),
    avgDecisionTimeUsB: Number(avgDecisionTimeUsB.toFixed(2)),
    exceptions,
    incompleteOrFailed,
  };
}

/**
 * 作業ツリーが完全にクリーンであり、指定コミットに必要ファイルが存在することを厳格に検証
 */
export function assertCleanCommitState(
  rootDir: string,
  options?: { allowDirtyForTesting?: boolean }
): { gitSha: string; commitTimeIso: string } {
  // A. Git リポジトリのトップレベルディレクトリを取得
  let repoRoot = rootDir;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", { cwd: rootDir, encoding: "utf8" }).trim();
  } catch {
    repoRoot = rootDir;
  }

  // B. 40桁のコミットSHAを取得
  let gitSha: string;
  try {
    gitSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
    if (!gitSha || !/^[0-9a-f]{40}$/i.test(gitSha)) {
      throw new Error(`無効な Git SHA 形式: "${gitSha}"`);
    }
  } catch (err: any) {
    throw new Error(`[FATAL] Git SHA の取得に失敗しました: ${err.message || err}`);
  }

  // C. 作業ツリーのクリーン性を検証 (git status --porcelain)
  if (!options?.allowDirtyForTesting) {
    const statusOutput = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" }).trim();
    if (statusOutput.length > 0) {
      const dirtyLines = statusOutput
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (dirtyLines.length > 0) {
        throw new Error(
          `[DIRTY_WORKTREE_ERROR] 作業ツリーに未コミットの変更が存在するため評価を開始できません:\n` +
            dirtyLines.map((l) => `  ${l}`).join("\n") +
            `\n必ず先にコミット・プッシュを完了し、クリーンな作業ツリーで実行してください。`
        );
      }
    }
  }

  // D. 評価スクリプトおよび重み定義が当該コミットに含まれていることを確認 (repoRoot基準)
  const requiredTrackedFiles = [
    "tools/simulator/scripts/run_gen9_work54b_evaluation.ts",
    "tools/simulator/src/engine/ai/Gen9BenchmarkWeights.ts",
    "tools/simulator/src/engine/ai/Gen9LearnableTacticalPolicy.ts",
  ];
  for (const relPath of requiredTrackedFiles) {
    try {
      const lsOutput = execSync(`git ls-tree HEAD ${relPath}`, { cwd: repoRoot, encoding: "utf8" }).trim();
      if (!lsOutput) {
        throw new Error(`ファイルが見つかりません`);
      }
    } catch {
      throw new Error(`[UNTRACKED_FILE_ERROR] 必要なファイル ${relPath} が HEAD コミットに含まれていません`);
    }
  }

  // E. コミット時刻を取得
  const commitTimeIso = execSync("git log -1 --format=%cI HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();

  return { gitSha, commitTimeIso };
}

export interface ExecutionEnvironmentParams {
  gitSha: string;
  commitTimeIso: string;
  workingTreeClean: boolean;
  rulePackage: { id: string; version: string };
  regulationLookupKey: string;
  regulation: { id: string } | undefined | null;
  frameLookupKey: string;
  frame: { id: string } | undefined | null;
  tacticalEncoderVersion: string;
}

export interface ExecutionEnvironmentMetadata {
  gitCommitSha: string;
  commitTimeIso: string;
  workingTreeClean: boolean;
  rulePackageId: string;
  rulePackageVersion: string;
  regulationLookupKey: string;
  regulationId: string;
  frameLookupKey: string;
  frameId: string;
  tacticalEncoderVersion: string;
}

/**
 * 実際に評価へ渡したオブジェクトから評価環境メタデータを生成する純粋関数 (Work 5-4B R3 修正A)
 */
export function buildExecutionEnvironmentMetadata(
  params: ExecutionEnvironmentParams
): ExecutionEnvironmentMetadata {
  if (!params.regulation || !params.regulation.id) {
    throw new Error(
      `[REGULATION_NOT_FOUND_ERROR] レギュレーション "${params.regulationLookupKey}" が見つからないか、IDが無効です`
    );
  }
  if (!params.frame || !params.frame.id) {
    throw new Error(
      `[FRAME_NOT_FOUND_ERROR] フレーム "${params.frameLookupKey}" が見つからないか、IDが無効です`
    );
  }

  return {
    gitCommitSha: params.gitSha,
    commitTimeIso: params.commitTimeIso,
    workingTreeClean: params.workingTreeClean,
    rulePackageId: params.rulePackage.id,
    rulePackageVersion: params.rulePackage.version,
    regulationLookupKey: params.regulationLookupKey,
    regulationId: params.regulation.id,
    frameLookupKey: params.frameLookupKey,
    frameId: params.frame.id,
    tacticalEncoderVersion: params.tacticalEncoderVersion,
  };
}

export interface PastEvidenceVerificationItem {
  readonly fileName: string;
  readonly classification: "ORIGINAL" | "REGENERATED" | "INVALID" | "UNVERIFIED" | "NOT_FOUND";
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly valid: boolean;
  readonly provenanceDescription: string;
}

/**
 * 過去 Evidence ファイルの SHA-256 チェックおよび原本/再生成の明確な分類 (作業B)
 */
export function verifyPastEvidenceIntegrity(artifactsDir: string): Record<string, PastEvidenceVerificationItem> {
  const WORK54A_ORIGINAL_SHA256 = "26947bc8a97e407a59e40b7266decaf1635aac14094e342cbf10d4ad4b8128fa";
  const WORK54A_REGENERATED_SHA256 = "85c78cae212bce0f056fa8bf06fb5a2ac7257cb76345a090abfbd2023b9881c3";

  const pastRules: Record<
    string,
    {
      originalSha256: string;
      description: string;
      altHashes?: { sha256: string; classification: "REGENERATED"; description: string }[];
    }
  > = {
    "gen9-work5-2-pilot-results.json": {
      originalSha256: "73de7dd1723f98772d9eb4202754b5bf882f987c517b83ba66851442c6c846b9",
      description: "Work 5-2 パイロット学習結果 (G0 Ind7 選抜確定原本)",
    },
    "gen9-work5-2-r2-results.json": {
      originalSha256: "f5099704b4b3e49f03f45e8612f96e25a71418e2f2004de6027df36de7715c01",
      description: "Work 5-2 R2 世代間公平比較結果 (G0 Ind7 vs G3 Ind3 確定原本)",
    },
    "gen9-work5-3-sensitivity-analysis.json": {
      originalSha256: "c2275dd0ac2fbbc9a7a1b9d4dad7c79427f2e4d650d23cd015f63ae6579e6c83",
      description: "Work 5-3 意思決定差分・感度分析結果 (確定原本)",
    },
    "gen9-work5-4a-block-evaluation.json": {
      originalSha256: WORK54A_ORIGINAL_SHA256,
      description: "Work 5-4A 通常ブロック戦術評価修正限定評価 (コミット 57e97e5 時点確定原本)",
      altHashes: [
        {
          sha256: WORK54A_REGENERATED_SHA256,
          classification: "REGENERATED",
          description: "テストimport副作用によりWork 5-4B環境(HEAD 8f43434, v7.2)で同一シミュレーションが再実行された生成ファイル",
        },
      ],
    },
    "gen9-work5-4b-pass-evaluation.json": {
      originalSha256: "ed3daf4c718e5fde64722323e09faeb673999b920f52b6feb3b404d78dcc0f0b",
      description: "Work 5-4B 初回評価結果 (重み設定不一致により無効化・保護された旧成果物)",
    },
    "gen9-work5-4b-pass-evaluation-corrected.json": {
      originalSha256: "f7bf8beb9dbd797c9a20f6463977d2125b8d76a8a943b5ec71e81612b05f425b",
      description: "Work 5-4B 重み修正後限定評価結果 (コミット 8f43434 HEAD で計測された確定原本)",
    },
  };

  const results: Record<string, PastEvidenceVerificationItem> = {};

  for (const [fileName, rule] of Object.entries(pastRules)) {
    const fullPath = path.join(artifactsDir, fileName);
    if (!fs.existsSync(fullPath)) {
      results[fileName] = {
        fileName,
        classification: "NOT_FOUND",
        expectedSha256: rule.originalSha256,
        actualSha256: "NOT_FOUND",
        valid: false,
        provenanceDescription: "ファイルが存在しません",
      };
      continue;
    }

    const content = fs.readFileSync(fullPath);
    const actual = crypto.createHash("sha256").update(content).digest("hex").toLowerCase();

    if (actual === rule.originalSha256.toLowerCase()) {
      results[fileName] = {
        fileName,
        classification: "ORIGINAL",
        expectedSha256: rule.originalSha256,
        actualSha256: actual,
        valid: true,
        provenanceDescription: rule.description,
      };
    } else {
      const matchedAlt = rule.altHashes?.find((a) => a.sha256.toLowerCase() === actual);
      if (matchedAlt) {
        results[fileName] = {
          fileName,
          classification: matchedAlt.classification,
          expectedSha256: rule.originalSha256,
          actualSha256: actual,
          valid: true,
          provenanceDescription: matchedAlt.description,
        };
      } else {
        results[fileName] = {
          fileName,
          classification: "INVALID",
          expectedSha256: rule.originalSha256,
          actualSha256: actual,
          valid: false,
          provenanceDescription: `未知の改変または破損が検出されました (期待=${rule.originalSha256}, 実際=${actual})`,
        };
        throw new Error(
          `[EVIDENCE_CORRUPTION] 過去 Evidence ファイル ${fileName} のハッシュが正本および既知の再生成版のいずれとも一致しません: 実際=${actual}`
        );
      }
    }
  }

  return results;
}

// =============================================================================
// 4. メイン実行関数
// =============================================================================
export async function main() {
  const startTime = Date.now();
  const SCRIPT_TIMEOUT_MS = 900_000; // 15分タイムアウト保護
  const checkTimeout = () => {
    if (Date.now() - startTime > SCRIPT_TIMEOUT_MS) {
      throw new Error(`[TIMEOUT] スクリプトの実行時間が ${SCRIPT_TIMEOUT_MS / 1000} 秒を超過しました`);
    }
  };

  console.log("================================================================================");
  console.log(" BlackPoker — Gen 9 Work 5-4B Evidence 最終整備限定評価 (Work 5-4B R2)");
  console.log("================================================================================");

  // 1. 禁止 Seed 範囲チェック
  assertWork54BSafeSeedRange("Work 5-4B Diagnostic", 780001, 30);
  console.log("[SEED_AUDIT_PASS] 診断 Seed 780001..780030 は全禁止領域から完全に隔離されています");

  // 2. ルートディレクトリとコミット状態の厳格検証 (作業A)
  const rootDir = process.cwd();
  const { gitSha, commitTimeIso } = assertCleanCommitState(rootDir);
  console.log(`[GIT_COMMIT_VERIFIED] HEAD Commit: ${gitSha} (CommitTime: ${commitTimeIso})`);
  console.log(`[WORKTREE_VERIFIED] 作業ツリーは完全にクリーンです (未コミット変更なし)`);

  // 3. ルールおよび Gen 8 Champion DNA のロード
  const rulesDir = path.resolve(rootDir, "src/data/rules-vnext");
  const regulationsDir = path.resolve(rootDir, "src/data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const regulationLookupKey = "standard-pack";
  const frameLookupKey = "pack";
  const reg = catalog.regulations.get(regulationLookupKey);
  if (!reg) {
    throw new Error(`[REGULATION_NOT_FOUND_ERROR] レギュレーション "${regulationLookupKey}" が catalog.regulations に存在しません`);
  }
  const frame = catalog.frames.get(frameLookupKey);
  if (!frame) {
    throw new Error(`[FRAME_NOT_FOUND_ERROR] フレーム "${frameLookupKey}" が catalog.frames に存在しません`);
  }

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);
  Gen9TacticalPrototypePolicy.setDefaultEvaluator(tacticalEvaluator);

  const gen8Candidate = createGen8ChampionCandidatePolicy();
  const gen8DNA: DecisionDNA = DecisionDNACodec.clone((gen8Candidate as any).dna);

  // 4. 各 Policy インスタンスの作成 (v7.1 vs v7.2 - 正本重み使用)
  const r4V71 = new Gen9TacticalPrototypePolicy(
    gen8DNA,
    "Work51_R4_v7.1",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V71
  );
  const r4V72 = new Gen9TacticalPrototypePolicy(
    gen8DNA,
    "Work51_R4_v7.2",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V72
  );

  const g0Ind2GenomeV71 = fromV6DNA(gen8DNA, G0_IND2_WEIGHTS, {
    id: "g0-ind2-v71",
    encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V71,
  });
  const g0Ind2GenomeV72 = fromV6DNA(gen8DNA, G0_IND2_WEIGHTS, {
    id: "g0-ind2-v72",
    encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V72,
  });
  const g0Ind2V71 = new Gen9LearnableTacticalPolicy(g0Ind2GenomeV71, "G0_IND2_v7.1", tacticalEvaluator);
  const g0Ind2V72 = new Gen9LearnableTacticalPolicy(g0Ind2GenomeV72, "G0_IND2_v7.2", tacticalEvaluator);

  // 【修正】G0_IND7_WEIGHTS は正本 (Gen9BenchmarkWeights.ts) から import された確定値
  const g0Ind7GenomeV71 = fromV6DNA(gen8DNA, G0_IND7_WEIGHTS, {
    id: "g0-ind7-v71",
    encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V71,
  });
  const g0Ind7GenomeV72 = fromV6DNA(gen8DNA, G0_IND7_WEIGHTS, {
    id: "g0-ind7-v72",
    encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V72,
  });
  const g0Ind7V71 = new Gen9LearnableTacticalPolicy(g0Ind7GenomeV71, "G0_IND7_v7.1", tacticalEvaluator);
  const g0Ind7V72 = new Gen9LearnableTacticalPolicy(g0Ind7GenomeV72, "G0_IND7_v7.2", tacticalEvaluator);

  // 【修正】G3_IND3_WEIGHTS は正本 (Gen9BenchmarkWeights.ts) から import された確定値
  const g3Ind3GenomeV71 = fromV6DNA(gen8DNA, G3_IND3_WEIGHTS, {
    id: "g3-ind3-v71",
    encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V71,
  });
  const g3Ind3GenomeV72 = fromV6DNA(gen8DNA, G3_IND3_WEIGHTS, {
    id: "g3-ind3-v72",
    encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V72,
  });
  const g3Ind3V71 = new Gen9LearnableTacticalPolicy(g3Ind3GenomeV71, "G3_IND3_v7.1", tacticalEvaluator);
  const g3Ind3V72 = new Gen9LearnableTacticalPolicy(g3Ind3GenomeV72, "G3_IND3_v7.2", tacticalEvaluator);

  const gen8Baseline = new GenomePolicy(gen8DNA, "Gen8_Champion");

  // ===========================================================================
  // Part 1: シャドウ評価（同一 DecisionRequest における PASS 戦術評価・分岐計測）
  // ===========================================================================
  console.log("\n[Part 1] 同一 DecisionRequest シャドウ評価 (正本重みによる作動・分岐調査)...");

  let totalDecisions = 0;
  let stageRequestDecisions = 0;
  let oppRequestWithCounter = 0;
  let oppRequestWithoutCounter = 0;
  let passPenaltyExemptedCount = 0;
  let decisionDivergedCountR4 = 0;
  let decisionDivergedCountG0Ind7 = 0;
  let decisionDivergedCountG3Ind3 = 0;
  let packOpenAvoidedToPassR4 = 0;
  let packOpenAvoidedToPassG0Ind7 = 0;
  let packOpenAvoidedToPassG3Ind3 = 0;

  class ShadowRecorderPolicy implements DecisionPolicy {
    public readonly descriptor: PolicyDescriptor;
    private readonly primary: DecisionPolicy;

    constructor(primary: DecisionPolicy) {
      this.primary = primary;
      this.descriptor = primary.descriptor;
    }

    public choose(request: Readonly<DecisionRequest>): DecisionResponse {
      totalDecisions++;

      const obs = request.observation;
      const selfKey = request.playerId;
      const oppRequests = (obs.stageRequests ?? []).filter((r) => r.controller !== selfKey);

      if (oppRequests.length > 0) {
        stageRequestDecisions++;
        const primaryOppReq = oppRequests[oppRequests.length - 1];
        const reqOutcome = tacticalEvaluator.evaluateRequestOutcome(primaryOppReq, selfKey, obs);

        const hasCounter = hasEffectiveCounterMeasure(
          request,
          primaryOppReq,
          reqOutcome,
          tacticalEvaluator
        );

        if (hasCounter) {
          oppRequestWithCounter++;
        } else {
          oppRequestWithoutCounter++;
          passPenaltyExemptedCount++;
        }
      }

      // R4 比較
      const choiceR4V71 = r4V71.choose(request);
      const choiceR4V72 = r4V72.choose(request);
      if (choiceR4V71.selectedPatternRef !== choiceR4V72.selectedPatternRef) {
        decisionDivergedCountR4++;
        const pat71 = request.patterns[choiceR4V71.selectedPatternRef];
        const pat72 = request.patterns[choiceR4V72.selectedPatternRef];
        const act71 =
          pat71.actionSelectionRef !== undefined
            ? request.catalog.actions[pat71.actionSelectionRef]?.actionId
            : pat71.kind;
        if (act71 === "action.packOpen" && pat72.kind === "PASS") {
          packOpenAvoidedToPassR4++;
        }
      }

      // G0_IND7 (正本重み) 比較
      const choiceG0V71 = g0Ind7V71.choose(request);
      const choiceG0V72 = g0Ind7V72.choose(request);
      if (choiceG0V71.selectedPatternRef !== choiceG0V72.selectedPatternRef) {
        decisionDivergedCountG0Ind7++;
        const pat71 = request.patterns[choiceG0V71.selectedPatternRef];
        const pat72 = request.patterns[choiceG0V72.selectedPatternRef];
        const act71 =
          pat71.actionSelectionRef !== undefined
            ? request.catalog.actions[pat71.actionSelectionRef]?.actionId
            : pat71.kind;
        if (act71 === "action.packOpen" && pat72.kind === "PASS") {
          packOpenAvoidedToPassG0Ind7++;
        }
      }

      // G3_IND3 (正本重み) 比較
      const choiceG3V71 = g3Ind3V71.choose(request);
      const choiceG3V72 = g3Ind3V72.choose(request);
      if (choiceG3V71.selectedPatternRef !== choiceG3V72.selectedPatternRef) {
        decisionDivergedCountG3Ind3++;
        const pat71 = request.patterns[choiceG3V71.selectedPatternRef];
        const pat72 = request.patterns[choiceG3V72.selectedPatternRef];
        const act71 =
          pat71.actionSelectionRef !== undefined
            ? request.catalog.actions[pat71.actionSelectionRef]?.actionId
            : pat71.kind;
        if (act71 === "action.packOpen" && pat72.kind === "PASS") {
          packOpenAvoidedToPassG3Ind3++;
        }
      }

      return this.primary.choose(request);
    }
  }

  const origLog = console.log;
  try {
    console.log = () => {};
    for (const seed of WORK54B_DIAGNOSTIC_SEEDS) {
      checkTimeout();
      for (const aIsP1 of [true, false]) {
        const setup = OfficialRegulationMatchSetup.setupMatch(
          reg,
          frame,
          rulePackage,
          seed,
          { playerNames: { p1: "R4_V72", p2: "Gen8" } }
        );
        const session = new GameSession((setup as any).state, rulePackage, {
          matchSeed: seed,
        });
        const shadowR4 = new ShadowRecorderPolicy(r4V72);
        SimulationRunner.run(
          session,
          aIsP1 ? { p1: shadowR4, p2: gen8Baseline } : { p1: gen8Baseline, p2: shadowR4 },
          { maxDecisions: 1000 }
        );
      }
    }
  } finally {
    console.log = origLog;
  }

  console.log(`- 総意思決定数: ${totalDecisions}`);
  console.log(`- 相手 StageRequest 局面数: ${stageRequestDecisions}`);
  console.log(`  - 有効対抗手段あり: ${oppRequestWithCounter}`);
  console.log(`  - 有効対抗手段なし (PASS減点免除対象): ${oppRequestWithoutCounter}`);
  console.log(`- R4 分岐件数 (v7.1 vs v7.2): ${decisionDivergedCountR4}`);
  console.log(`  - 不要な action.packOpen から PASS への選択復帰: ${packOpenAvoidedToPassR4}`);
  console.log(`- G0_IND7 分岐件数 (v7.1 vs v7.2, 正本重み): ${decisionDivergedCountG0Ind7}`);
  console.log(`  - 不要な action.packOpen から PASS への選択復帰: ${packOpenAvoidedToPassG0Ind7}`);
  console.log(`- G3_IND3 分岐件数 (v7.1 vs v7.2, 正本重み): ${decisionDivergedCountG3Ind3}`);
  console.log(`  - 不要な action.packOpen から PASS への選択復帰: ${packOpenAvoidedToPassG3Ind3}`);

  // ===========================================================================
  // Part 2: 座席反転実対戦シミュレーション（勝敗・パフォーマンス）
  // ===========================================================================
  console.log("\n[Part 2] 座席反転実対戦シミュレーション (30ペア＝60試合)...");

  const matchupsToRun: {
    name: string;
    pA: DecisionPolicy;
    pB: DecisionPolicy;
    verA: string;
    verB: string;
  }[] = [
    { name: "R4_v7.2 vs R4_v7.1", pA: r4V72, pB: r4V71, verA: "v7.2", verB: "v7.1" },
    { name: "R4_v7.2 vs Gen8", pA: r4V72, pB: gen8Baseline, verA: "v7.2", verB: "Gen8" },
    { name: "G0_IND7_v7.2 vs G0_IND7_v7.1", pA: g0Ind7V72, pB: g0Ind7V71, verA: "v7.2", verB: "v7.1" },
    { name: "G0_IND7_v7.2 vs Gen8", pA: g0Ind7V72, pB: gen8Baseline, verA: "v7.2", verB: "Gen8" },
    { name: "G3_IND3_v7.2 vs G3_IND3_v7.1", pA: g3Ind3V72, pB: g3Ind3V71, verA: "v7.2", verB: "v7.1" },
    { name: "G3_IND3_v7.2 vs Gen8", pA: g3Ind3V72, pB: gen8Baseline, verA: "v7.2", verB: "Gen8" },
  ];

  const matchupSummaries: SeatSwappedMatchSummary[] = [];

  for (const m of matchupsToRun) {
    checkTimeout();
    console.log(`  - 実行中: ${m.name}...`);
    const summary = runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54B_DIAGNOSTIC_SEEDS,
      matchupName: m.name,
      policyA: m.pA,
      policyB: m.pB,
      encoderVersionA: m.verA,
      encoderVersionB: m.verB,
      checkTimeout,
    });
    // 対戦数整合性検証 (作業C: 全対戦内訳の合計が totalMatches と完全一致すること)
    const matchCountTotal =
      summary.winsA + summary.winsB + summary.draws + summary.incompleteOrFailed + summary.exceptions;
    if (matchCountTotal !== summary.totalMatches) {
      throw new Error(
        `[MATCH_COUNT_MISMATCH] マッチアップ "${summary.matchupName}" の対戦内訳合計 (${matchCountTotal}) が totalMatches (${summary.totalMatches}) と一致しません`
      );
    }

    matchupSummaries.push(summary);
    console.log(
      `    結果: ${summary.winsA}勝 - ${summary.winsB}敗 - ${summary.draws}分 ` +
      `(勝率: ${(summary.winRateA * 100).toFixed(1)}%, 95%CI: [${(summary.confidenceIntervalA.lower * 100).toFixed(1)}%, ${(summary.confidenceIntervalA.upper * 100).toFixed(1)}%], ` +
      `avgTimeA: ${summary.avgDecisionTimeUsA}μs, exceptions: ${summary.exceptions}, incomplete: ${summary.incompleteOrFailed})`
    );
  }

  // ===========================================================================
  // Part 3: 結果 JSON の保存 (排他的ファイル作成 & SHA-256 一意管理) (作業C)
  // ===========================================================================
  console.log("\n[Part 3] 結果の永続化と過去 Evidence 保護確認 (SHA-256)...");

  const artifactsDir = path.resolve(rootDir, ".artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const gitEvidenceDir = path.resolve(rootDir, "evidence/gen9-work5-4b");
  if (!fs.existsSync(gitEvidenceDir)) {
    fs.mkdirSync(gitEvidenceDir, { recursive: true });
  }

  // 過去 Evidence の SHA-256 不変性検証 (原本 ORIGINAL と再生成 REGENERATED の明確な分類)
  const pastIntegrity = verifyPastEvidenceIntegrity(artifactsDir);
  for (const [fName, status] of Object.entries(pastIntegrity)) {
    console.log(`[SHA256_VERIFIED] ${fName} [${status.classification}]: ${status.actualSha256}`);
  }

  // 出力ファイル名: 実行コミットSHAの先頭12桁を含めて一意化
  const shortSha = gitSha.substring(0, 12);
  const outputFilename = `gen9-work5-4b-pass-evaluation-final-${shortSha}.json`;

  const primaryOutputPath = path.join(artifactsDir, outputFilename);
  const evidenceOutputPath = path.join(gitEvidenceDir, outputFilename);

  // 排他的ファイル作成チェック: 既存ファイルが存在した場合は上書きを拒否して例外送出
  if (fs.existsSync(primaryOutputPath)) {
    throw new Error(
      `[EXCLUSIVE_CREATION_FAILED] 出力ファイル ${primaryOutputPath} は既に存在します。上書きを防止しました。`
    );
  }
  if (fs.existsSync(evidenceOutputPath)) {
    throw new Error(
      `[EXCLUSIVE_CREATION_FAILED] 証跡ファイル ${evidenceOutputPath} は既に存在します。上書きを防止しました。`
    );
  }

  const evaluationReport = {
    workId: "BP-SIM-AI-GEN9-WORK54B-EVIDENCE-FINALIZATION-R2",
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    executionEnvironment: buildExecutionEnvironmentMetadata({
      gitSha,
      commitTimeIso,
      workingTreeClean: true,
      rulePackage,
      regulationLookupKey,
      regulation: reg,
      frameLookupKey,
      frame,
      tacticalEncoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V72,
    }),
    provenanceContext: {
      workId: "BP-SIM-AI-GEN9-WORK54B-EVIDENCE-FINALIZATION-R2",
      description: "Work 5-4B Evidence 最終整備 (正本戦術重み、完全特徴量定義、クリーンコミットHEAD実行、排他的証跡永続化)",
      previousCorrectedEvidence: "gen9-work5-4b-pass-evaluation-corrected.json",
      originalInvalidEvidence: "gen9-work5-4b-pass-evaluation.json",
    },
    tacticalFeatureDefinitions: GEN9_TACTICAL_FEATURE_DEFINITIONS,
    tacticalWeightsDetailed: {
      R4: formatTacticalWeightsWithDefinitions(R4_PRESET_TACTICAL_WEIGHTS),
      G0_IND2: formatTacticalWeightsWithDefinitions(G0_IND2_WEIGHTS),
      G0_IND7: formatTacticalWeightsWithDefinitions(G0_IND7_WEIGHTS),
      G3_IND3: formatTacticalWeightsWithDefinitions(G3_IND3_WEIGHTS),
    },
    diagnosticSeedRange: {
      start: 780001,
      end: 780030,
      count: 30,
      totalMatchesPerCard: 60,
    },
    pastEvidenceVerification: pastIntegrity,
    shadowDecisionStats: {
      totalDecisions,
      stageRequestDecisions,
      oppRequestWithCounter,
      oppRequestWithoutCounter,
      passPenaltyExemptedCount,
      decisionDivergedCountR4,
      packOpenAvoidedToPassR4,
      decisionDivergedCountG0Ind7,
      packOpenAvoidedToPassG0Ind7,
      decisionDivergedCountG3Ind3,
      packOpenAvoidedToPassG3Ind3,
      interpretationNote:
        "シャドウ評価は R4 v7.2 対 Gen 8 の対戦局面経路に沿って実施された診断計測であり、G0 IND7 および G3 IND3 の分岐が 0 件であったことは『R4 対 Gen 8 の対戦経路上で両個体の判断が変化しなかったこと』を示すものであり、すべての対戦局面で判断が不変であることを意味するものではありません。",
    },
    matchups: matchupSummaries,
    executionDurationSeconds: Number(((Date.now() - startTime) / 1000).toFixed(2)),
  };

  const reportJsonString = JSON.stringify(evaluationReport, null, 2);

  // 排他的フラグ ("wx") で確実に新規ファイルとして保存
  fs.writeFileSync(primaryOutputPath, reportJsonString, { encoding: "utf8", flag: "wx" });
  fs.writeFileSync(evidenceOutputPath, reportJsonString, { encoding: "utf8", flag: "wx" });

  const finalContent = fs.readFileSync(primaryOutputPath);
  const finalSha256 = crypto.createHash("sha256").update(finalContent).digest("hex").toLowerCase();

  console.log(`\n[SUCCESS] 最終整備 Evidence JSON を排他的に保存しました:`);
  console.log(`  - Artifacts Path: ${primaryOutputPath}`);
  console.log(`  - Evidence Path:  ${evidenceOutputPath}`);
  console.log(`  - SHA-256:        ${finalSha256}`);
  console.log(`  - 所要時間:       ${evaluationReport.executionDurationSeconds} 秒`);
}

// 直接実行時のエントリポイント
if (process.argv[1]?.endsWith("run_gen9_work54b_evaluation.ts")) {
  main().catch((err) => {
    console.error("[FATAL ERROR]", err);
    process.exit(1);
  });
}
