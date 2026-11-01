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

describe("Standard＋Pack Evolution Pilot R3 Verification Suite [BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R3]", () => {
  const r3JsonPath = path.join(rootDir, "tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r3.json");
  const r3MdPath = path.join(rootDir, "tools/simulator/docs/ai-standard-pack-evolution-pilot-v1-r3.md");
  const r2JsonPath = path.join(rootDir, "tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r2.json");
  const championDnaPath = path.join(rootDir, "tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.json");

  it("Test 1: R3 Evidence JSON exists and adheres to schema specifications", () => {
    expect(fs.existsSync(r3JsonPath)).toBe(true);
    const raw = fs.readFileSync(r3JsonPath, "utf-8");
    const json = JSON.parse(raw);

    expect(json.workId).toBe("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R3");
    expect(json.baseSha).toBe("69246844cad56a425c0bc8563a9aa2bd1416110d");
    expect(json.regulationId).toBe("standard-pack");
    expect(json.featureSchemaVersion).toBe(6);
    expect(json.rulePackageVersion).toBe("1.0.0");
    expect(json.campaignSeed).toBe(20261031);
    expect(json.provenance.runner).toContain("standardPackEvolutionPilotRunnerR3.ts");
    expect(json.provenance.natureOfValidation).toContain("not a fresh unseen holdout");
  });

  it("Test 2: DNA Integrity Gate verifies exact Full DNA Digest match (Candidate, Offspring #2, Offspring #1)", () => {
    const json = JSON.parse(fs.readFileSync(r3JsonPath, "utf-8"));
    const gate = json.dnaIntegrityGate;

    expect(gate.status).toBe("PASSED");
    expect(gate.models.candidate.fullDnaDigest).toBe("8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa");
    expect(gate.models.candidate.matched).toBe(true);

    expect(gate.models.offspring2.fullDnaDigest).toBe("4cfa4dc731bb4d5ef4eeb91ba48739b215c79df07d5f25438a9e11d62048e15d");
    expect(gate.models.offspring2.matched).toBe(true);

    expect(gate.models.offspring1.fullDnaDigest).toBe("f882c794c57717d7808eef0fdf1695c002ccb2c2667ac9947e41e23dbb6fc853");
    expect(gate.models.offspring1.matched).toBe(true);
  });

  it("Test 3: Stage G 576 matches completed with 100% completion rate (0 FAILED, 0 INCOMPLETE)", () => {
    const json = JSON.parse(fs.readFileSync(r3JsonPath, "utf-8"));
    const stageG = json.stageG;

    expect(stageG.totalMatches).toBe(576);
    expect(stageG.completedMatches).toBe(576);
    expect(stageG.failedMatches).toBe(0);
    expect(stageG.incompleteMatches).toBe(0);
    expect(stageG.completionRate).toBe(1.0);
    expect(stageG.matches.length).toBe(576);

    for (const m of stageG.matches) {
      expect(m.completed).toBe(true);
      expect(m.failed).toBe(false);
      expect(m.incomplete).toBe(false);
      expect(m.winner).toBeDefined();
    }
  });

  it("Test 4: Seed 92023 is successfully completed in R3 (resolving R2 fail-closed exception)", () => {
    const json = JSON.parse(fs.readFileSync(r3JsonPath, "utf-8"));
    const comp = json.r2Comparison;

    expect(comp.seed92023Result.seed).toBe(92023);
    expect(comp.seed92023Result.r2Status).toBe("FAILED");
    expect(comp.seed92023Result.r3Status).toBe("COMPLETED");
    expect(comp.seed92023Result.r3Winner).toBe("p1");

    const m92023 = json.stageG.matches.find(
      (m: any) => m.seed === 92023 && m.modelId === "candidate" && m.opponentId === "transfer-g1-best" && m.leg === "model_as_p1"
    );
    expect(m92023).toBeDefined();
    expect(m92023.completed).toBe(true);
    expect(m92023.failed).toBe(false);
    expect(m92023.winner).toBe("p1");
    expect(m92023.modelWon).toBe(true);
  });

  it("Test 5: Initial turn player is strictly obtained before simulation and turnOrderSummary is valid", () => {
    const json = JSON.parse(fs.readFileSync(r3JsonPath, "utf-8"));
    const matches = json.stageG.matches;

    for (const m of matches) {
      expect(["p1", "p2"]).toContain(m.initialTurnPlayer);
      expect(m.firstPlayer).toBe(m.initialTurnPlayer);
      expect(m.modelIsFirst).toBe(m.modelSeat === m.initialTurnPlayer);
    }

    const models = json.stageG.models;
    for (const modelId of ["candidate", "offspring-2", "offspring-1"]) {
      const summary = models[modelId].turnOrderSummary;
      expect(summary.firstMatches + summary.secondMatches).toBe(192);
      expect(summary.firstWins + summary.secondWins).toBe(models[modelId].wins);
      expect(summary.firstMatches).toBeGreaterThan(0);
      expect(summary.secondMatches).toBeGreaterThan(0);
      // 先攻・後攻それぞれに十分な試合数が割り振られていること
      expect(summary.firstMatches).toBeCloseTo(96, -2);
      expect(summary.secondMatches).toBeCloseTo(96, -2);
    }
  });

  it("Test 6: Model validation summaries, Wilson score intervals, and seat summaries are consistent", () => {
    const json = JSON.parse(fs.readFileSync(r3JsonPath, "utf-8"));
    const models = json.stageG.models;

    const cand = models["candidate"];
    expect(cand.totalMatches).toBe(192);
    expect(cand.completedMatches).toBe(192);
    expect(cand.failedCount).toBe(0);
    expect(cand.incompleteCount).toBe(0);
    expect(cand.winRate).toBeGreaterThan(0.7);
    expect(cand.wilsonInterval.lower).toBeLessThanOrEqual(cand.winRate);
    expect(cand.wilsonInterval.upper).toBeGreaterThanOrEqual(cand.winRate);

    // Seat summary (p1 vs p2)
    expect(cand.seatSummary.p1Matches).toBe(96);
    expect(cand.seatSummary.p2Matches).toBe(96);
    expect(cand.seatSummary.p1Wins + cand.seatSummary.p2Wins).toBe(cand.wins);

    const off2 = models["offspring-2"];
    expect(off2.totalMatches).toBe(192);
    expect(off2.completedMatches).toBe(192);
    expect(off2.wins).toBeLessThan(cand.wins);

    const off1 = models["offspring-1"];
    expect(off1.totalMatches).toBe(192);
    expect(off1.completedMatches).toBe(192);
    expect(off1.wins).toBeLessThan(off2.wins);
  });

  it("Test 7: McNemar test objectively compares Candidate vs Offspring with proper p-value formatting", () => {
    const json = JSON.parse(fs.readFileSync(r3JsonPath, "utf-8"));
    const mcNemarCandVsOff2 = json.stageG.mcNemarComparisons.candidateVsOffspring2;
    const mcNemarCandVsOff1 = json.stageG.mcNemarComparisons.candidateVsOffspring1;

    // Candidate vs Offspring #2 (192 pairs)
    const t2 = mcNemarCandVsOff2.table;
    expect(t2.bothWon + t2.aOnlyWon + t2.bOnlyWon + t2.neitherWon).toBe(192);
    expect(mcNemarCandVsOff2.discordantTotal).toBe(t2.aOnlyWon + t2.bOnlyWon);
    expect(mcNemarCandVsOff2.exactPValue).toBeLessThan(0.05);
    expect(mcNemarCandVsOff2.isSignificant).toBe(true);
    expect(mcNemarCandVsOff2.formattedPValue).toMatch(/^p = 0\.\d{4}$/);

    // Candidate vs Offspring #1 (192 pairs)
    const t1 = mcNemarCandVsOff1.table;
    expect(t1.bothWon + t1.aOnlyWon + t1.bOnlyWon + t1.neitherWon).toBe(192);
    expect(mcNemarCandVsOff1.discordantTotal).toBe(t1.aOnlyWon + t1.bOnlyWon);
    expect(mcNemarCandVsOff1.exactPValue).toBeLessThan(0.0001);
    expect(mcNemarCandVsOff1.isSignificant).toBe(true);
    expect(mcNemarCandVsOff1.formattedPValue).toBe("p < 0.0001");
  });

  it("Test 8: Cluster Bootstrap 95% confidence intervals account for seed-level dependence", () => {
    const json = JSON.parse(fs.readFileSync(r3JsonPath, "utf-8"));
    const cluster = json.stageG.clusterBootstrapAnalysis;

    expect(cluster.seedSummaries.length).toBe(32);

    // Candidate vs Offspring #2
    const boot2 = cluster.candidateVsOffspring2;
    expect(boot2.pointDifference).toBeGreaterThan(0.05); // > 5% difference
    expect(boot2.ci95Lower).toBeGreaterThan(0); // 信頼区間が 0 を跨がない
    expect(boot2.ci95Upper).toBeGreaterThan(boot2.ci95Lower);
    expect(boot2.pointDifference).toBeGreaterThanOrEqual(boot2.ci95Lower);
    expect(boot2.pointDifference).toBeLessThanOrEqual(boot2.ci95Upper);

    // Candidate vs Offspring #1
    const boot1 = cluster.candidateVsOffspring1;
    expect(boot1.pointDifference).toBeGreaterThan(0.20); // > 20% difference
    expect(boot1.ci95Lower).toBeGreaterThan(0.10);
    expect(boot1.ci95Upper).toBeGreaterThan(boot1.ci95Lower);
  });

  it("Test 9: Markdown report exists, has required sections, and contains exact empirical figures", () => {
    expect(fs.existsSync(r3MdPath)).toBe(true);
    const md = fs.readFileSync(r3MdPath, "utf-8");

    expect(md).toContain("# BlackPoker Standard＋Pack Evolution Pilot V1 — R3 レポート");
    expect(md).toContain("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R3");
    expect(md).toContain("69246844cad56a425c0bc8563a9aa2bd1416110d");
    expect(md).toContain("100.0% (576/576, FAILED: 0, INCOMPLETE: 0)");
    expect(md).toContain("8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa");
    expect(md).toContain("クラスター・ブートストラップ");
    expect(md).toContain("Seed 92023");
  });

  it("Test 10: V1/R1/R2 Evidence, Champion DNA, and historical artifacts remain completely protected", () => {
    // R2 Evidence JSON check
    expect(fs.existsSync(r2JsonPath)).toBe(true);
    const r2Json = JSON.parse(fs.readFileSync(r2JsonPath, "utf-8"));
    expect(r2Json.workId).toBe("BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R2");
    expect(r2Json.stageG.failedMatches).toBe(1);

    // Champion DNA check
    expect(fs.existsSync(championDnaPath)).toBe(true);
    const champ = JSON.parse(fs.readFileSync(championDnaPath, "utf-8"));
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
  });
});
