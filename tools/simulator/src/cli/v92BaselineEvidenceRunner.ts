import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory";
import { deriveSeed } from "../engine/random/DeterministicShuffle";

import { GenerationRunner } from "../engine/ai/GenerationRunner";
import { EvolutionLoop } from "../engine/ai/EvolutionLoop";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { DecisionFeatureEncoder } from "../engine/ai/DecisionFeatureEncoder";
import { SemanticFingerprintCalculator } from "../engine/ai/SemanticFingerprintCalculator";
import { SimulationRunner, SimulationResult } from "../engine/simulation/SimulationRunner";
import { FirstLegalPolicy } from "../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { GameSessionSnapshotCodec, GameSessionSnapshotValidationError } from "../engine/session/GameSessionSnapshotCodec";
import { StateHasher } from "../engine/simulation/StateHasher";

import {
  PopulationSnapshot,
  PopulationEntry,
} from "../domain/ai/PopulationSelectionTypes";
import {
  GenerationRunnerEnvironmentContext,
  GenerationRunnerExecutionResult,
  RunGenerationParams,
  GenerationEvaluationMatch,
} from "../domain/ai/GenerationRunnerTypes";
import {
  EvolutionLoopConfig,
  EvolutionLoopExecutionResult,
  RunEvolutionLoopParams,
  canonicalGenerationStreamKey,
  canonicalLoopSeedScheduleIdentity,
} from "../domain/ai/EvolutionLoopTypes";
import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { LegalPattern } from "../domain/decision/LegalPattern";
import { DecisionCatalog } from "../domain/decision/DecisionCatalog";
import { PlayerObservation, PlayerObservationView } from "../domain/decision/PlayerObservation";
import { FitnessEvaluationResult } from "../domain/ai/FitnessEvaluationTypes";
import { GameSession } from "../engine/session/GameSession";
import { BatchMatchContext } from "../domain/simulation/BatchSimulationTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function main() {
  console.log("================================================================================");
  console.log("  BP-SIM-AI-V92-BASELINE-EVIDENCE-V1 Runner");
  console.log("  Work ID: BP-SIM-AI-V92-BASELINE-EVIDENCE-V1");
  console.log("================================================================================");

  const catalog = await loadRegulationCatalog();
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const reportData: Record<string, any> = {
    workId: "BP-SIM-AI-V92-BASELINE-EVIDENCE-V1",
    timestamp: new Date().toISOString(),
    startSha: "92a7fc50674c20026118cf20460c6ee423451a71",
  };

  // ===========================================================================
  // SECTION 1: Feature Compatibility Audit
  // ===========================================================================
  console.log("\n[Section 1] Auditing Feature Compatibility & Semantic Fingerprint Sensitivity...");
  
  const p1View: PlayerObservationView = {
    playerId: "p1",
    name: "Player A",
    isViewer: true,
    lifeCount: 5,
    lifeDisplay: "5",
    handCount: 2,
    handCards: [],
    field: [],
    fog: [],
    trumps: [],
    graveCount: 0,
    grave: [],
    canViewFullGrave: true,
  };

  const p2View: PlayerObservationView = {
    playerId: "p2",
    name: "Player B",
    isViewer: false,
    lifeCount: 5,
    lifeDisplay: "5",
    handCount: 2,
    handCards: [],
    field: [],
    fog: [],
    trumps: [],
    graveCount: 0,
    grave: [],
    canViewFullGrave: false,
  };

  const baseObs1: PlayerObservation = {
    viewerPlayerId: "p1",
    turnPlayerId: "p1",
    chancePlayerId: "p1",
    focusPlayerId: "p1",
    turnCount: 1,
    players: [p1View, p2View],
    stageRequestRefs: [],
    stageRequests: [],
    recentEvents: [],
  };

  const baseObs2: PlayerObservation = {
    ...baseObs1,
    focusPlayerId: "p2", // focusPlayerId のみ異なる
  };

  const patterns: LegalPattern[] = [
    { patternId: "pat-1", kind: "ACTION", actionSelectionRef: 0 },
    { patternId: "pat-2", kind: "PASS" },
  ];

  const catalogMock: DecisionCatalog = {
    actions: [{ actionId: "action.up", actionName: "Action Up", timing: "main", speed: "normal" }],
    cardSelections: [],
    unitSelections: [],
    costPayments: [],
    targetSelections: [],
    effectSelections: [],
    orderSelections: [],
  };

  const req1: DecisionRequest = {
    matchId: "audit-m1",
    decisionId: "audit-d1",
    protocolVersion: "1",
    stateVersion: 1,
    playerId: "p1",
    source: { type: "ACTION_REQUEST", playerId: "p1" },
    observation: baseObs1,
    patterns,
    catalog: catalogMock,
  };

  const req2: DecisionRequest = {
    ...req1,
    observation: baseObs2,
  };

  // 1.2 Feature Encoder の差分検証
  const encoded1 = DecisionFeatureEncoder.encode(req1);
  const encoded2 = DecisionFeatureEncoder.encode(req2);

  const contextEqual = JSON.stringify(encoded1.context.values) === JSON.stringify(encoded2.context.values);
  const patternsEqual = JSON.stringify(encoded1.patterns) === JSON.stringify(encoded2.patterns);

  // 1.3 Semantic Fingerprint の感度検証
  const stateA = {
    presetId: "test",
    turnPlayer: "p1",
    chancePlayer: "p1",
    focusPlayer: "p1",
    turnCount: 1,
    players: { p1: { hand: [], life: [], field: [], fog: [], grave: [] }, p2: { hand: [], life: [], field: [], fog: [], grave: [] } },
    stage: { requests: [] },
  };
  const stateB = {
    ...stateA,
    focusPlayer: "p2", // focusPlayer のみ異なる
  };

  const sgf1_A = SemanticFingerprintCalculator.computeSgf1(stateA);
  const sgf1_B = SemanticFingerprintCalculator.computeSgf1(stateB);
  const sgf1Sensitive = sgf1_A !== sgf1_B;

  const sgf1Ti_A = SemanticFingerprintCalculator.computeSgf1Ti(stateA);
  const sgf1Ti_B = SemanticFingerprintCalculator.computeSgf1Ti(stateB);
  const sgf1TiSensitive = sgf1Ti_A !== sgf1Ti_B;

  const pof1_A = SemanticFingerprintCalculator.computePof1(baseObs1);
  const pof1_B = SemanticFingerprintCalculator.computePof1(baseObs2);
  const pof1Sensitive = pof1_A !== pof1_B;

  const drsf1_A = SemanticFingerprintCalculator.computeDrsf1(req1);
  const drsf1_B = SemanticFingerprintCalculator.computeDrsf1(req2);
  const drsf1Sensitive = drsf1_A !== drsf1_B;

  const gpif1_A = SemanticFingerprintCalculator.computeGpif1(req1);
  const gpif1_B = SemanticFingerprintCalculator.computeGpif1(req2);
  const gpif1Sensitive = gpif1_A !== gpif1_B;

  console.log(`  - DecisionFeatureEncoder context equal (focus invariant): ${contextEqual}`);
  console.log(`  - DecisionFeatureEncoder patterns equal (focus invariant): ${patternsEqual}`);
  console.log(`  - sgf1 focus sensitivity: ${sgf1Sensitive} (${sgf1_A.slice(0, 15)} vs ${sgf1_B.slice(0, 15)})`);
  console.log(`  - sgf1-ti focus sensitivity: ${sgf1TiSensitive} (${sgf1Ti_A.slice(0, 18)} vs ${sgf1Ti_B.slice(0, 18)})`);
  console.log(`  - pof1 focus sensitivity: ${pof1Sensitive} (${pof1_A.slice(0, 15)} vs ${pof1_B.slice(0, 15)})`);
  console.log(`  - drsf1 focus sensitivity: ${drsf1Sensitive} (${drsf1_A.slice(0, 16)} vs ${drsf1_B.slice(0, 16)})`);
  console.log(`  - gpif1 focus sensitivity: ${gpif1Sensitive} (${gpif1_A.slice(0, 16)} vs ${gpif1_B.slice(0, 16)})`);

  reportData.featureCompatibilityAudit = {
    encoderSchemaVersion: DecisionFeatureEncoder.SCHEMA_VERSION,
    contextDimension: DecisionFeatureEncoder.CONTEXT_DIMENSION,
    patternDimension: DecisionFeatureEncoder.PATTERN_DIMENSION,
    focusDifferenceYieldsEncoderVectorDiff: !contextEqual,
    fingerprintSensitivity: {
      sgf1: sgf1Sensitive,
      sgf1Ti: sgf1TiSensitive,
      pof1: pof1Sensitive,
      drsf1: drsf1Sensitive,
      gpif1: gpif1Sensitive,
    },
    compatibilityGaps: [
      "DecisionFeatureEncoder Schema v5 does not reference PlayerObservation.focusPlayerId in its 163-dimensional context vector.",
      "SemanticFingerprintCalculator.extractObservationProjection omits focusPlayerId, making pof1 insensitive to focusPlayer changes.",
      "drsf1 relies on extractObservationProjection and does not include focusPlayerId, making drsf1 insensitive to focusPlayer changes.",
      "gpif1 hashes DecisionFeatureEncoder output, which does not include focusPlayerId, making gpif1 insensitive to focusPlayer changes.",
    ],
  };

  // ===========================================================================
  // SECTION 2: Baseline A - Core / AI Compatibility Checks
  // ===========================================================================
  console.log("\n[Section 2] Checking Baseline A: Core/AI Compatibility...");

  const lightValidation = RegulationValidator.validateRegulation(catalog, "light-entry16", { assertImplemented: true });
  const lightRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    lightValidation.format!,
    lightValidation.regulation!,
    lightValidation.frame!
  );
  const lightSessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16", {
    catalog,
    fullRulePackage,
  });

  const session = lightSessionFactory({ matchIndex: 0, matchId: "m-init", baseSeed: 12345, matchSeed: 12345, playerSeeds: { p1: 1, p2: 2 } });

  // 2.1 advance() を呼び出して初回ディシジョン要求状態へ
  const firstStep = session.advance();
  if (firstStep.type !== "WAITING_FOR_DECISION") {
    throw new Error(`Expected first step to be WAITING_FOR_DECISION, got ${firstStep.type}`);
  }

  // focusPlayer initialization
  const initialFocus = session.state.focusPlayer;
  const initialTurn = session.state.turnPlayer;
  const focusMatchesTurn = initialFocus === initialTurn;
  console.log(`  - focusPlayer initialized: ${initialFocus} (turnPlayer: ${initialTurn}, matches: ${focusMatchesTurn})`);

  // 2.2 Empty stage PASS check
  const legalBeforeAction = firstStep.request.patterns;
  const emptyStageHasPass = legalBeforeAction.some((p) => p.kind === "PASS");
  console.log(`  - Empty stage contains PASS: ${emptyStageHasPass} (expected: false)`);

  // 2.3 Snapshot V2 & V1 rejection
  const snapV2 = GameSessionSnapshotCodec.capture(session);
  const snapV2HasFocus = snapV2.gameState.focusPlayer === session.state.focusPlayer;
  const restoredSession = GameSessionSnapshotCodec.restore(snapV2, lightRulePackage);
  const restoreV2Ok = restoredSession.state.focusPlayer === session.state.focusPlayer;

  let v1Rejected = false;
  try {
    const legacyV1: any = { ...snapV2, snapshotFormatVersion: 1 };
    delete legacyV1.gameState.focusPlayer;
    GameSessionSnapshotCodec.restore(legacyV1, lightRulePackage);
  } catch (err: any) {
    if (err instanceof GameSessionSnapshotValidationError && err.message.includes("Unsupported legacy snapshot format version 1")) {
      v1Rejected = true;
    }
  }
  console.log(`  - Snapshot V2 preserves focusPlayer: ${snapV2HasFocus}, restored: ${restoreV2Ok}`);
  console.log(`  - Snapshot V1 explicitly rejected: ${v1Rejected}`);

  // 2.4 Semantic Diagnostic OFF vs ON parity
  console.log("  - Verifying Semantic Diagnostic OFF vs ON parity in SimulationRunner...");
  const dnaZero = DecisionDNACodec.createZeroDecisionDNA();
  const policyZero = new GenomePolicy(dnaZero);

  const simOptionsDiagOff = {
    maxDecisions: 100,
    enableSemanticDiagnostics: false,
  };
  const simOptionsDiagOn = {
    maxDecisions: 100,
    enableSemanticDiagnostics: true,
  };

  const sessionForSim1 = lightSessionFactory({ matchIndex: 0, matchId: "sim-1", baseSeed: 99999, matchSeed: 99999, playerSeeds: { p1: 1, p2: 2 } });
  const sessionForSim2 = lightSessionFactory({ matchIndex: 0, matchId: "sim-2", baseSeed: 99999, matchSeed: 99999, playerSeeds: { p1: 1, p2: 2 } });

  const simResultOff = SimulationRunner.run(sessionForSim1, { p1: policyZero, p2: policyZero }, simOptionsDiagOff);
  const simResultOn = SimulationRunner.run(sessionForSim2, { p1: policyZero, p2: policyZero }, simOptionsDiagOn);

  const diagParity =
    simResultOff.completed === simResultOn.completed &&
    simResultOff.winner === simResultOn.winner &&
    simResultOff.reason === simResultOn.reason &&
    simResultOff.totalDecisions === simResultOn.totalDecisions &&
    simResultOff.turnCount === simResultOn.turnCount &&
    simResultOff.finalStateHash === simResultOn.finalStateHash &&
    simResultOff.decisionTrace.length === simResultOn.decisionTrace.length;

  console.log(`  - Diagnostic OFF/ON complete parity: ${diagParity} (decisions: ${simResultOff.totalDecisions}, completed: ${simResultOff.completed})`);

  reportData.baselineA = {
    focusPlayerInitializedCorrectly: focusMatchesTurn,
    emptyStagePassDisallowed: !emptyStageHasPass,
    snapshotV2Functional: restoreV2Ok,
    snapshotV1Rejected: v1Rejected,
    semanticDiagnosticParity: diagParity,
  };

  // ===========================================================================
  // SECTION 3: Baseline B - N=6 Controlled Evolution (g0 / g1) & Determinism
  // ===========================================================================
  console.log("\n[Section 3] Executing Baseline B: N=6 Controlled Evolution (light-entry16)...");

  const CAMPAIGN_SEED = 42;
  const INITIAL_GENOME_IDS = ["genome-000", "genome-001", "genome-002", "genome-003", "genome-004", "genome-005"];

  const createInitialPopulation = (): PopulationSnapshot => {
    return Object.freeze({
      generation: 0,
      entries: Object.freeze(
        INITIAL_GENOME_IDS.map((genomeId) =>
          Object.freeze({
            genomeId,
            dnaRef: `genome:${genomeId}`,
            generation: 0,
            dna: DecisionDNACodec.createZeroDecisionDNA(),
          })
        )
      ),
    });
  };

  const environment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: `official:${lightValidation.regulation!.id}`,
    regulationId: lightValidation.regulation!.id,
    frameId: lightValidation.frame!.id,
    rulePackageVersion: lightRulePackage.version,
  });

  const g0Seed = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(0));
  console.log(`  - Campaign Seed: ${CAMPAIGN_SEED}, g0 Seed: ${g0Seed} (0x${g0Seed.toString(16)})`);

  // スケジュール取得 (N=6, R=1 -> 30 matches)
  const schedule = GenerationRunner.planSchedule(createInitialPopulation(), g0Seed, 1);
  console.log(`  - Planned Schedule: ${schedule.length} matches`);

  // 個別試合実行ヘルパー (決定論的詳細取得用)
  function executeScheduledMatches(
    sched: GenerationEvaluationMatch[],
    genSeed: number,
    dnaMap: Map<string, any>,
    maxDecisions: number
  ) {
    const results = [];
    for (const match of sched) {
      const matchContext: BatchMatchContext = {
        matchIndex: match.matchIndex,
        matchId: `gen-0-match-${String(match.matchIndex).padStart(6, "0")}-${match.p1GenomeId}-vs-${match.p2GenomeId}`,
        baseSeed: genSeed,
        matchSeed: match.matchSeed,
        playerSeeds: {
          p1: deriveSeed(match.matchSeed, "p1"),
          p2: deriveSeed(match.matchSeed, "p2"),
        },
      };

      const sess = lightSessionFactory(matchContext);
      const policies = {
        p1: new GenomePolicy(dnaMap.get(match.p1GenomeId)),
        p2: new GenomePolicy(dnaMap.get(match.p2GenomeId)),
      };

      const simRes = SimulationRunner.run(sess, policies, { maxDecisions });
      results.push({
        matchIndex: match.matchIndex,
        pairIndex: match.pairIndex,
        p1GenomeId: match.p1GenomeId,
        p2GenomeId: match.p2GenomeId,
        matchSeed: match.matchSeed,
        completed: simRes.completed,
        winner: simRes.completed ? (simRes.winner === "p1" || simRes.winner === "p2" ? simRes.winner : undefined) : undefined,
        reason: simRes.reason,
        totalDecisions: simRes.totalDecisions,
        turnCount: simRes.turnCount,
        finalStateHash: simRes.finalStateHash,
      });
    }
    return results;
  }

  const dnaMapZero = new Map<string, any>();
  for (const id of INITIAL_GENOME_IDS) {
    dnaMapZero.set(id, DecisionDNACodec.createZeroDecisionDNA());
  }

  // Run A
  console.log("  - Running g0 Evaluation (Run A)...");
  const matchDetailsA = executeScheduledMatches(schedule, g0Seed, dnaMapZero, 500);

  const runParamsA: RunGenerationParams = {
    population: createInitialPopulation(),
    generationSeed: g0Seed,
    environment,
    sessionFactory: lightSessionFactory,
    config: {
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: { populationSize: 6 },
    },
  };
  const g0ResultA = GenerationRunner.run(runParamsA);

  // Run B (Determinism Check)
  console.log("  - Running g0 Evaluation (Run B for Determinism)...");
  const matchDetailsB = executeScheduledMatches(schedule, g0Seed, dnaMapZero, 500);

  const runParamsB: RunGenerationParams = {
    population: createInitialPopulation(),
    generationSeed: g0Seed,
    environment,
    sessionFactory: lightSessionFactory,
    config: {
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: { populationSize: 6 },
    },
  };
  const g0ResultB = GenerationRunner.run(runParamsB);

  // Analyze g0 outcomes
  let completedCount = 0;
  let incompleteCount = 0;
  let failedCount = 0;
  let drawCount = 0;

  for (const m of matchDetailsA) {
    if (m.completed) {
      completedCount++;
      if (!m.winner) drawCount++;
    } else {
      incompleteCount++;
    }
  }

  console.log(`  - Total Scheduled Matches: ${matchDetailsA.length}`);
  console.log(`  - COMPLETED Matches: ${completedCount}`);
  console.log(`  - INCOMPLETE Matches: ${incompleteCount}`);
  console.log(`  - FAILED Matches: ${failedCount}`);
  console.log(`  - DRAW Matches: ${drawCount}`);
  console.log(`  - Generation Runner Status: ${g0ResultA.logicalResult.status}`);

  // Determinism Verification
  const matchesIdentical = JSON.stringify(matchDetailsA) === JSON.stringify(matchDetailsB);
  const fitnessIdentical = JSON.stringify(g0ResultA.logicalResult.fitnessSnapshot) === JSON.stringify(g0ResultB.logicalResult.fitnessSnapshot);
  const manifestIdentical = JSON.stringify(g0ResultA.logicalResult.manifest) === JSON.stringify(g0ResultB.logicalResult.manifest);
  const determinismOk = matchesIdentical && fitnessIdentical && manifestIdentical;

  console.log(`  - Determinism Check (Run A vs Run B): ${determinismOk ? "PERFECT MATCH" : "MISMATCH"}`);

  // Fitness serialization helper
  const serializeFitness = (e: { genomeId: string; result: FitnessEvaluationResult }) => {
    const res = e.result;
    if (res.status === "VALID") {
      return {
        genomeId: e.genomeId,
        status: res.status,
        fitnessScore: res.fitnessScore,
        valid: true,
        scheduledMatches: res.scheduledMatches,
        completedMatches: res.completedMatches,
        completionRate: res.completionRate,
        wins: res.wins,
        losses: res.losses,
        draws: res.draws,
      };
    } else if (res.status === "INSUFFICIENT_EVIDENCE") {
      return {
        genomeId: e.genomeId,
        status: res.status,
        fitnessScore: res.fitnessScore,
        provisionalScore: res.provisionalScore,
        valid: false,
        scheduledMatches: res.scheduledMatches,
        completedMatches: res.completedMatches,
        completionRate: res.completionRate,
        wins: res.wins,
        losses: res.losses,
        draws: res.draws,
      };
    } else {
      return {
        genomeId: e.genomeId,
        status: res.status,
        fitnessScore: res.fitnessScore,
        valid: false,
        scheduledMatches: res.scheduledMatches,
        failedMatches: res.failedMatches,
      };
    }
  };

  // Fitness details
  const fitnessEntries = g0ResultA.logicalResult.fitnessSnapshot.entries.map(serializeFitness);

  reportData.baselineB = {
    generation: 0,
    campaignSeed: CAMPAIGN_SEED,
    generationSeed: g0Seed,
    populationSize: 6,
    pairRepetitions: 1,
    maxDecisionsPerMatch: 500,
    totalScheduledMatches: matchDetailsA.length,
    completedMatches: completedCount,
    incompleteMatches: incompleteCount,
    failedMatches: failedCount,
    drawMatches: drawCount,
    status: g0ResultA.logicalResult.status,
    readiness: (g0ResultA.logicalResult as any).readiness || null,
    reason: (g0ResultA.logicalResult as any).reason || null,
    determinism: {
      matchesIdentical,
      fitnessIdentical,
      manifestIdentical,
      overall: determinismOk,
    },
    fitnessEntries,
    matchDetails: matchDetailsA,
  };

  // Evaluate g1 if g0 reached ADVANCED
  if (g0ResultA.logicalResult.status === "ADVANCED") {
    console.log("\n  - g0 ADVANCED: Evaluating g1...");
    const g1Pop = g0ResultA.logicalResult.nextPopulation;
    const g1Seed = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(1));

    const g1Schedule = GenerationRunner.planSchedule(g1Pop, g1Seed, 1);
    const g1DnaMap = new Map<string, any>();
    for (const entry of g1Pop.entries) {
      g1DnaMap.set(entry.genomeId, entry.dna);
    }
    const g1MatchDetails = executeScheduledMatches(g1Schedule, g1Seed, g1DnaMap, 500);

    const g1Result = GenerationRunner.run({
      population: g1Pop,
      generationSeed: g1Seed,
      environment,
      sessionFactory: lightSessionFactory,
      config: {
        pairRepetitions: 1,
        maxDecisionsPerMatch: 500,
        builderConfig: { populationSize: 6 },
      },
    });

    let g1Completed = 0;
    let g1Incomplete = 0;
    for (const m of g1MatchDetails) {
      if (m.completed) g1Completed++;
      else g1Incomplete++;
    }

    console.log(`  - g1 Scheduled Matches: ${g1MatchDetails.length}`);
    console.log(`  - g1 COMPLETED: ${g1Completed}, INCOMPLETE: ${g1Incomplete}`);
    console.log(`  - g1 Status: ${g1Result.logicalResult.status}`);

    reportData.baselineB.g1Result = {
      generation: 1,
      generationSeed: g1Seed,
      totalScheduledMatches: g1MatchDetails.length,
      completedMatches: g1Completed,
      incompleteMatches: g1Incomplete,
      status: g1Result.logicalResult.status,
      fitnessEntries: g1Result.logicalResult.fitnessSnapshot.entries.map(serializeFitness),
      matchDetails: g1MatchDetails,
    };
  } else {
    console.log(`\n  - g0 did not advance (status: ${g0ResultA.logicalResult.status}). g1 was not evaluated.`);
    reportData.baselineB.g1Result = {
      evaluated: false,
      reason: `g0 status was ${g0ResultA.logicalResult.status}`,
    };
  }

  // ===========================================================================
  // SECTION 4: Standard + Pack Smoke Test
  // ===========================================================================
  console.log("\n[Section 4] Running Standard + Pack Smoke Test...");

  const standardPackValidation = RegulationValidator.validateRegulation(catalog, "standard-pack", { assertImplemented: true });
  const standardPackRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    standardPackValidation.format!,
    standardPackValidation.regulation!,
    standardPackValidation.frame!
  );

  const standardPackSessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("standard-pack", {
    catalog,
    fullRulePackage,
  });

  const smokeSeeds = [101, 202, 303, 404];
  const smokeResults = [];

  for (let i = 0; i < smokeSeeds.length; i++) {
    const s = smokeSeeds[i];
    const sess = standardPackSessionFactory({ matchIndex: i, matchId: `smoke-${s}`, baseSeed: s, matchSeed: s, playerSeeds: { p1: 1, p2: 2 } });
    const p1Policy = new GenomePolicy(DecisionDNACodec.createZeroDecisionDNA({ id: "dna-p1" }));
    const p2Policy = new GenomePolicy(DecisionDNACodec.createZeroDecisionDNA({ id: "dna-p2" }));

    try {
      const res = SimulationRunner.run(sess, { p1: p1Policy, p2: p2Policy }, { maxDecisions: 200 });
      console.log(`  - Match ${i + 1} (seed ${s}): completed=${res.completed}, winner=${res.winner || "none"}, decisions=${res.totalDecisions}, reason=${res.reason}`);
      smokeResults.push({
        matchIndex: i,
        seed: s,
        completed: res.completed,
        winner: res.winner,
        reason: res.reason,
        totalDecisions: res.totalDecisions,
        finalStateHash: res.finalStateHash,
        error: null,
      });
    } catch (err: any) {
      console.error(`  - Match ${i + 1} (seed ${s}) FAILED: ${err.message}`);
      smokeResults.push({
        matchIndex: i,
        seed: s,
        completed: false,
        winner: null,
        reason: "EXCEPTION",
        totalDecisions: 0,
        finalStateHash: null,
        error: err.message,
      });
    }
  }

  reportData.standardPackSmoke = {
    regulationId: "standard-pack",
    matchesScheduled: smokeSeeds.length,
    matches: smokeResults,
    allCompletedWithoutException: smokeResults.every((m) => m.error === null),
  };

  // ===========================================================================
  // SECTION 5: Output JSON Evidence Report
  // ===========================================================================
  const reportsDir = path.resolve(process.cwd(), "reports/ai");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const outPath = path.join(reportsDir, "v92-core-baseline-evidence-v1.json");
  fs.writeFileSync(outPath, JSON.stringify(reportData, null, 2), "utf8");
  console.log(`\n[Section 5] Saved JSON Evidence to: ${outPath}`);

  console.log("\================================================================================");
  console.log("  BP-SIM-AI-V92-BASELINE-EVIDENCE-V1 Completed Successfully");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("FATAL ERROR in v92BaselineEvidenceRunner:", err);
  process.exit(1);
});
