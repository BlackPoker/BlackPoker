/**
 * run_gen9_work54a_evaluation.ts
 *
 * BlackPoker Simulator - Gen 9 通常ブロック戦術評価修正後の限定評価 (Work 5-4A)
 *
 * 【検証目的】
 * 1. 未使用の診断用 Seed (770001〜770030, 30ペア＝60試合) を用いて、
 *    Gen 8, Work 5-1 R4, G0人手設計個体 (G0_IND2, G0_IND7), G3進化個体 (G3_IND3) について
 *    修正前 (v7.0-legacy-block-stream-only) と修正後 (v7.1-unified-block-assignment) を比較。
 * 2. 通常ブロックの DecisionRequest において、ブロック特徴量 (t14, t15, t16) が実際に活性化した件数と、
 *    ブロックの選択結果 (UnitAssignment[]) が変化した件数を計測。
 * 3. 小規模な座席反転対戦 (30ペア＝60試合) で、修正前後の勝敗・異常終了・1判断あたりの時間を測定。
 * 4. 過去の結果ファイル (.artifacts/gen9-work5-2-*.json, .artifacts/gen9-work5-3-*.json) は一切上書きせず、
 *    新規ファイル .artifacts/gen9-work5-4a-block-evaluation.json に保存する。
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
  TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
  TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
  extractBlockAssignmentsFromPattern,
  createBlockTacticalContext,
} from "../src/engine/ai/Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";

// =============================================================================
// 1. 禁止 Seed 範囲の厳格保護 (Holdout・Training・Validation・過去診断 Seed を完全ブロック)
// =============================================================================
export const WORK54A_FORBIDDEN_SEED_RANGES: readonly {
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
  { name: "Original Human Diagnostic Seed", start: 4127992094, end: 4127992094 },
];

export const WORK54A_DIAGNOSTIC_SEEDS: readonly number[] = Object.freeze(
  Array.from({ length: 30 }, (_, i) => 770001 + i)
);

export function assertWork54ASafeSeedRange(
  label: string,
  start: number,
  count: number
): void {
  const end = start + count - 1;
  for (const forbidden of WORK54A_FORBIDDEN_SEED_RANGES) {
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
  -0.20, -0.05, 0.0, -0.15, 0.0, 0.0,
  +2.6, +2.0, +1.1, +0.15,
  +0.10, +0.20, +0.05, -0.38, +0.22, -3.0, -0.40,
  +0.15, +2.0, +2.5,
]);

export const G3_IND3_WEIGHTS: readonly number[] = Object.freeze([
  0.0, 0.0, 0.0, -0.0756, 0.0, -0.0132,
  +2.7222, +1.7719, +1.1, +0.0319,
  +0.10, +0.154, +0.05, -0.3243, +0.22, -3.0, -0.40,
  +0.15, +1.8984, +2.5,
]);

function assignmentsKey(
  request: Readonly<DecisionRequest>,
  patternRef: number
): string {
  const pat = request.patterns[patternRef];
  if (!pat || pat.effectSelectionRef === undefined) {
    return `ref:${patternRef}`;
  }
  const eff = request.catalog?.effectSelections?.[pat.effectSelectionRef];
  if (!eff || eff.selectionType !== "unitAssignment" || !eff.assignments) {
    return `ref:${patternRef}`;
  }
  return eff.assignments
    .map((a) => `${a.sourceUnitId}->[${(a.selectedUnitIds ?? []).join(",")}]`)
    .join(";");
}

interface BlockDecisionExample {
  readonly seed: number;
  readonly seat: "p1" | "p2";
  readonly turn: number;
  readonly playerId: string;
  readonly legalPatternCount: number;
  readonly selfLife: number;
  readonly attackers: readonly { unitId: string; size: number }[];
  readonly gen8Choice: string;
  readonly v70Choice: {
    readonly R4: string;
    readonly G0_IND2: string;
    readonly G0_IND7: string;
    readonly G3_IND3: string;
  };
  readonly v71Choice: {
    readonly R4: string;
    readonly G0_IND2: string;
    readonly G0_IND7: string;
    readonly G3_IND3: string;
  };
  readonly activeBlockFeaturesOnV71Best: {
    readonly R4: { t14: number; t15: number; t16: number };
    readonly G0_IND2: { t14: number; t15: number; t16: number };
    readonly G0_IND7: { t14: number; t15: number; t16: number };
    readonly G3_IND3: { t14: number; t15: number; t16: number };
  };
}

class TimedPolicyWrapper implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  public totalDecisions = 0;
  public totalTimeNs = 0n;

  constructor(private readonly inner: DecisionPolicy) {
    this.descriptor = inner.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const t0 = process.hrtime.bigint();
    const res = this.inner.choose(request);
    const t1 = process.hrtime.bigint();
    this.totalTimeNs += t1 - t0;
    this.totalDecisions++;
    return res;
  }
}

interface SeatSwappedMatchSummary {
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
  readonly exceptions: number;
  readonly totalDecisionsA: number;
  readonly totalDecisionsB: number;
  readonly avgDecisionTimeUsA: number;
  readonly avgDecisionTimeUsB: number;
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
    exceptions,
    totalDecisionsA: timedA.totalDecisions,
    totalDecisionsB: timedB.totalDecisions,
    avgDecisionTimeUsA: Number(avgDecisionTimeUsA.toFixed(2)),
    avgDecisionTimeUsB: Number(avgDecisionTimeUsB.toFixed(2)),
  };
}

async function main() {
  const overallStartMs = performance.now();
  const timeoutSec = 900;
  const checkTimeout = () => {
    const elapsedSec = (performance.now() - overallStartMs) / 1000;
    if (elapsedSec > timeoutSec) {
      throw new Error(
        `[TIMEOUT] Work 5-4A 評価実行時間が上限 (${timeoutSec}秒) を超過しました`
      );
    }
  };

  let currentHeadSha = "39a1a6242aed0525d05aaccd1428871534766732";
  try {
    currentHeadSha = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
    }).trim();
  } catch {
    // ignore
  }

  const diagStart = WORK54A_DIAGNOSTIC_SEEDS[0];
  const pairsCount = WORK54A_DIAGNOSTIC_SEEDS.length;
  assertWork54ASafeSeedRange(
    "Work 5-4A Diagnostic Seeds",
    diagStart,
    pairsCount
  );

  const rulesDir = path.resolve("src/data/rules-vnext");
  const regulationsDir = path.resolve("src/data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const reg = catalog.regulations.get("standard-pack")!;
  const frame = catalog.frames.get("pack")!;

  const gen8Candidate = createGen8ChampionCandidatePolicy();
  const gen8DNA: DecisionDNA = DecisionDNACodec.clone(
    (gen8Candidate as any).dna
  );

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);
  Gen9TacticalPrototypePolicy.setDefaultEvaluator(tacticalEvaluator);

  const makePair = (
    idPrefix: string,
    weights: readonly number[]
  ): {
    v70: Gen9LearnableTacticalPolicy;
    v71: Gen9LearnableTacticalPolicy;
  } => {
    const g70: Gen9TacticalGenome = fromV6DNA(gen8DNA, weights, {
      id: `${idPrefix}-v7.0`,
      name: `${idPrefix} (v7.0)`,
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
    });
    const g71: Gen9TacticalGenome = fromV6DNA(gen8DNA, weights, {
      id: `${idPrefix}-v7.1`,
      name: `${idPrefix} (v7.1)`,
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
    });
    return {
      v70: new Gen9LearnableTacticalPolicy(
        g70,
        `${idPrefix}_v7.0`,
        tacticalEvaluator
      ),
      v71: new Gen9LearnableTacticalPolicy(
        g71,
        `${idPrefix}_v7.1`,
        tacticalEvaluator
      ),
    };
  };

  const gen8Policy = new GenomePolicy(gen8DNA, "GEN8_CHAMPION");
  const r4Policies = makePair("R4", R4_PRESET_TACTICAL_WEIGHTS);
  const g0Ind2Policies = makePair("G0_IND2", G0_IND2_WEIGHTS);
  const g0Ind7Policies = makePair("G0_IND7", G0_IND7_WEIGHTS);
  const g3Ind3Policies = makePair("G3_IND3", G3_IND3_WEIGHTS);

  // =========================================================================
  // Part 1: 診断用 Seed (770001〜770030, 60試合) におけるブロック判断の収集と比較
  // =========================================================================
  let totalDecisionsSampled = 0;
  let totalNonTrivialDecisionsSampled = 0;
  let totalBlockDecisions = 0;
  let normalBlockDecisions = 0;
  let streamingBlockDecisions = 0;
  let multiChoiceNormalBlockDecisions = 0;

  const featureActivationV70 = {
    t14: 0,
    t15: 0,
    t16: 0,
    anyBlockFeature: 0,
    totalActivePatterns: { t14: 0, t15: 0, t16: 0 },
  };
  const featureActivationV71 = {
    t14: 0,
    t15: 0,
    t16: 0,
    anyBlockFeature: 0,
    totalActivePatterns: { t14: 0, t15: 0, t16: 0 },
  };

  const choiceChangedV70ToV71 = {
    R4: 0,
    G0_IND2: 0,
    G0_IND7: 0,
    G3_IND3: 0,
  };
  const choiceChangedGen8ToV71 = {
    R4: 0,
    G0_IND2: 0,
    G0_IND7: 0,
    G3_IND3: 0,
  };
  const choiceDiffAmongV71 = {
    R4_vs_G0_IND2: 0,
    R4_vs_G0_IND7: 0,
    R4_vs_G3_IND3: 0,
    G0_IND2_vs_G0_IND7: 0,
    G0_IND2_vs_G3_IND3: 0,
    G0_IND7_vs_G3_IND3: 0,
  };

  const changedExamples: BlockDecisionExample[] = [];

  class BlockShadowProbePolicy implements DecisionPolicy {
    public readonly descriptor: PolicyDescriptor;
    constructor(
      private readonly activePolicy: DecisionPolicy,
      private readonly seed: number,
      private readonly seat: "p1" | "p2"
    ) {
      this.descriptor = activePolicy.descriptor;
    }

    public choose(req: Readonly<DecisionRequest>): DecisionResponse {
      totalDecisionsSampled++;
      const isStreamingBlock =
        Boolean(req.blockAssignmentStream) &&
        (req.patterns.length === 0 ||
          req.blockAssignmentStream!.patternCount > 256);
      const legalCount = isStreamingBlock
        ? req.blockAssignmentStream!.patternCount
        : req.patterns.length;
      if (legalCount > 1) {
        totalNonTrivialDecisionsSampled++;
      }

      const blockCtx = createBlockTacticalContext(req);
      const isNormalBlock =
        req.patterns.length > 0 &&
        extractBlockAssignmentsFromPattern(req, req.patterns[0], blockCtx) !==
          undefined;

      if (isNormalBlock || isStreamingBlock) {
        totalBlockDecisions++;
        if (isStreamingBlock) {
          streamingBlockDecisions++;
        } else {
          normalBlockDecisions++;
        }

        if (isNormalBlock && req.patterns.length > 1) {
          multiChoiceNormalBlockDecisions++;

          const evalV70R4 = r4Policies.v70.evaluatePatterns(req);
          const evalV71R4 = r4Policies.v71.evaluatePatterns(req);
          const evalV70G0_2 = g0Ind2Policies.v70.evaluatePatterns(req);
          const evalV71G0_2 = g0Ind2Policies.v71.evaluatePatterns(req);
          const evalV70G0_7 = g0Ind7Policies.v70.evaluatePatterns(req);
          const evalV71G0_7 = g0Ind7Policies.v71.evaluatePatterns(req);
          const evalV70G3 = g3Ind3Policies.v70.evaluatePatterns(req);
          const evalV71G3 = g3Ind3Policies.v71.evaluatePatterns(req);

          const gen8Resp = gen8Policy.choose(req);

          // Check feature activation across patterns in this DecisionRequest
          const v70_14Count = evalV70R4.scoredPatterns.filter(
            (p) => p.tacticalFeatures[14] !== 0
          ).length;
          const v70_15Count = evalV70R4.scoredPatterns.filter(
            (p) => p.tacticalFeatures[15] !== 0
          ).length;
          const v70_16Count = evalV70R4.scoredPatterns.filter(
            (p) => p.tacticalFeatures[16] !== 0
          ).length;
          if (v70_14Count > 0) featureActivationV70.t14++;
          if (v70_15Count > 0) featureActivationV70.t15++;
          if (v70_16Count > 0) featureActivationV70.t16++;
          if (v70_14Count > 0 || v70_15Count > 0 || v70_16Count > 0) {
            featureActivationV70.anyBlockFeature++;
          }
          featureActivationV70.totalActivePatterns.t14 += v70_14Count;
          featureActivationV70.totalActivePatterns.t15 += v70_15Count;
          featureActivationV70.totalActivePatterns.t16 += v70_16Count;

          const v71_14Count = evalV71R4.scoredPatterns.filter(
            (p) => p.tacticalFeatures[14] !== 0
          ).length;
          const v71_15Count = evalV71R4.scoredPatterns.filter(
            (p) => p.tacticalFeatures[15] !== 0
          ).length;
          const v71_16Count = evalV71R4.scoredPatterns.filter(
            (p) => p.tacticalFeatures[16] !== 0
          ).length;
          if (v71_14Count > 0) featureActivationV71.t14++;
          if (v71_15Count > 0) featureActivationV71.t15++;
          if (v71_16Count > 0) featureActivationV71.t16++;
          if (v71_14Count > 0 || v71_15Count > 0 || v71_16Count > 0) {
            featureActivationV71.anyBlockFeature++;
          }
          featureActivationV71.totalActivePatterns.t14 += v71_14Count;
          featureActivationV71.totalActivePatterns.t15 += v71_15Count;
          featureActivationV71.totalActivePatterns.t16 += v71_16Count;

          const kGen8 = assignmentsKey(req, gen8Resp.selectedPatternRef);
          const k70R4 = assignmentsKey(req, evalV70R4.bestPatternRef);
          const k71R4 = assignmentsKey(req, evalV71R4.bestPatternRef);
          const k70G0_2 = assignmentsKey(req, evalV70G0_2.bestPatternRef);
          const k71G0_2 = assignmentsKey(req, evalV71G0_2.bestPatternRef);
          const k70G0_7 = assignmentsKey(req, evalV70G0_7.bestPatternRef);
          const k71G0_7 = assignmentsKey(req, evalV71G0_7.bestPatternRef);
          const k70G3 = assignmentsKey(req, evalV70G3.bestPatternRef);
          const k71G3 = assignmentsKey(req, evalV71G3.bestPatternRef);

          if (k70R4 !== k71R4) choiceChangedV70ToV71.R4++;
          if (k70G0_2 !== k71G0_2) choiceChangedV70ToV71.G0_IND2++;
          if (k70G0_7 !== k71G0_7) choiceChangedV70ToV71.G0_IND7++;
          if (k70G3 !== k71G3) choiceChangedV70ToV71.G3_IND3++;

          if (kGen8 !== k71R4) choiceChangedGen8ToV71.R4++;
          if (kGen8 !== k71G0_2) choiceChangedGen8ToV71.G0_IND2++;
          if (kGen8 !== k71G0_7) choiceChangedGen8ToV71.G0_IND7++;
          if (kGen8 !== k71G3) choiceChangedGen8ToV71.G3_IND3++;

          if (k71R4 !== k71G0_2) choiceDiffAmongV71.R4_vs_G0_IND2++;
          if (k71R4 !== k71G0_7) choiceDiffAmongV71.R4_vs_G0_IND7++;
          if (k71R4 !== k71G3) choiceDiffAmongV71.R4_vs_G3_IND3++;
          if (k71G0_2 !== k71G0_7) choiceDiffAmongV71.G0_IND2_vs_G0_IND7++;
          if (k71G0_2 !== k71G3) choiceDiffAmongV71.G0_IND2_vs_G3_IND3++;
          if (k71G0_7 !== k71G3) choiceDiffAmongV71.G0_IND7_vs_G3_IND3++;

          const anyChanged =
            k70R4 !== k71R4 ||
            k70G0_2 !== k71G0_2 ||
            k70G0_7 !== k71G0_7 ||
            k70G3 !== k71G3;

          if (anyChanged && changedExamples.length < 15) {
            const getBestFeats = (ev: typeof evalV71R4) => {
              const d = ev.scoredPatterns.find(
                (p) => p.patternRef === ev.bestPatternRef
              )!;
              return {
                t14: d.tacticalFeatures[14],
                t15: d.tacticalFeatures[15],
                t16: d.tacticalFeatures[16],
              };
            };
            changedExamples.push({
              seed: this.seed,
              seat: this.seat,
              turn: req.observation.turnCount ?? 0,
              playerId: req.playerId,
              legalPatternCount: req.patterns.length,
              selfLife: blockCtx.selfLife,
              attackers: Array.from(blockCtx.oppAttackersMap.values()).map(
                (u) => ({
                  unitId: u.unitId,
                  size: u.currentSize ?? 0,
                })
              ),
              gen8Choice: kGen8,
              v70Choice: {
                R4: k70R4,
                G0_IND2: k70G0_2,
                G0_IND7: k70G0_7,
                G3_IND3: k70G3,
              },
              v71Choice: {
                R4: k71R4,
                G0_IND2: k71G0_2,
                G0_IND7: k71G0_7,
                G3_IND3: k71G3,
              },
              activeBlockFeaturesOnV71Best: {
                R4: getBestFeats(evalV71R4),
                G0_IND2: getBestFeats(evalV71G0_2),
                G0_IND7: getBestFeats(evalV71G0_7),
                G3_IND3: getBestFeats(evalV71G3),
              },
            });
          }
        }
      }

      return this.activePolicy.choose(req);
    }
  }

  const origLog = console.log;
  try {
    console.log = () => {};
    for (const seed of WORK54A_DIAGNOSTIC_SEEDS) {
      checkTimeout();
      // Leg 0: P1 = Probe(G3_IND3_v7.1), P2 = Probe(GEN8)
      const p1Probe0 = new BlockShadowProbePolicy(
        g3Ind3Policies.v71,
        seed,
        "p1"
      );
      const p2Probe0 = new BlockShadowProbePolicy(gen8Policy, seed, "p2");
      const setup0 = OfficialRegulationMatchSetup.setupMatch(
        reg,
        frame,
        rulePackage,
        seed,
        {
          playerNames: { p1: "G3-v7.1", p2: "Gen8" },
        }
      );
      const session0 = new GameSession((setup0 as any).state, rulePackage, {
        matchSeed: seed,
      });
      SimulationRunner.run(
        session0,
        { p1: p1Probe0, p2: p2Probe0 },
        { maxDecisions: 1000 }
      );

      // Leg 1: P1 = Probe(GEN8), P2 = Probe(G3_IND3_v7.1) (座席反転)
      const p1Probe1 = new BlockShadowProbePolicy(gen8Policy, seed, "p1");
      const p2Probe1 = new BlockShadowProbePolicy(
        g3Ind3Policies.v71,
        seed,
        "p2"
      );
      const setup1 = OfficialRegulationMatchSetup.setupMatch(
        reg,
        frame,
        rulePackage,
        seed,
        {
          playerNames: { p1: "Gen8", p2: "G3-v7.1" },
        }
      );
      const session1 = new GameSession((setup1 as any).state, rulePackage, {
        matchSeed: seed,
      });
      SimulationRunner.run(
        session1,
        { p1: p1Probe1, p2: p2Probe1 },
        { maxDecisions: 1000 }
      );
    }
  } finally {
    console.log = origLog;
  }

  // =========================================================================
  // Part 2: 修正前後 (v7.1 vs v7.0, v7.1 vs Gen 8) の座席反転対戦 (30ペア＝60試合)
  // =========================================================================
  const matchups: SeatSwappedMatchSummary[] = [
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G0_IND2 (v7.1) vs G0_IND2 (v7.0)",
      policyA: g0Ind2Policies.v71,
      policyB: g0Ind2Policies.v70,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G0_IND7 (v7.1) vs G0_IND7 (v7.0)",
      policyA: g0Ind7Policies.v71,
      policyB: g0Ind7Policies.v70,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G3_IND3 (v7.1) vs G3_IND3 (v7.0)",
      policyA: g3Ind3Policies.v71,
      policyB: g3Ind3Policies.v70,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "R4 (v7.1) vs R4 (v7.0)",
      policyA: r4Policies.v71,
      policyB: r4Policies.v70,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G0_IND2 (v7.1) vs GEN8_CHAMPION",
      policyA: g0Ind2Policies.v71,
      policyB: gen8Policy,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: "v6.0-base-dna-only",
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G0_IND7 (v7.1) vs GEN8_CHAMPION",
      policyA: g0Ind7Policies.v71,
      policyB: gen8Policy,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: "v6.0-base-dna-only",
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G3_IND3 (v7.1) vs GEN8_CHAMPION",
      policyA: g3Ind3Policies.v71,
      policyB: gen8Policy,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: "v6.0-base-dna-only",
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "R4 (v7.1) vs GEN8_CHAMPION",
      policyA: r4Policies.v71,
      policyB: gen8Policy,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: "v6.0-base-dna-only",
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G0_IND7 (v7.1) vs G0_IND2 (v7.1)",
      policyA: g0Ind7Policies.v71,
      policyB: g0Ind2Policies.v71,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G3_IND3 (v7.1) vs G0_IND2 (v7.1)",
      policyA: g3Ind3Policies.v71,
      policyB: g0Ind2Policies.v71,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      checkTimeout,
    }),
    runSeatSwappedMatchup({
      reg,
      frame,
      rulePackage,
      seeds: WORK54A_DIAGNOSTIC_SEEDS,
      matchupName: "G3_IND3 (v7.1) vs G0_IND7 (v7.1)",
      policyA: g3Ind3Policies.v71,
      policyB: g0Ind7Policies.v71,
      encoderVersionA: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      encoderVersionB: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
      checkTimeout,
    }),
  ];

  const elapsedMs = Math.round(performance.now() - overallStartMs);

  const report = {
    workId: "BP-SIM-AI-GEN9-NORMAL-BLOCK-TACTICAL-FIX-WORK5-4A",
    baseSha: currentHeadSha,
    generatedAt: new Date().toISOString(),
    elapsedMs,
    encoderVersions: {
      legacy: TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
      current: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
    },
    seedIsolation: {
      diagnosticSeedRange: [
        WORK54A_DIAGNOSTIC_SEEDS[0],
        WORK54A_DIAGNOSTIC_SEEDS[WORK54A_DIAGNOSTIC_SEEDS.length - 1],
      ],
      seedPairCount: WORK54A_DIAGNOSTIC_SEEDS.length,
      totalMatchesPerMatchup: WORK54A_DIAGNOSTIC_SEEDS.length * 2,
      holdoutUsed: false,
      previousPilotOrDiagSeedsUsed: false,
    },
    blockDecisionAnalysis: {
      totalDecisionsSampled,
      totalNonTrivialDecisionsSampled,
      totalBlockDecisions,
      normalBlockDecisions,
      streamingBlockDecisions,
      multiChoiceNormalBlockDecisions,
      featureActivationInMultiChoiceNormalBlocks: {
        v70_legacy: featureActivationV70,
        v71_unified: featureActivationV71,
      },
      choiceChangedCount_v70_to_v71: choiceChangedV70ToV71,
      choiceChangedRate_v70_to_v71: {
        R4:
          multiChoiceNormalBlockDecisions > 0
            ? Number(
                (
                  choiceChangedV70ToV71.R4 / multiChoiceNormalBlockDecisions
                ).toFixed(4)
              )
            : 0,
        G0_IND2:
          multiChoiceNormalBlockDecisions > 0
            ? Number(
                (
                  choiceChangedV70ToV71.G0_IND2 /
                  multiChoiceNormalBlockDecisions
                ).toFixed(4)
              )
            : 0,
        G0_IND7:
          multiChoiceNormalBlockDecisions > 0
            ? Number(
                (
                  choiceChangedV70ToV71.G0_IND7 /
                  multiChoiceNormalBlockDecisions
                ).toFixed(4)
              )
            : 0,
        G3_IND3:
          multiChoiceNormalBlockDecisions > 0
            ? Number(
                (
                  choiceChangedV70ToV71.G3_IND3 /
                  multiChoiceNormalBlockDecisions
                ).toFixed(4)
              )
            : 0,
      },
      choiceChangedCount_GEN8_to_v71: choiceChangedGen8ToV71,
      choiceDiffAmongV71Policies: choiceDiffAmongV71,
      changedExamples,
    },
    seatSwappedMatchups: matchups,
  };

  const outPath = path.resolve(
    process.cwd(),
    ".artifacts/gen9-work5-4a-block-evaluation.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log("=== Work 5-4A Block Tactical Evaluation Completed ===");
  console.log(`Elapsed: ${elapsedMs} ms`);
  console.log(
    `Block Decisions: total=${totalBlockDecisions}, normal=${normalBlockDecisions}, streaming=${streamingBlockDecisions}, multiChoiceNormal=${multiChoiceNormalBlockDecisions}`
  );
  console.log(
    `Feature Activation (v7.0 -> v7.1): t14=${featureActivationV70.t14}->${featureActivationV71.t14}, t15=${featureActivationV70.t15}->${featureActivationV71.t15}, t16=${featureActivationV70.t16}->${featureActivationV71.t16}, any=${featureActivationV70.anyBlockFeature}->${featureActivationV71.anyBlockFeature}`
  );
  console.log(
    `Choice Changed (v7.0 -> v7.1):`,
    JSON.stringify(choiceChangedV70ToV71)
  );
  console.log(
    `Choice Diff Among v7.1 Policies:`,
    JSON.stringify(choiceDiffAmongV71)
  );
  for (const m of matchups) {
    console.log(
      `  [${m.matchupName}] WinsA=${m.winsA} WinsB=${m.winsB} Draws=${m.draws} WinRateA=${(m.winRateA * 100).toFixed(1)}% Exceptions=${m.exceptions} AvgTimeA=${m.avgDecisionTimeUsA.toFixed(1)}us AvgTimeB=${m.avgDecisionTimeUsB.toFixed(1)}us`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
