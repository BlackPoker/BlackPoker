import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { EvolutionLoop } from "../engine/ai/EvolutionLoop";
import {
  EvolutionLoopConfig,
  EvolutionLoopExecutionResult,
  RunEvolutionLoopParams,
  canonicalGenerationStreamKey,
  canonicalLoopSeedScheduleIdentity,
} from "../domain/ai/EvolutionLoopTypes";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { GenerationRunnerEnvironmentContext } from "../domain/ai/GenerationRunnerTypes";
import { PopulationSnapshot, PopulationEntry } from "../domain/ai/PopulationSelectionTypes";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { deriveSeed } from "../engine/random/DeterministicShuffle";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Fail-closed assertion helper for evidence verification
 */
function assertEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`EVIDENCE_ASSERTION_FAILED: ${message}`);
  }
}

/**
 * Deep equality comparison for logical results
 */
function isDeepEqual(objA: unknown, objB: unknown): boolean {
  return JSON.stringify(objA) === JSON.stringify(objB);
}

/**
 * SHA-256 digest helper
 */
function computeSha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export interface GenerationEvidenceSummary {
  sourceGeneration: number;
  targetGeneration: number;
  generationSeed: number;
  generationSeedHex: string;
  populationSize: number;
  scheduledMatches: number;
  completedMatches: number;
  incompleteMatches: number;
  validFitnessCount: number;
  insufficientFitnessCount: number;
  invalidFitnessCount: number;
  buildEliteCount: number;
  buildOffspringCount: number;
  lineagesCount: number;
  eliteGenomeIds: string[];
  offspringGenomeIds: string[];
  outputGenomeIds: string[];
  runnerExecutionTimeMs?: number;
  runnerTotalDecisions?: number;
}

export interface RunEvidenceSummary {
  runLabel: string;
  status: string;
  completedTransitions: number;
  finalGeneration: number;
  finalPopulationSize: number;
  finalGenomeIds: string[];
  logicalDigest: string;
  wallClockElapsedMs: number;
  loopExecutionTimeMs: number;
  totalDecisions: number;
  generations: GenerationEvidenceSummary[];
  lineageChainValid: boolean;
}

export interface ControlledMultiGenEvidenceReport {
  workId: string;
  timestamp: string;
  nodeVersion: string;
  environment: {
    regulationId: string;
    formatId: string;
    frameId: string;
    rulePackageVersion: string;
    environmentRef: string;
  };
  recipe: {
    initialN: number;
    initialGeneration: number;
    genomeIds: string[];
    campaignSeed: number;
    generationCount: number;
    pairRepetitions: number;
    maxDecisionsPerMatch: number;
    builderPopulationSize: number;
  };
  seedSchedule: {
    identity: string;
    g0: { decimal: number; hex: string };
    g1: { decimal: number; hex: string };
    g2: { decimal: number; hex: string };
  };
  runA: RunEvidenceSummary;
  runB: RunEvidenceSummary;
  determinism: {
    digestsEqual: boolean;
    logicalDeepEqual: boolean;
    runtimeExcludedFromDeterminism: boolean;
  };
  matchAccounting: {
    scheduledPerGeneration: number;
    scheduledPerRun: number;
    runsCount: number;
    totalScheduledMatches: number;
    runACompletedMatches: number;
    runAIncompleteMatches: number;
    runBCompletedMatches: number;
    runBIncompleteMatches: number;
  };
  lineageConservation: {
    g0SourceIds: string[];
    g1ReconstructedIds: string[];
    g2ReconstructedIds: string[];
    g3ReconstructedIds: string[];
    eliteSourceMembership: boolean;
    parentSourceMembership: boolean;
    offspringGenerationExact: boolean;
    offspringIndexContinuous: boolean;
    finalPopulationSetMatch: boolean;
    allPassed: boolean;
  };
  finalPopulation: {
    generation: number;
    size: number;
    uniqueIds: number;
    canonicalDnaRef: boolean;
  };
}

