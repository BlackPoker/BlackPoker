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
import { computeDnaDigests } from "../../cli/standardPackEvolutionPilotRunner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1 Acceptance Suite", () => {
  let reportJson: any;
  let markdownContent: string;
  let championDnaPath: string;
  let championManifestPath: string;
  let catalog: RegulationCatalog;
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const jsonPath = path.resolve(__dirname, "../../../reports/ai/standard-pack-evolution-pilot-v1.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    reportJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    const mdPath = path.resolve(__dirname, "../../../docs/ai-standard-pack-evolution-pilot-v1.md");
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

  describe("Group 1: Artifact & Report Metadata Integrity", () => {
    it("Test 1: Report Metadata matches work ID, schema v6, base SHA, and total weights", () => {
      expect(reportJson.workId).toBe("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1");
      expect(reportJson.featureSchemaVersion).toBe(6);
      expect(reportJson.baseSha).toBe("9a9b44f5fa7e47b008a01aaf48291e824ffd56d7");
      expect(reportJson.regulationId).toBe("standard-pack");
      expect(reportJson.stageA.maxDecisions).toBe(500);
      expect(reportJson.stageE.totalWeights).toBe(23738);
    });

    it("Test 2: Markdown Document contains essential metrics, workId, and champion genome", () => {
      expect(markdownContent).toContain("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1");
      expect(markdownContent).toContain("82.5%");
      expect(markdownContent).toContain("maxDecisions=500");
      expect(markdownContent).toContain("genome-sp-g0-004");
      expect(markdownContent).toContain("`champion`");
      expect(markdownContent).not.toContain("Genome ID: `undefined`");
    });
  });

  describe("Group 2: Stage A Performance & Completion (maxDecisions=500)", () => {
    it("Test 3: Stage A match results verify 100% completion rate without incomplete or failed games", () => {
      const stageA = reportJson.stageA;
      expect(stageA.totalMatches).toBe(12);
      expect(stageA.completedMatches).toBe(12);
      expect(stageA.completionRate).toBe(1.0);
      expect(stageA.matches.length).toBe(12);
      for (const m of stageA.matches) {
        expect(m.completed).toBe(true);
        expect(m.totalDecisions).toBeLessThanOrEqual(500);
      }
    });

    it("Test 4: Regression Seeds (101, 202, 303, 404) exactly match historical evidence", () => {
      const regressionMatches = reportJson.stageA.matches.filter((m: any) =>
        [101, 202, 303, 404].includes(m.seed) && m.name.includes("Zero vs Zero")
      );
      expect(regressionMatches.length).toBe(4);

      const expectedDecisions: Record<number, number> = {
        101: 329,
        202: 399,
        303: 343,
        404: 208,
      };

      for (const m of regressionMatches) {
        expect(m.completed).toBe(true);
        expect(m.totalDecisions).toBe(expectedDecisions[m.seed]);
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

  describe("Group 4: Stage C Controlled Evolution Conservation & Fitness Recalculation", () => {
    it("Test 6: g0 and g1 match counts and completion rates are 100%", () => {
      const stageC = reportJson.stageC;
      expect(stageC.g0.totalMatches).toBe(30);
      expect(stageC.g0.completedMatches).toBe(30);

      expect(stageC.g1.totalMatches).toBe(30);
      expect(stageC.g1.completedMatches).toBe(30);
    });

    it("Test 7: Champion individual genome-sp-g0-004 achieved undefeated fitness score 1.0 in g0", () => {
      const best = reportJson.stageC.championCandidate;
      expect(best.genomeId).toBe("genome-sp-g0-004");
      expect(best.generation).toBe(0);
      expect(best.fitnessScore).toBe(1.0);
      expect(best.wins).toBe(10);
      expect(best.losses).toBe(0);
      expect(best.draws).toBe(0);
    });
  });

  describe("Group 5: Stage D Generalization on Unused Seeds & Seat Swapping", () => {
    it("Test 8: Stage D executed 40 matches across unused seeds with 82.5% win rate", () => {
      const stageD = reportJson.stageD;
      expect(stageD.totalMatches).toBe(40);
      expect(stageD.wins).toBe(33);
      expect(stageD.losses).toBe(7);
      expect(stageD.draws).toBe(0);
      expect(stageD.winRate).toBe(0.825);
      expect(stageD.classification).toBe("champion");
      expect(stageD.unusedSeeds).toEqual([90001, 90002, 90003, 90004]);
    });

    it("Test 9: Seat swapping was strictly symmetric for all 5 benchmark opponents", () => {
      const opponents = Object.keys(reportJson.stageD.opponents);
      expect(opponents.length).toBe(5);

      for (const oppKey of opponents) {
        const oppData = reportJson.stageD.opponents[oppKey];
        expect(oppData.totalMatches).toBe(8);
        expect(oppData.completedMatches).toBe(8);
      }

      // Check win against transfer baseline (Light+Entry16)
      const transferRes = reportJson.stageD.opponents["transfer-g1-best"];
      expect(transferRes).toBeDefined();
      expect(transferRes.candidateWins).toBe(6);
      expect(transferRes.opponentWins).toBe(2);
      expect(transferRes.winRate).toBe(0.75);
    });
  });

  describe("Group 6: Stage E Champion DNA Artifact & Deterministic Replay", () => {
    it("Test 10: Champion DNA Artifact passes DecisionDNACodec validation and matches manifest", () => {
      const rawJson = fs.readFileSync(championDnaPath, "utf-8");
      const dna = JSON.parse(rawJson);

      expect(() => DecisionDNACodec.validate(dna)).not.toThrow();

      const rawManifest = fs.readFileSync(championManifestPath, "utf-8");
      const manifest = JSON.parse(rawManifest);

      const computedDigests = computeDnaDigests(dna);
      expect(computedDigests.fullDnaDigest).toBe(manifest.genome.digests.fullDnaDigest);
      expect(computedDigests.patternWeightsDigest).toBe(manifest.genome.digests.patternWeightsDigest);
      expect(computedDigests.contextPatternWeightsDigest).toBe(manifest.genome.digests.contextPatternWeightsDigest);
      expect(computedDigests.totalWeights).toBe(23738);

      // Verify specific SHA256 matches evidence
      expect(computedDigests.fullDnaDigest).toBe(reportJson.stageE.fullDnaDigest);
    });

    it("Test 11: Champion DNA runs deterministically in Standard＋Pack session replay", async () => {
      const rawJson = fs.readFileSync(championDnaPath, "utf-8");
      const championDna = JSON.parse(rawJson);

      const regulation = catalog.regulations.get("standard-pack");
      expect(regulation).toBeDefined();
      if (!regulation) throw new Error("Regulation standard-pack not found");

      const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("standard-pack", {
        catalog,
        fullRulePackage: rulePackage,
      });

      const runMatch = (seed: number) => {
        const ctx: BatchMatchContext = {
          matchIndex: 0,
          matchId: `test-replay-${seed}`,
          baseSeed: seed,
          matchSeed: seed,
          playerSeeds: { p1: deriveSeed(seed, "p1"), p2: deriveSeed(seed, "p2") },
        };
        const session = sessionFactory(ctx);
        const policyP1 = new GenomePolicy(championDna, "champion-p1");
        const policyP2 = new RandomPolicy(new SeededRandom(seed ^ 0xcafe));

        return SimulationRunner.run(session, { p1: policyP1, p2: policyP2 }, { maxDecisions: 200 });
      };

      const res1 = runMatch(90001);
      const res2 = runMatch(90001);

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
