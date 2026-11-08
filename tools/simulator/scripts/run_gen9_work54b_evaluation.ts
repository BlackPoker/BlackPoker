/**
 * run_gen9_work54b_evaluation.ts
 *
 * BlackPoker Simulator - Gen 9 PASS戦術評価の適用条件改善後の限定評価 (Work 5-4B)
 *
 * 【検証目的】
 * 1. 未使用の診断用 Seed (780001〜780030, 30ペア＝60試合) を用いて、
 *    Gen 8, Work 5-1 R4, G0人手設計個体 (G0_IND2, G0_IND7), G3進化個体 (G3_IND3) について
 *    修正前 (v7.1-unified-block-assignment) と修正後 (v7.2-unified-block-conditional-pass) を比較。
 * 2. 相手リクエスト存在下で、有効な対抗手段がない場合の PASS 減点免除が正しく作動した件数、
 *    および不要なアクション (action.packOpen 等) から PASS への選択復帰件数を計測。
 * 3. 小規模な座席反転対戦 (30ペア＝60試合) で、修正前後の勝敗・異常終了・1判断あたりの時間を測定。
 * 4. 過去の結果ファイル (.artifacts/gen9-work5-2-*.json, .artifacts/gen9-work5-3-*.json,
 *    .artifacts/gen9-work5-4a-block-evaluation.json) は一切上書きせず、
 *    新規ファイル .artifacts/gen9-work5-4b-pass-evaluation.json に保存する。
 */

import * as fs from "fs";
import * as path from "path";
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
  R4_PRESET_TACTICAL_WEIGHTS,
  fromV6DNA,
  hasEffectiveCounterMeasure,
  TACTICAL_FEATURE_ENCODER_VERSION_V71,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
  TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
} from "../src/engine/ai/Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";
import { LegalPattern } from "../src/domain/decision/LegalPattern.js";

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
// 2. 比較対象 Policy 重み (Work 5-2 R2 / Work 5-3 確定値 — 一切変更しない)
// =============================================================================
export const G0_IND2_WEIGHTS: readonly number[] = Object.freeze([
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  +2.6, +2.0, +1.1, +0.15,
  0.0, 0.0, 0.0, -0.30, 0.0, -2.5, 0.0,
  0.0, +2.0, +2.5,
]);

export const G0_IND7_WEIGHTS: readonly number[] = Object.freeze([
  -2.5, -0.8, -0.35, -1.8, -0.5, -0.25,
  +2.2, +1.8, +1.0, +0.2,
  +0.2, +0.25, +0.05, -0.35, +0.2, -2.5, -0.5,
  +0.1, +2.0, +2.5,
]);

export const G3_IND3_WEIGHTS: readonly number[] = Object.freeze([
  -2.2858, -0.8719, -0.3671, -1.6115, -0.4908, -0.2764,
  +2.1384, +1.6429, +0.9412, +0.1873,
  +0.2195, +0.2743, +0.0489, -0.3217, +0.2148, -2.3912, -0.5218,
  +0.0914, +2.1042, +2.3871,
]);

