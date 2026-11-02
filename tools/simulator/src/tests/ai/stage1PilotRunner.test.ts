import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  WORK_ID,
  REGULATION_ID,
  FRAME_ID,
  POPULATION_SIZE,
  TOTAL_GENERATIONS,
  CAMPAIGN_SEED,
  VALIDATION_SEEDS,
  createStage1InitialPopulation,
  createStage1ValidationOpponents,
  runPreflightCheck,
} from "../../cli/stage1PilotRunner.js";
import {
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
} from "../../domain/ai/DecisionDNATypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Stage 1 Small Pilot CLI & Preflight Foundation (Work 3-3)", () => {
  const tempTestDir = path.resolve(__dirname, `../../.tmp_stage1_cli_test_${Date.now()}`);

  it("Test 1: createStage1InitialPopulation creates exact N=6 population with valid Decision DNA", () => {
    const pop = createStage1InitialPopulation();
    expect(pop.generation).toBe(0);
    expect(pop.entries.length).toBe(POPULATION_SIZE);
    expect(pop.entries.length).toBe(6);

    for (let i = 0; i < pop.entries.length; i++) {
      const entry = pop.entries[i];
      expect(entry.genomeId).toBe(`ind-g0-${String(i).padStart(3, "0")}`);
      expect(entry.generation).toBe(0);
      expect(entry.dna.dnaFormatVersion).toBe(1);
      expect(entry.dna.featureSchemaVersion).toBe(6);
      expect(entry.dna.patternWeights.length).toBe(DNA_PATTERN_DIMENSION);
      expect(entry.dna.contextPatternWeights.length).toBe(DNA_INTERACTION_DIMENSION);
    }
  });

  it("Test 2: createStage1ValidationOpponents creates exactly FirstLegal and SeededRandom Baseline opponents", () => {
    const opponents = createStage1ValidationOpponents();
    expect(opponents.length).toBe(2);

    const firstLegal = opponents.find((o) => o.opponentId === "baseline-first-legal");
    expect(firstLegal).toBeDefined();
    expect(firstLegal?.role).toBe("BASELINE");
    expect(firstLegal?.name).toBe("FirstLegal");

    const seededRandom = opponents.find((o) => o.opponentId === "baseline-seeded-random");
    expect(seededRandom).toBeDefined();
    expect(seededRandom?.role).toBe("BASELINE");
    expect(seededRandom?.name).toBe("SeededRandom");
  });

  it("Test 3: runPreflightCheck passes on standard environment and generates valid manifest", async () => {
    if (!fs.existsSync(tempTestDir)) {
      fs.mkdirSync(tempTestDir, { recursive: true });
    }

    try {
      const preflight = await runPreflightCheck(tempTestDir);
      expect(preflight.errors).toEqual([]);
      expect(preflight.passed).toBe(true);
      expect(preflight.errors.length).toBe(0);

      const m = preflight.manifest;
      expect(m.workId).toBe(WORK_ID);
      expect(m.regulationId).toBe(REGULATION_ID);
      expect(m.frameId).toBe(FRAME_ID);
      expect(m.populationSize).toBe(6);
      expect(m.totalGenerations).toBe(2);
      expect(m.pairRepetitions).toBe(1);
      expect(m.campaignSeed).toBe(CAMPAIGN_SEED);
      expect(m.validationSeeds).toEqual(VALIDATION_SEEDS);
      expect(m.earlyStoppingEnabled).toBe(false);
      expect(m.holdoutMatchesPlanned).toBe(0);

      // Training Schedule は各世代 30 試合（計 60 試合）
      expect(m.plannedTrainingMatchesByGen[0]).toBe(30);
      expect(m.plannedTrainingMatchesByGen[1]).toBe(30);
      expect(m.plannedTrainingSeedsByGen[0].length).toBe(30);
      expect(m.plannedTrainingSeedsByGen[1].length).toBe(30);
    } finally {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    }
  });
});