async function runControlledMultiGenerationEvidence(): Promise<ControlledMultiGenEvidenceReport> {
  const processStartTime = Date.now();
  console.log("================================================================================");
  console.log("  BLACKPOKER SIMULATOR - CONTROLLED MULTI-GENERATION EVIDENCE V1");
  console.log("  Work ID: BP-SIM-AI-EVOLUTION-LOOP-EVIDENCE-V1");
  console.log("================================================================================");

  // 1. 環境とルールの初期化 (Production Path)
  console.log("\n[1/6] Loading Official Regulation Catalog & Rules...");
  const catalog = await loadRegulationCatalog();
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
    assertImplemented: true,
  });

  const regulation = validation.regulation!;
  const format = validation.format!;
  const frame = validation.frame!;

  const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    format,
    regulation,
    frame
  );

  console.log(`  - Regulation: ${regulation.id} (${regulation.name})`);
  console.log(`  - Format: ${format.id} (${format.name})`);
  console.log(`  - Frame: ${frame.id} (${frame.name})`);
  console.log(`  - Rule Package: ${officialRulePackage.id} v${officialRulePackage.version}`);

  const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16", {
    catalog,
    fullRulePackage,
  });

  const environment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: `official:${regulation.id}`,
    regulationId: regulation.id,
    frameId: frame.id,
    rulePackageVersion: officialRulePackage.version,
  });

  // 2. カノニカルレシピ & シードスケジュール検証
  console.log("\n[2/6] Verifying Canonical Recipe & Seed Schedule...");
  const CAMPAIGN_SEED = 42;
  const GENERATION_COUNT = 3;
  const INITIAL_GENOME_IDS = [
    "genome-000",
    "genome-001",
    "genome-002",
    "genome-003",
    "genome-004",
    "genome-005",
  ];

  // Canonical Seed Schedule Exact Assertions (Design Section 7)
  const seedG0 = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(0));
  const seedG1 = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(1));
  const seedG2 = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(2));

  assertEvidence(seedG0 === 4143575905, `seedG0 mismatch: expected 4143575905, got ${seedG0}`);
  assertEvidence(seedG1 === 4126798286, `seedG1 mismatch: expected 4126798286, got ${seedG1}`);
  assertEvidence(seedG2 === 4110020667, `seedG2 mismatch: expected 4110020667, got ${seedG2}`);

  console.log(`  - g=0 seed: ${seedG0} (0x${seedG0.toString(16)})`);
  console.log(`  - g=1 seed: ${seedG1} (0x${seedG1.toString(16)})`);
  console.log(`  - g=2 seed: ${seedG2} (0x${seedG2.toString(16)})`);
  console.log(`  - Seed Schedule Identity: ${canonicalLoopSeedScheduleIdentity(CAMPAIGN_SEED)}`);

  const createFreshInitialPopulation = (): PopulationSnapshot => {
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

  const loopConfig: EvolutionLoopConfig = Object.freeze({
    generationCount: GENERATION_COUNT,
    runnerConfig: Object.freeze({
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: Object.freeze({
        populationSize: 6,
      }),
    }),
  });

  // ヘルパー: 単一 Run の実行および検証
  const executeAndVerifyRun = (runLabel: string): { summary: RunEvidenceSummary; result: EvolutionLoopExecutionResult } => {
    console.log(`\n  Executing EvolutionLoop ${runLabel}...`);
    const initialPop = createFreshInitialPopulation();
    const initialPopClone = JSON.parse(JSON.stringify(initialPop));

    const params: RunEvolutionLoopParams = {
      initialPopulation: initialPop,
      campaignSeed: CAMPAIGN_SEED,
      environment,
      sessionFactory,
      config: loopConfig,
    };

    const wallClockStart = Date.now();
    const result = EvolutionLoop.run(params);
    const wallClockElapsedMs = Date.now() - wallClockStart;

    // AC56: 初期母集団が不変であることを検証
    assertEvidence(
      JSON.stringify(initialPop) === JSON.stringify(initialPopClone),
      `${runLabel}: initialPopulation was mutated during EvolutionLoop.run`
    );

    const { logicalResult, runtimeMetrics } = result;

    // AC27 / AC28: status === "COMPLETED"
    assertEvidence(
      logicalResult.status === "COMPLETED",
      `${runLabel}: Expected status COMPLETED, got ${logicalResult.status}`
    );

    // AC29: completedTransitions === 3, finalPopulation.generation === 3
    assertEvidence(
      logicalResult.completedTransitions === 3,
      `${runLabel}: Expected completedTransitions 3, got ${logicalResult.completedTransitions}`
    );
    assertEvidence(
      logicalResult.finalPopulation.generation === 3,
      `${runLabel}: Expected finalPopulation.generation 3, got ${logicalResult.finalPopulation.generation}`
    );

    // AC30: finalPopulation.entries.length === 6
    assertEvidence(
      logicalResult.finalPopulation.entries.length === 6,
      `${runLabel}: Expected finalPopulation size 6, got ${logicalResult.finalPopulation.entries.length}`
    );

    // AC21: Loop Manifest exact
    assertEvidence(logicalResult.manifest.initialGeneration === 0, `${runLabel}: manifest.initialGeneration != 0`);
    assertEvidence(logicalResult.manifest.requestedTransitions === 3, `${runLabel}: manifest.requestedTransitions != 3`);
    assertEvidence(logicalResult.manifest.targetGeneration === 3, `${runLabel}: manifest.targetGeneration != 3`);
    assertEvidence(logicalResult.manifest.campaignSeed === CAMPAIGN_SEED, `${runLabel}: manifest.campaignSeed != 42`);
    assertEvidence(
      logicalResult.manifest.generationSeedScheduleIdentity === canonicalLoopSeedScheduleIdentity(CAMPAIGN_SEED),
      `${runLabel}: manifest.generationSeedScheduleIdentity mismatch`
    );

    // AC22: 3 Generation Records
    assertEvidence(logicalResult.generations.length === 3, `${runLabel}: generations length != 3`);

    let currentSourceIds = [...INITIAL_GENOME_IDS];
    const generationSummaries: GenerationEvidenceSummary[] = [];
    let runTotalDecisions = 0;

    for (let g = 0; g < 3; g++) {
      const rec = logicalResult.generations[g];
      assertEvidence(rec.status === "ADVANCED", `${runLabel} gen ${g}: status != ADVANCED`);
      assertEvidence(rec.sourceGeneration === g, `${runLabel} gen ${g}: sourceGeneration mismatch`);
      assertEvidence(rec.targetGeneration === g + 1, `${runLabel} gen ${g}: targetGeneration mismatch`);

      const expectedSeed = g === 0 ? seedG0 : g === 1 ? seedG1 : seedG2;
      assertEvidence(rec.generationSeed === expectedSeed, `${runLabel} gen ${g}: seed mismatch`);

      // AC18: Manifest verification
      assertEvidence(rec.manifest.generation === g, `${runLabel} gen ${g}: manifest.generation != ${g}`);
      assertEvidence(rec.manifest.populationSize === 6, `${runLabel} gen ${g}: manifest.populationSize != 6`);
      assertEvidence(rec.manifest.pairRepetitions === 1, `${runLabel} gen ${g}: manifest.pairRepetitions != 1`);
      assertEvidence(rec.manifest.totalMatches === 30, `${runLabel} gen ${g}: manifest.totalMatches != 30`);
      assertEvidence(
        rec.manifest.evaluationScheduleId === "double-round-robin-v1:r=1:max-decisions=500",
        `${runLabel} gen ${g}: manifest.evaluationScheduleId mismatch`
      );
      assertEvidence(
        rec.manifest.seedScheduleIdentity === `evolution-evaluation-pair-v1:generation-seed=${expectedSeed}`,
        `${runLabel} gen ${g}: manifest.seedScheduleIdentity mismatch`
      );

      // AC37 / AC38 / AC39: Fitness verification
      assertEvidence(rec.fitnessSnapshot.generation === g, `${runLabel} gen ${g}: fitnessSnapshot.generation != ${g}`);
      assertEvidence(rec.fitnessSnapshot.entries.length === 6, `${runLabel} gen ${g}: fitness entries length != 6`);

      let participantCompletedSum = 0;
      let validCount = 0;
      let insufficientCount = 0;
      let invalidCount = 0;

      for (const entry of rec.fitnessSnapshot.entries) {
        assertEvidence(
          entry.result.scheduledMatches === 10,
          `${runLabel} gen ${g} entry ${entry.genomeId}: scheduledMatches != 10`
        );
        if (entry.result.status === "INVALID") {
          invalidCount++;
        } else {
          // AC39: Conservation on VALID / INSUFFICIENT_EVIDENCE
          assertEvidence(
            entry.result.wins + entry.result.losses + entry.result.draws === entry.result.completedMatches,
            `${runLabel} gen ${g} entry ${entry.genomeId}: wins + losses + draws != completedMatches`
          );
          assertEvidence(
            entry.result.completedMatches <= entry.result.scheduledMatches,
            `${runLabel} gen ${g} entry ${entry.genomeId}: completedMatches > scheduledMatches`
          );

          participantCompletedSum += entry.result.completedMatches;

          if (entry.result.status === "VALID") {
            validCount++;
          } else {
            insufficientCount++;
          }
        }
      }

      // AC40: INVALID == 0
      assertEvidence(invalidCount === 0, `${runLabel} gen ${g}: INVALID fitness count (${invalidCount}) > 0`);
      assertEvidence(participantCompletedSum % 2 === 0, `${runLabel} gen ${g}: participantCompletedSum is odd`);

      const completedMatches = participantCompletedSum / 2;
      const incompleteMatches = 30 - completedMatches;

      assertEvidence(completedMatches <= 30, `${runLabel} gen ${g}: completedMatches > 30`);
      assertEvidence(incompleteMatches >= 0, `${runLabel} gen ${g}: incompleteMatches < 0`);

      // AC43 / AC44 / AC45 / AC46: Build Metadata verification
      const { buildMetadata } = rec;
      assertEvidence(buildMetadata.sourceGeneration === g, `${runLabel} gen ${g}: build sourceGeneration != ${g}`);
      assertEvidence(buildMetadata.targetGeneration === g + 1, `${runLabel} gen ${g}: build targetGeneration != ${g + 1}`);
      assertEvidence(buildMetadata.generationSeed === expectedSeed, `${runLabel} gen ${g}: build generationSeed mismatch`);
      assertEvidence(buildMetadata.populationSize === 6, `${runLabel} gen ${g}: build populationSize != 6`);
      assertEvidence(buildMetadata.eliteCount === 1, `${runLabel} gen ${g}: build eliteCount != 1`);
      assertEvidence(buildMetadata.offspringCount === 5, `${runLabel} gen ${g}: build offspringCount != 5`);
      assertEvidence(buildMetadata.offspringLineages.length === 5, `${runLabel} gen ${g}: offspringLineages length != 5`);

      // AC47: Elite IDs belong to source population ID set
      for (const eliteId of buildMetadata.eliteGenomeIds) {
        assertEvidence(
          currentSourceIds.includes(eliteId),
          `${runLabel} gen ${g}: elite ID '${eliteId}' not in source IDs: ${currentSourceIds.join(", ")}`
        );
      }

      // AC48 / AC49 / AC50: Offspring lineage verification
      const observedOffspringIndices: number[] = [];
      const offspringGenomeIds: string[] = [];

      for (const lineage of buildMetadata.offspringLineages) {
        assertEvidence(
          lineage.generation === g + 1,
          `${runLabel} gen ${g} lineage ${lineage.genomeId}: generation != ${g + 1}`
        );
        observedOffspringIndices.push(lineage.offspringIndex);
        offspringGenomeIds.push(lineage.genomeId);

        // Parent IDs must belong to currentSourceIds
        for (const parentId of lineage.parentGenomeIds) {
          assertEvidence(
            currentSourceIds.includes(parentId),
            `${runLabel} gen ${g} lineage ${lineage.genomeId}: parent ID '${parentId}' not in source IDs`
          );
        }
      }

      observedOffspringIndices.sort((a, b) => a - b);
      assertEvidence(
        JSON.stringify(observedOffspringIndices) === JSON.stringify([0, 1, 2, 3, 4]),
        `${runLabel} gen ${g}: offspring indices are not exactly [0, 1, 2, 3, 4]`
      );

      // Reconstruct output IDs: elite + offspring (6 unique IDs)
      const outputGenomeIds = [...buildMetadata.eliteGenomeIds, ...offspringGenomeIds];
      const uniqueOutputIds = new Set(outputGenomeIds);
      assertEvidence(uniqueOutputIds.size === 6, `${runLabel} gen ${g}: output IDs not unique (size: ${uniqueOutputIds.size})`);

      // Next generation source IDs
      currentSourceIds = outputGenomeIds;

      const runtimeRec = runtimeMetrics.generations[g];
      const genDecisions = runtimeRec?.runnerMetrics?.totalDecisions ?? 0;
      runTotalDecisions += genDecisions;

      generationSummaries.push({
        sourceGeneration: g,
        targetGeneration: g + 1,
        generationSeed: expectedSeed,
        generationSeedHex: `0x${expectedSeed.toString(16)}`,
        populationSize: 6,
        scheduledMatches: 30,
        completedMatches,
        incompleteMatches,
        validFitnessCount: validCount,
        insufficientFitnessCount: insufficientCount,
        invalidFitnessCount: invalidCount,
        buildEliteCount: buildMetadata.eliteCount,
        buildOffspringCount: buildMetadata.offspringCount,
        lineagesCount: buildMetadata.offspringLineages.length,
        eliteGenomeIds: [...buildMetadata.eliteGenomeIds],
        offspringGenomeIds,
        outputGenomeIds,
        runnerExecutionTimeMs: runtimeRec?.runnerMetrics?.totalExecutionTimeMs,
        runnerTotalDecisions: genDecisions,
      });
    }

    // AC52 / AC53 / AC54 / AC55: Final Population verification
    const finalIds = logicalResult.finalPopulation.entries.map((e) => e.genomeId);
    const finalIdSet = new Set(finalIds);
    assertEvidence(finalIdSet.size === 6, `${runLabel}: final IDs not unique (size: ${finalIdSet.size})`);

    const expectedFinalIdSet = new Set(currentSourceIds);
    assertEvidence(
      finalIdSet.size === expectedFinalIdSet.size && [...finalIdSet].every((id) => expectedFinalIdSet.has(id)),
      `${runLabel}: finalPopulation IDs do not match reconstructed g2 output IDs`
    );

    for (const entry of logicalResult.finalPopulation.entries) {
      assertEvidence(entry.generation === 3, `${runLabel} entry ${entry.genomeId}: generation != 3`);
      assertEvidence(
        entry.dnaRef === `genome:${entry.genomeId}`,
        `${runLabel} entry ${entry.genomeId}: dnaRef mismatch (${entry.dnaRef})`
      );
    }

    const logicalString = JSON.stringify(logicalResult);
    const logicalDigest = computeSha256(logicalString);

    const summary: RunEvidenceSummary = {
      runLabel,
      status: logicalResult.status,
      completedTransitions: logicalResult.completedTransitions,
      finalGeneration: logicalResult.finalPopulation.generation,
      finalPopulationSize: logicalResult.finalPopulation.entries.length,
      finalGenomeIds: finalIds,
      logicalDigest,
      wallClockElapsedMs,
      loopExecutionTimeMs: runtimeMetrics.totalExecutionTimeMs,
      totalDecisions: runTotalDecisions,
      generations: generationSummaries,
      lineageChainValid: true,
    };

    return { summary, result };
  };

  // 3. Run A 実行 (90 matches)
  console.log("\n[3/6] Starting Run A (Official light-entry16, g0 -> g3, 90 scheduled matches)...");
  const { summary: runA, result: resultA } = executeAndVerifyRun("Run A");
  console.log(`  - Run A Status: ${runA.status}`);
  console.log(`  - Run A Transitions: ${runA.completedTransitions}/3`);
  console.log(`  - Run A Final Gen: ${runA.finalGeneration}, Final Size: ${runA.finalPopulationSize}`);
  console.log(`  - Run A Wall Clock: ${runA.wallClockElapsedMs} ms, Decisions: ${runA.totalDecisions}`);
  console.log(`  - Run A Logical SHA-256: ${runA.logicalDigest}`);

  // 4. Run B 実行 (90 matches)
  console.log("\n[4/6] Starting Run B (Deterministic Replica, g0 -> g3, 90 scheduled matches)...");
  const { summary: runB, result: resultB } = executeAndVerifyRun("Run B");
  console.log(`  - Run B Status: ${runB.status}`);
  console.log(`  - Run B Transitions: ${runB.completedTransitions}/3`);
  console.log(`  - Run B Final Gen: ${runB.finalGeneration}, Final Size: ${runB.finalPopulationSize}`);
  console.log(`  - Run B Wall Clock: ${runB.wallClockElapsedMs} ms, Decisions: ${runB.totalDecisions}`);
  console.log(`  - Run B Logical SHA-256: ${runB.logicalDigest}`);

  // 5. 決定論性検証 (Run A vs Run B)
  console.log("\n[5/6] Verifying 100% Deterministic Equality between Run A and Run B...");
  const digestsEqual = runA.logicalDigest === runB.logicalDigest;
  assertEvidence(digestsEqual, `Determinism Digest Mismatch: Run A (${runA.logicalDigest}) != Run B (${runB.logicalDigest})`);

  const logicalDeepEqual = isDeepEqual(resultA.logicalResult, resultB.logicalResult);
  assertEvidence(logicalDeepEqual, "Determinism Deep Equal Mismatch: JSON round-trip mismatch between Run A and Run B");

  console.log(`  - Digest Equality: ${digestsEqual ? "MATCH (100%)" : "FAILED"}`);
  console.log(`  - Logical Deep Equal: ${logicalDeepEqual ? "MATCH (100%)" : "FAILED"}`);
  console.log(`  - Runtime Sidecars: EXCLUDED from determinism check (Diagnostic Only)`);

  // 6. Match Accounting & Lineage Conservation Report
  console.log("\n[6/6] Compiling Match Accounting & Lineage Conservation Report...");
  const runACompleted = runA.generations.reduce((sum, g) => sum + g.completedMatches, 0);
  const runAIncomplete = runA.generations.reduce((sum, g) => sum + g.incompleteMatches, 0);
  const runBCompleted = runB.generations.reduce((sum, g) => sum + g.completedMatches, 0);
  const runBIncomplete = runB.generations.reduce((sum, g) => sum + g.incompleteMatches, 0);

  const report: ControlledMultiGenEvidenceReport = {
    workId: "BP-SIM-AI-EVOLUTION-LOOP-EVIDENCE-V1",
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    environment: {
      regulationId: regulation.id,
      formatId: format.id,
      frameId: frame.id,
      rulePackageVersion: officialRulePackage.version,
      environmentRef: environment.environmentRef,
    },
    recipe: {
      initialN: 6,
      initialGeneration: 0,
      genomeIds: INITIAL_GENOME_IDS,
      campaignSeed: CAMPAIGN_SEED,
      generationCount: GENERATION_COUNT,
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderPopulationSize: 6,
    },
    seedSchedule: {
      identity: canonicalLoopSeedScheduleIdentity(CAMPAIGN_SEED),
      g0: { decimal: seedG0, hex: `0x${seedG0.toString(16)}` },
      g1: { decimal: seedG1, hex: `0x${seedG1.toString(16)}` },
      g2: { decimal: seedG2, hex: `0x${seedG2.toString(16)}` },
    },
    runA,
    runB,
    determinism: {
      digestsEqual,
      logicalDeepEqual,
      runtimeExcludedFromDeterminism: true,
    },
    matchAccounting: {
      scheduledPerGeneration: 30,
      scheduledPerRun: 90,
      runsCount: 2,
      totalScheduledMatches: 180,
      runACompletedMatches: runACompleted,
      runAIncompleteMatches: runAIncomplete,
      runBCompletedMatches: runBCompleted,
      runBIncompleteMatches: runBIncomplete,
    },
    lineageConservation: {
      g0SourceIds: INITIAL_GENOME_IDS,
      g1ReconstructedIds: runA.generations[0].outputGenomeIds,
      g2ReconstructedIds: runA.generations[1].outputGenomeIds,
      g3ReconstructedIds: runA.generations[2].outputGenomeIds,
      eliteSourceMembership: true,
      parentSourceMembership: true,
      offspringGenerationExact: true,
      offspringIndexContinuous: true,
      finalPopulationSetMatch: true,
      allPassed: true,
    },
    finalPopulation: {
      generation: 3,
      size: 6,
      uniqueIds: 6,
      canonicalDnaRef: true,
    },
  };

  const totalWallClock = Date.now() - processStartTime;
  console.log("\n================================================================================");
  console.log("  EVIDENCE EXECUTION SUCCESSFUL");
  console.log(`  Total Scheduled Matches Executed: 180 (Run A: 90 + Run B: 90)`);
  console.log(`  Completed / Incomplete Run A: ${runACompleted} / ${runAIncomplete}`);
  console.log(`  Completed / Incomplete Run B: ${runBCompleted} / ${runBIncomplete}`);
  console.log(`  Total Process Time: ${totalWallClock} ms (${(totalWallClock / 1000).toFixed(2)} s)`);
  console.log("================================================================================");

  // Return clean JSON representation
  console.log("\n--- STRUCTURED EVIDENCE JSON SUMMARY ---");
  console.log(JSON.stringify(report, null, 2));
  console.log("--- END SUMMARY ---");

  return report;
}

runControlledMultiGenerationEvidence().catch((err) => {
  console.error("FATAL EVIDENCE ERROR:", err);
  process.exit(1);
});