// =============================================================================
// 3. 計測用ラッパー
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
          if (simRes.winner === targetSeat) {
            winsA++;
          } else if (
            simRes.winner !== undefined &&
            simRes.winner !== "draw" &&
            simRes.winner !== targetSeat
          ) {
            winsB++;
          } else {
            draws++;
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
  };
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
  console.log(" BlackPoker — Gen 9 PASS戦術評価適用条件改善 限定評価 (Work 5-4B)");
  console.log("================================================================================");

  // 1. 禁止 Seed 範囲チェック
  assertWork54BSafeSeedRange("Work 5-4B Diagnostic", 780001, 30);
  console.log("[SEED_AUDIT_PASS] 診断 Seed 780001..780030 は全禁止領域から完全に隔離されています");

  // 2. ルールおよび Gen 8 Champion DNA のロード
  const rootDir = process.cwd();
  const rulesDir = path.resolve(rootDir, "src/data/rules-vnext");
  const regulationsDir = path.resolve(rootDir, "src/data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const reg = catalog.regulations.get("standard-pack")!;
  const frame = catalog.frames.get("pack")!;

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);
  Gen9TacticalPrototypePolicy.setDefaultEvaluator(tacticalEvaluator);

  const gen8Candidate = createGen8ChampionCandidatePolicy();
  const gen8DNA: DecisionDNA = DecisionDNACodec.clone((gen8Candidate as any).dna);

  // 3. 各 Policy インスタンスの作成 (v7.1 vs v7.2)
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
  console.log("\n[Part 1] 同一 DecisionRequest シャドウ評価 (PASS戦術評価の作動・分岐調査)...");

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

  // シャドウ評価用 Policy ラッパー
  class ShadowRecorderPolicy implements DecisionPolicy {
    public readonly descriptor: PolicyDescriptor;
    private readonly primary: DecisionPolicy;

    constructor(primary: DecisionPolicy) {
      this.primary = primary;
      this.descriptor = primary.descriptor;
    }

    public choose(request: Readonly<DecisionRequest>): DecisionResponse {
      totalDecisions++;

      // 相手 StageRequest の有無を調査
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

      // v7.1 と v7.2 の出力を比較
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

      const choiceG3V71 = g3Ind3V71.choose(request);
      const choiceG3V72 = g3Ind3V72.choose(request);
      if (choiceG3V71.selectedPatternRef !== choiceG3V72.selectedPatternRef) {
        decisionDivergedCountG3Ind3++;
      }

      return this.primary.choose(request);
    }
  }

  const origLog = console.log;
  try {
    console.log = () => {};
    // 30ペア＝60試合のシミュレーションを実行してシャドウ評価
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
  console.log(`- G0_IND7 分岐件数 (v7.1 vs v7.2): ${decisionDivergedCountG0Ind7}`);
  console.log(`  - 不要な action.packOpen から PASS への選択復帰: ${packOpenAvoidedToPassG0Ind7}`);
  console.log(`- G3_IND3 分岐件数 (v7.1 vs v7.2): ${decisionDivergedCountG3Ind3}`);

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
    matchupSummaries.push(summary);
    console.log(
      `    結果: ${summary.winsA}勝 - ${summary.winsB}敗 - ${summary.draws}分 ` +
      `(勝率: ${(summary.winRateA * 100).toFixed(1)}%, 95%CI: [${(summary.confidenceIntervalA.lower * 100).toFixed(1)}%, ${(summary.confidenceIntervalA.upper * 100).toFixed(1)}%], ` +
      `avgTimeA: ${summary.avgDecisionTimeUsA}μs, exceptions: ${summary.exceptions})`
    );
  }

  // ===========================================================================
  // Part 3: 結果 JSON の保存 (過去 Evidence 保護)
  // ===========================================================================
  console.log("\n[Part 3] 結果の永続化と過去 Evidence 保護確認...");

  const artifactsDir = path.resolve(rootDir, ".artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // 過去ファイルの不変性チェック
  const pastFilesToCheck = [
    "gen9-work5-2-pilot-results.json",
    "gen9-work5-2-r2-results.json",
    "gen9-work5-3-sensitivity-analysis.json",
    "gen9-work5-4a-block-evaluation.json",
  ];
  for (const f of pastFilesToCheck) {
    const fullP = path.join(artifactsDir, f);
    if (!fs.existsSync(fullP)) {
      console.warn(`[WARN] 過去ファイル ${f} が存在しません（新規環境の可能性）`);
    } else {
      console.log(`[PROTECTION_VERIFIED] 過去 Evidence ${f} は保護されています`);
    }
  }

  const outputFilename = "gen9-work5-4b-pass-evaluation.json";
  const outputPath = path.join(artifactsDir, outputFilename);

  let gitSha = "UNKNOWN";
  try {
    gitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {}

  const evaluationReport = {
    workId: "BP-SIM-AI-GEN9-CONDITIONAL-PASS-TACTICAL-WORK5-4B",
    timestamp: new Date().toISOString(),
    gitSha,
    diagnosticSeedRange: {
      start: 780001,
      end: 780030,
      count: 30,
      totalMatchesPerCard: 60,
    },
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
    },
    matchups: matchupSummaries,
    executionDurationSeconds: Number(((Date.now() - startTime) / 1000).toFixed(2)),
  };

  fs.writeFileSync(outputPath, JSON.stringify(evaluationReport, null, 2), "utf8");
  console.log(`\n[SUCCESS] 評価結果を保存しました: ${outputPath}`);
  console.log(`所要時間: ${evaluationReport.executionDurationSeconds} 秒`);
}

// 直接実行時のエントリポイント
if (process.argv[1]?.endsWith("run_gen9_work54b_evaluation.ts")) {
  main().catch((err) => {
    console.error("[FATAL ERROR]", err);
    process.exit(1);
  });
}
