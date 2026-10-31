import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { GenomePolicy } from "../../engine/ai/GenomePolicy.js";
import { SeededRandom } from "../../engine/random/RandomSource.js";
import { RandomPolicy } from "../../engine/simulation/DecisionPolicy.js";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner.js";
import { loadRegulationCatalog, RegulationCatalog } from "../../engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory.js";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes.js";
import { deriveSeed } from "../../engine/random/DeterministicShuffle.js";
import * as crypto from "crypto";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function computeDnaDigests(dna: DecisionDNA) {
  const pDigest = sha256(JSON.stringify(dna.patternWeights));
  const cpDigest = sha256(JSON.stringify(dna.contextPatternWeights));
  const fullDigest = sha256(
    JSON.stringify({
      dnaFormatVersion: dna.dnaFormatVersion,
      featureSchemaVersion: dna.featureSchemaVersion,
      scoringModel: dna.scoringModel,
      contextDimension: dna.contextDimension,
      patternDimension: dna.patternDimension,
      patternWeights: dna.patternWeights,
      contextPatternWeights: dna.contextPatternWeights,
    })
  );
  return {
    totalWeights: dna.patternWeights.length + dna.contextPatternWeights.length,
    patternWeightsDigest: pDigest,
    contextPatternWeightsDigest: cpDigest,
    fullDnaDigest: fullDigest,
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R1 Acceptance Suite", () => {
  let reportJson: any;
  let markdownContent: string;
  let championDnaPath: string;
  let championManifestPath: string;
  let catalog: RegulationCatalog;
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const jsonPath = path.resolve(__dirname, "../../../reports/ai/standard-pack-evolution-pilot-v1-r1.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    reportJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    const mdPath = path.resolve(__dirname, "../../../docs/ai-standard-pack-evolution-pilot-v1-r1.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    markdownContent = fs.readFileSync(mdPath, "utf-8");

    championDnaPath = path.resolve(__dirname, "../../data/ai/standard-pack-pilot-champion-v6.json");
    championManifestPath = path.resolve(__dirname, "../../data/ai/standard-pack-pilot-champion-v6.manifest.json");
    expect(fs.existsSync(championDnaPath)).toBe(true);
    expect(fs.existsSync(championManifestPath)).toBe(true);

    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  describe("Group 1: Artifact & Provenance Integrity", () => {
    it("Test 1: Report Metadata matches work ID, schema v6, base SHA, and provenance structure", () => {
      expect(reportJson.workId).toBe("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R1");
      expect(reportJson.featureSchemaVersion).toBe(6);
      expect(reportJson.baseSha).toBe("e8b5df6ef4b5645e57b12ed2c6486647399565c5");
      expect(reportJson.startSha).toBe("e8b5df6ef4b5645e57b12ed2c6486647399565c5");
      expect(reportJson.regulationId).toBe("standard-pack");
      expect(reportJson.stageA.maxDecisions).toBe(500);

      // Provenance: runner is GenerationRunner, evolutionLoopUsed is false
      expect(reportJson.provenance.runner).toContain("GenerationRunner");
      expect(reportJson.provenance.evolutionLoopUsed).toBe(false);
    });

    it("Test 2: Markdown Document contains corrected Zero vs Zero table and provisional_champion verdict", () => {
      expect(markdownContent).toContain("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R1");
      expect(markdownContent).toContain("`provisional_champion`");
      expect(markdownContent).toContain("genome-sp-g0-004");
      expect(markdownContent).toContain("Mutated-ManualGeneric-B");
      expect(markdownContent).toContain("初期 Mutation によって発見された有望 DNA");

      // Verify Zero vs Zero regression table in Markdown matches JSON實測値
      expect(markdownContent).toContain("| 101 | p1 | 329 |");
      expect(markdownContent).toContain("| 202 | p1 | 399 |");
      expect(markdownContent).toContain("| 303 | p2 | 343 |");
      expect(markdownContent).toContain("| 404 | p2 | 208 |");
    });
  });

  describe("Group 2: Stage A Performance & Completion (maxDecisions=500)", () => {
    it("Test 3: Stage A match results verify 100% completion rate without incomplete or failed games", () => {
      const stageA = reportJson.stageA;
      expect(stageA.totalMatches).toBe(12);
      expect(stageA.completedMatches).toBe(12);
      expect(stageA.completionRate).toBe(1.0);
      for (const m of stageA.matches) {
        expect(m.completed).toBe(true);
        expect(m.totalDecisions).toBeLessThanOrEqual(500);
      }
    });

    it("Test 4: Regression Seeds (101, 202, 303, 404) exactly match measured JSON values", () => {
      const regressionMatches = reportJson.stageA.matches.filter((m: any) =>
        [101, 202, 303, 404].includes(m.seed) && m.name.includes("Zero vs Zero")
      );
      expect(regressionMatches.length).toBe(4);

      const expectedDecisions: Record<number, { winner: string; decisions: number }> = {
        101: { winner: "p1", decisions: 329 },
        202: { winner: "p1", decisions: 399 },
        303: { winner: "p2", decisions: 343 },
        404: { winner: "p2", decisions: 208 },
      };

      for (const m of regressionMatches) {
        expect(m.completed).toBe(true);
        expect(m.winner).toBe(expectedDecisions[m.seed].winner);
        expect(m.totalDecisions).toBe(expectedDecisions[m.seed].decisions);
      }
    });
  });

  describe("Group 3: Stage B Initial Population (g0) Diversity", () => {
    it("Test 5: g0 population has 6 distinct and valid genomes with 23,738 weights each", () => {
      const individuals = reportJson.stageB.individuals;
      expect(individuals.length).toBe(6);

      const uniqueFullDigests = new Set(individuals.map((d: any) => d.digests.fullDnaDigest));
      expect(uniqueFullDigests.size).toBe(6);

      for (const entry of individuals) {
        expect(entry.digests.totalWeights).toBe(23738);
        expect(typeof entry.digests.fullDnaDigest).toBe("string");
        expect(entry.digests.fullDnaDigest.length).toBe(64);
      }
    });
  });

  describe("Group 4: Stage C GenerationRunner Alignment & Candidate Origin Distinction", () => {
    it("Test 6: g0 and g1 match counts and completion rates are 100% and aligned with GenerationRunner", () => {
      const stageC = reportJson.stageC;
      expect(stageC.runnerName).toBe("GenerationRunner");
      expect(stageC.g0.totalMatches).toBe(30);
      expect(stageC.g0.completedMatches).toBe(30);
      expect(stageC.g0.status).toBe("ADVANCED");

      expect(stageC.g1.totalMatches).toBe(30);
      expect(stageC.g1.completedMatches).toBe(30);
      expect(stageC.g1.status).toBe("ADVANCED");

      // Verify g0 best candidate distinction: origin is g0 initial mutation, not evolved offspring
      expect(stageC.bestCandidate.genomeId).toBe("genome-sp-g0-004");
      expect(stageC.bestCandidate.originGeneration).toBe(0);
      expect(stageC.bestCandidate.isEvolvedOffspring).toBe(false);
      expect(stageC.bestCandidate.fitnessScore).toBe(1.0);
      expect(stageC.bestCandidate.wins).toBe(10);
      expect(stageC.bestCandidate.losses).toBe(0);

      // Verify g1 fixed comparison offspring
      expect(stageC.fixedComparisonOffspring.length).toBe(2);
      expect(stageC.fixedComparisonOffspring[0].genomeId).toBe("gen-000001-offspring-000000");
      expect(stageC.fixedComparisonOffspring[0].fitnessScore).toBe(0.7);
      expect(stageC.fixedComparisonOffspring[1].genomeId).toBe("gen-000001-offspring-000001");
      expect(stageC.fixedComparisonOffspring[1].fitnessScore).toBe(0.7);
    });
  });

  describe("Group 5: Stage D Generalization & Baseline Identity Verification", () => {
    it("Test 7: Stage D preserves historical 40 matches with 82.5% win rate and provisional_champion classification", () => {
      const stageD = reportJson.stageD;
      expect(stageD.totalMatches).toBe(40);
      expect(stageD.wins).toBe(33);
      expect(stageD.losses).toBe(7);
      expect(stageD.draws).toBe(0);
      expect(stageD.winRate).toBe(0.825);
      expect(stageD.classification).toBe("provisional_champion");
      expect(stageD.unusedSeeds).toEqual([90001, 90002, 90003, 90004]);
    });

    it("Test 8: Baseline identity between FirstLegal, ManualGeneric, and ZeroGenome is verified and explained", () => {
      const stageD = reportJson.stageD;
      expect(stageD.baselineIdentical).toBe(true);
      expect(stageD.baselineIdentityExplanation).toBeDefined();

      const fl = stageD.opponents["first-legal"];
      const mg = stageD.opponents["manual-generic"];
      const zg = stageD.opponents["zero-genome"];

      expect(fl.candidateWins).toBe(mg.candidateWins);
      expect(mg.candidateWins).toBe(zg.candidateWins);
      expect(fl.candidateTotalDecisions).toBe(mg.candidateTotalDecisions);
      expect(mg.candidateTotalDecisions).toBe(zg.candidateTotalDecisions);
    });
  });

  describe("Group 6: Stage F Extended Controlled Counter-Experiments (128 Matches)", () => {
    it("Test 9: Stage F executed 128 matches across 16 strictly disjoint seeds without incomplete/failed games", () => {
      const stageF = reportJson.stageF;
      expect(stageF.totalMatches).toBe(128);
      expect(stageF.unusedSeeds.length).toBe(16);
      expect(stageF.unusedSeeds[0]).toBe(91001);
      expect(stageF.unusedSeeds[15]).toBe(91016);

      // Verify no overlap with Stage D seeds
      const stageDSeeds = new Set(reportJson.stageD.unusedSeeds);
      for (const s of stageF.unusedSeeds) {
        expect(stageDSeeds.has(s)).toBe(false);
      }

      // Conservation of matches
      expect(stageF.wins + stageF.losses + stageF.draws).toBe(128);
      expect(stageF.wins).toBe(72);
      expect(stageF.losses).toBe(56);
      expect(stageF.draws).toBe(0);
      expect(stageF.winRate).toBeCloseTo(0.5625, 4);
    });

    it("Test 10: Seat and Turn Order are strictly separated and symmetric across 128 matches", () => {
      const stageF = reportJson.stageF;
      // 64 matches as P1, 64 matches as P2
      expect(stageF.seatSummary.p1Matches).toBe(64);
      expect(stageF.seatSummary.p2Matches).toBe(64);
      expect(stageF.seatSummary.p1Wins + stageF.seatSummary.p2Wins).toBe(stageF.wins);

      // 64 matches as first player, 64 matches as second player
      expect(stageF.turnOrderSummary.firstPlayerMatches).toBe(64);
      expect(stageF.turnOrderSummary.secondPlayerMatches).toBe(64);
      expect(stageF.turnOrderSummary.firstPlayerWins + stageF.turnOrderSummary.secondPlayerWins).toBe(stageF.wins);
    });

    it("Test 11: All 5 independent review questions are objectively answered with empirical data", () => {
      const q = reportJson.stageF.questionsAnswered;
      expect(q.q1_isCandidateStrongerThanTransferBaseline.answer).toBe(true);
      expect(q.q1_isCandidateStrongerThanTransferBaseline.winRate).toBe(0.625);

      expect(q.q2_areG1OffspringStrongerThanG0Candidate.answer).toBe(false);
      expect(q.q3_isImprovementFromMutationOrGenerationalEvolution.verdict).toContain("初期 Mutation");
      expect(q.q4_seatAndTurnBias.seatBias).toBeDefined();
      expect(q.q5_shouldContinueEvolutionWithCurrentPolicyAndFitness.recommendation).toContain("学習継続を推奨");
    });
  });

  describe("Group 7: Artifact Digest Invariance & Determinism", () => {
    it("Test 12: Champion DNA weights and SHA-256 digests remain 100% invariant", () => {
      const rawJson = fs.readFileSync(championDnaPath, "utf-8");
      const dna = JSON.parse(rawJson);

      expect(() => DecisionDNACodec.validate(dna)).not.toThrow();

      const computedDigests = computeDnaDigests(dna);
      expect(computedDigests.fullDnaDigest).toBe("8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa");
      expect(computedDigests.patternWeightsDigest).toBe("5bf80c34920186d3a022bfb8ac55a0aedeba71b36f56194786af764acacdd0e8");
      expect(computedDigests.contextPatternWeightsDigest).toBe("2d19b9389a40e7a695a642e891cf2bdadff5e3a1d79acb4712ba5f3962f7c701");
      expect(computedDigests.totalWeights).toBe(23738);
    });

    it("Test 13: Champion DNA runs deterministically in Standard＋Pack session replay", async () => {
      const rawJson = fs.readFileSync(championDnaPath, "utf-8");
      const championDna = JSON.parse(rawJson);

      const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("standard-pack", {
        catalog,
        fullRulePackage: rulePackage,
      });

      const runMatch = (seed: number) => {
        const ctx: BatchMatchContext = {
          matchIndex: 0,
          matchId: `test-r1-replay-${seed}`,
          baseSeed: seed,
          matchSeed: seed,
          playerSeeds: { p1: deriveSeed(seed, "p1"), p2: deriveSeed(seed, "p2") },
        };
        const session = sessionFactory(ctx);
        const policyP1 = new GenomePolicy(championDna, "champion-p1");
        const policyP2 = new RandomPolicy(new SeededRandom(seed ^ 0xcafe));

        return SimulationRunner.run(session, { p1: policyP1, p2: policyP2 }, { maxDecisions: 200 });
      };

      const res1 = runMatch(91001);
      const res2 = runMatch(91001);

      expect(res1.completed).toBe(res2.completed);
      expect(res1.winner).toBe(res2.winner);
      expect(res1.totalDecisions).toBe(res2.totalDecisions);
      expect(res1.finalStateHash).toBe(res2.finalStateHash);
      expect(res1.decisionTrace.length).toBe(res2.decisionTrace.length);

      for (let i = 0; i < res1.decisionTrace.length; i++) {
        expect(res1.decisionTrace[i].selectedLogicalPatternKey).toBe(res2.decisionTrace[i].selectedLogicalPatternKey);
        expect(res1.decisionTrace[i].actionId).toBe(res2.decisionTrace[i].actionId);
        expect(res1.decisionTrace[i].selectedPatternKind).toBe(res2.decisionTrace[i].selectedPatternKind);
      }
    });
  });
});
