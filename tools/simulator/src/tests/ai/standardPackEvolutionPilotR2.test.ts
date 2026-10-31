import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

describe("Standard＋Pack Evolution Pilot R2 Verification Suite [BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R2]", () => {
  const r2JsonPath = path.join(rootDir, "tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r2.json");
  const r2MdPath = path.join(rootDir, "tools/simulator/docs/ai-standard-pack-evolution-pilot-v1-r2.md");
  const championDnaPath = path.join(rootDir, "tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.json");

  it("Test 1: R2 Evidence JSON exists and adheres to schema specifications", () => {
    expect(fs.existsSync(r2JsonPath)).toBe(true);
    const raw = fs.readFileSync(r2JsonPath, "utf-8");
    const json = JSON.parse(raw);

    expect(json.workId).toBe("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R2");
    expect(json.baseSha).toBe("b01952928c8757e3553b808daa366a410476eb18");
    expect(json.startSha).toBe("b01952928c8757e3553b808daa366a410476eb18");
    expect(json.regulationId).toBe("standard-pack");
    expect(json.featureSchemaVersion).toBe(6);
    expect(json.rulePackageVersion).toBe("1.0.0");
    expect(json.campaignSeed).toBe(20261031);
    expect(json.provenance.runner).toContain("SimulationRunner.run");
  });

  it("Test 2: Reused Evidence from R1 is faithfully preserved without re-execution regressions", () => {
    const json = JSON.parse(fs.readFileSync(r2JsonPath, "utf-8"));
    const reused = json.reusedEvidenceFromR1;

    // Stage A
    expect(reused.stageA.totalMatches).toBe(12);
    expect(reused.stageA.completedMatches).toBe(12);
    expect(reused.stageA.completionRate).toBe(1.0);

    // Stage C
    expect(reused.stageC.g0.completedMatches).toBe(30);
    expect(reused.stageC.g1.completedMatches).toBe(30);
    expect(reused.stageC.bestCandidate.genomeId).toBe("genome-sp-g0-004");
    expect(reused.stageC.bestCandidate.fitnessScore).toBe(1.0);

    // Stage C preselected comparison offspring
    expect(reused.stageC.fixedComparisonOffspring.length).toBe(2);
    expect(reused.stageC.fixedComparisonOffspring[0].fitnessScore).toBe(0.7);
    expect(reused.stageC.fixedComparisonOffspring[1].fitnessScore).toBe(0.7);
    expect(reused.stageC.fixedComparisonOffspring[0].rankNote).toContain("Tied-top fitness 0.7");
    expect(reused.stageC.fixedComparisonOffspring[1].rankNote).toContain("Tied-top fitness 0.7");

    // Stage D & Stage F
    expect(reused.stageD.totalMatches).toBe(40);
    expect(reused.stageD.wins).toBe(33);
    expect(reused.stageF.totalMatches).toBe(128);
    expect(reused.stageF.wins).toBe(72);
  });

  it("Test 3: Stage G Validation Seeds (92001..92032) are completely disjoint from all historical seeds", () => {
    const json = JSON.parse(fs.readFileSync(r2JsonPath, "utf-8"));
    const stageG = json.stageG;
    expect(stageG.validationSeeds.length).toBe(32);
    expect(stageG.validationSeeds[0]).toBe(92001);
    expect(stageG.validationSeeds[31]).toBe(92032);

    const historicalSeeds = new Set<number>();
    for (const m of json.reusedEvidenceFromR1.stageA.matches) historicalSeeds.add(m.seed);
    for (const m of json.reusedEvidenceFromR1.stageC.g0.matches) historicalSeeds.add(m.matchSeed);
    for (const m of json.reusedEvidenceFromR1.stageC.g1.matches) historicalSeeds.add(m.matchSeed);
    for (const opp of Object.keys(json.reusedEvidenceFromR1.stageD.opponents)) {
      for (const m of json.reusedEvidenceFromR1.stageD.opponents[opp].matches) historicalSeeds.add(m.seed);
    }
    for (const opp of Object.keys(json.reusedEvidenceFromR1.stageF.opponents)) {
      for (const m of json.reusedEvidenceFromR1.stageF.opponents[opp].matches) historicalSeeds.add(m.seed);
    }

    expect(historicalSeeds.size).toBe(58);
    for (const s of stageG.validationSeeds) {
      expect(historicalSeeds.has(s)).toBe(false);
    }
  });

  it("Test 4: Stage G 576 matches are accounted for with explicit handling of FAILED / INCOMPLETE", () => {
    const json = JSON.parse(fs.readFileSync(r2JsonPath, "utf-8"));
    const stageG = json.stageG;

    expect(stageG.totalMatches).toBe(576);
    expect(stageG.completedMatches).toBe(575);
    expect(stageG.failedMatches).toBe(1);
    expect(stageG.incompleteMatches).toBe(0);
    expect(stageG.completionRate).toBeCloseTo(575 / 576, 4);

    // Verify the single failed match was properly isolated and not credited as win/draw/loss
    const failedMatch = stageG.matches.find((m: any) => m.failed);
    expect(failedMatch).toBeDefined();
    expect(failedMatch.seed).toBe(92023);
    expect(failedMatch.modelId).toBe("candidate");
    expect(failedMatch.opponentId).toBe("transfer-g1-best");
    expect(failedMatch.modelWon).toBe(false);
    expect(failedMatch.winner).toBeUndefined();
    expect(failedMatch.reason).toBe("EXCEPTION");
  });

  it("Test 5: Model summaries and Wilson score intervals are mathematically consistent", () => {
    const json = JSON.parse(fs.readFileSync(r2JsonPath, "utf-8"));
    const models = json.stageG.models;

    // Candidate
    const cand = models["candidate"];
    expect(cand.totalMatches).toBe(192);
    expect(cand.completedMatches).toBe(191);
    expect(cand.failedCount).toBe(1);
    expect(cand.wins).toBe(146);
    expect(cand.losses).toBe(45);
    expect(cand.draws).toBe(0);
    expect(cand.winRate).toBeCloseTo(146 / 191, 4);
    expect(cand.wilsonInterval.lower).toBeLessThan(cand.winRate);
    expect(cand.wilsonInterval.upper).toBeGreaterThan(cand.winRate);

    // Offspring #2
    const off2 = models["offspring-2"];
    expect(off2.totalMatches).toBe(192);
    expect(off2.completedMatches).toBe(192);
    expect(off2.failedCount).toBe(0);
    expect(off2.wins).toBe(126);
    expect(off2.losses).toBe(66);
    expect(off2.draws).toBe(0);
    expect(off2.winRate).toBeCloseTo(126 / 192, 4);

    // Offspring #1
    const off1 = models["offspring-1"];
    expect(off1.totalMatches).toBe(192);
    expect(off1.completedMatches).toBe(192);
    expect(off1.failedCount).toBe(0);
    expect(off1.wins).toBe(86);
    expect(off1.losses).toBe(106);
    expect(off1.draws).toBe(0);
    expect(off1.winRate).toBeCloseTo(86 / 192, 4);
  });

  it("Test 6: Seat-swapped paired score analysis correctly evaluates all 32 seed pairs per opponent", () => {
    const json = JSON.parse(fs.readFileSync(r2JsonPath, "utf-8"));
    const cand = json.stageG.models["candidate"];

    for (const oppId of ["transfer-g1-best", "seeded-random", "first-legal"]) {
      const oppStats = cand.byOpponent[oppId];
      expect(oppStats.matches).toBe(oppId === "transfer-g1-best" ? 63 : 64);
      const paired = oppStats.pairedScoreAnalysis;
      expect(paired.pairsCount).toBe(oppId === "transfer-g1-best" ? 31 : 32);
      expect(paired.bothWonCount + paired.splitCount + paired.bothLostCount).toBe(paired.pairsCount);
      expect(paired.ci95Lower).toBeLessThanOrEqual(paired.meanScore);
      expect(paired.ci95Upper).toBeGreaterThanOrEqual(paired.meanScore);
    }
  });

  it("Test 7: McNemar test objectively compares Candidate vs Offspring on identical 191 match conditions", () => {
    const json = JSON.parse(fs.readFileSync(r2JsonPath, "utf-8"));
    const mcNemar = json.stageG.mcNemarComparisons.candidateVsOffspring2;

    expect(mcNemar.table.bothWon).toBe(99);
    expect(mcNemar.table.aOnlyWon).toBe(47); // Candidate only won
    expect(mcNemar.table.bOnlyWon).toBe(26); // Offspring #2 only won
    expect(mcNemar.table.neitherWon).toBe(19);
    expect(mcNemar.table.bothWon + mcNemar.table.aOnlyWon + mcNemar.table.bOnlyWon + mcNemar.table.neitherWon).toBe(191);

    expect(mcNemar.discordantTotal).toBe(73);
    expect(mcNemar.exactPValue).toBeCloseTo(0.0186, 3);
    expect(mcNemar.isSignificant).toBe(true);
    expect(mcNemar.nullHypothesis).toContain("H0:");
    expect(mcNemar.alternativeHypothesis).toContain("H1:");
    expect(mcNemar.conclusion).toContain("統計的有意差あり");
  });

  it("Test 8: Independent review resolutions accurately resolve R1 contradictions", () => {
    const json = JSON.parse(fs.readFileSync(r2JsonPath, "utf-8"));
    const resolutions = json.independentReviewResolution;

    // Direct head-to-head fact in Stage F
    expect(resolutions.q2_areG1OffspringStrongerThanG0Candidate.stageFDirectHeadToHead.fact).toContain(
      "Offspring #2 は Candidate に明確に勝ち越した (19勝13敗)"
    );
    expect(resolutions.q2_areG1OffspringStrongerThanG0Candidate.stageFDirectHeadToHead.fact).toContain(
      "誤謬であり撤回する"
    );

    // Validation benchmark verdict
    expect(resolutions.q2_areG1OffspringStrongerThanG0Candidate.statisticalVerdict).toContain(
      "Candidate の方が Offspring #2 より統計的有意に高い勝率を記録した"
    );
    expect(resolutions.q3_isImprovementFromMutationOrGenerationalEvolution.verdict).toContain(
      "初期 Mutation による有望 DNA 発見が主因"
    );
  });

  it("Test 9: Markdown report exists, has required sections, and contains exact empirical figures", () => {
    expect(fs.existsSync(r2MdPath)).toBe(true);
    const md = fs.readFileSync(r2MdPath, "utf-8");

    expect(md).toContain("# BlackPoker AI Standard＋Pack Evolution Pilot V1 — R2 報告書");
    expect(md).toContain("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R2");
    expect(md).toContain("Offspring #2 は Candidate に 19 勝 13 敗 (勝率 59.4%) で明確に勝ち越していました");
    expect(md).toContain("576 試合完了率 99.8%");
    expect(md).toContain("76.4%");
    expect(md).toContain("65.6%");
    expect(md).toContain("44.8%");
    expect(md).toContain("p = 0.0186");
    expect(md).toContain("genome-sp-g0-004");
    expect(md).toContain("8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa");
  });

  it("Test 10: Champion DNA Artifact in src/data/ai remains intact and bit-for-bit unchanged", () => {
    expect(fs.existsSync(championDnaPath)).toBe(true);
    const raw = fs.readFileSync(championDnaPath, "utf-8");
    const champ = JSON.parse(raw);

    const fullDigest = sha256(
      JSON.stringify({
        dnaFormatVersion: champ.dnaFormatVersion,
        featureSchemaVersion: champ.featureSchemaVersion,
        scoringModel: champ.scoringModel,
        contextDimension: champ.contextDimension,
        patternDimension: champ.patternDimension,
        patternWeights: champ.patternWeights,
        contextPatternWeights: champ.contextPatternWeights,
      })
    );

    expect(fullDigest).toBe("8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa");
    expect(champ.patternWeights.length + champ.contextPatternWeights.length).toBe(23738);
  });
});
