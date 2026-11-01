import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory.js";
import { deriveSeed } from "../../engine/random/DeterministicShuffle.js";
import { SimulationRunner, SimulationResult } from "../../engine/simulation/SimulationRunner.js";
import { GenomePolicy } from "../../engine/ai/GenomePolicy.js";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy.js";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import { huntFirstDivergence } from "../../engine/simulation/FirstDivergenceHunter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function computeFullDnaDigest(dna: DecisionDNA): string {
  return sha256(
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
}

function computeTraceDigest(simRes: SimulationResult): string {
  if (!simRes.decisionTrace) return "";
  return sha256(JSON.stringify(simRes.decisionTrace.map((r) => r.logicalDecisionId)));
}

describe("Deterministic Replay Gate (決定論的リプレイ検証)", () => {
  const REGULATION_ID = "standard-pack";
  let sessionFactory: any;
  let modelsFixture: {
    candidate: { genomeId: string; fullDnaDigest: string; dna: DecisionDNA };
    offspring2: { genomeId: string; fullDnaDigest: string; dna: DecisionDNA };
    offspring1: { genomeId: string; fullDnaDigest: string; dna: DecisionDNA };
  };

  beforeAll(async () => {
    // 1. レギュレーションおよびルールパッケージのロード
    const catalog = await loadRegulationCatalog(
      path.resolve(rootDir, "tools/simulator/src/data/regulations")
    );
    const fullRulePackage = await loadRulePackageFromDirectory(
      path.resolve(rootDir, "tools/simulator/src/data/rules-vnext")
    );
    sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(REGULATION_ID, {
      catalog,
      fullRulePackage,
    });

    // 2. 世代進化を再実行せず、固定テスト Fixture から DNA をロード
    const fixturePath = path.resolve(
      rootDir,
      "tools/simulator/src/tests/fixtures/dna/standard-pack-pilot-models-fixture.json"
    );
    expect(fs.existsSync(fixturePath)).toBe(true);
    modelsFixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  });

  it("Test 1: 固定 DNA Fixture のゲノム ID と Full DNA Digest が R3 Evidence と完全一致すること", () => {
    // Candidate
    expect(modelsFixture.candidate.genomeId).toBe("genome-sp-g0-004");
    expect(modelsFixture.candidate.fullDnaDigest).toBe(
      "8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa"
    );
    expect(computeFullDnaDigest(modelsFixture.candidate.dna)).toBe(
      modelsFixture.candidate.fullDnaDigest
    );

    // Offspring #2
    expect(modelsFixture.offspring2.genomeId).toBe("gen-000001-offspring-000001");
    expect(modelsFixture.offspring2.fullDnaDigest).toBe(
      "4cfa4dc731bb4d5ef4eeb91ba48739b215c79df07d5f25438a9e11d62048e15d"
    );
    expect(computeFullDnaDigest(modelsFixture.offspring2.dna)).toBe(
      modelsFixture.offspring2.fullDnaDigest
    );

    // Offspring #1
    expect(modelsFixture.offspring1.genomeId).toBe("gen-000001-offspring-000000");
    expect(modelsFixture.offspring1.fullDnaDigest).toBe(
      "f882c794c57717d7808eef0fdf1695c002ccb2c2667ac9947e41e23dbb6fc853"
    );
    expect(computeFullDnaDigest(modelsFixture.offspring1.dna)).toBe(
      modelsFixture.offspring1.fullDnaDigest
    );
  });

  it("Test 2: Match 1 (Candidate vs FirstLegal, Seed 92001, Leg 1) の 2 回再実行一致 & R3 Evidence 完全一致", () => {
    const seed = 92001;
    const leg = 0; // model_as_p1
    const runMatch = () => {
      const matchContext: BatchMatchContext = {
        matchIndex: leg,
        matchId: `val-candidate-vs-first-legal-s${seed}-leg1`,
        baseSeed: seed,
        matchSeed: seed,
        playerSeeds: {
          p1: deriveSeed(seed, "p1"),
          p2: deriveSeed(seed, "p2"),
        },
      };
      const session = sessionFactory(matchContext);
      const policies = {
        p1: new GenomePolicy(modelsFixture.candidate.dna),
        p2: new FirstLegalPolicy(false),
      };
      return SimulationRunner.run(session, policies, { maxDecisions: 500 });
    };

    const res1 = runMatch();
    const res2 = runMatch();

    // 1. 同一条件での 2 回実行における Trace 完全一致 (決定論性検証)
    const divergence = huntFirstDivergence(res1.decisionTrace, res2.decisionTrace);
    expect(divergence.status).toBe("NO_DIVERGENCE");
    expect(divergence.classification).toBe("NO_DIVERGENCE");

    // 2 回再実行間での全対戦結果指標の完全一致検証
    expect(res1.completed).toBe(res2.completed);
    expect(res1.winner).toBe(res2.winner);
    expect(res1.totalDecisions).toBe(res2.totalDecisions);
    expect(res1.turnCount).toBe(res2.turnCount);
    expect(res1.finalStateHash).toBe(res2.finalStateHash);
    expect(computeTraceDigest(res1)).toBe(computeTraceDigest(res2));

    // 2. R3 Evidence の期待値検証
    expect(res1.completed).toBe(true);
    expect(res1.winner).toBe("p1");
    expect(res1.totalDecisions).toBe(124);
    expect(res1.turnCount).toBe(7);
    expect(res1.finalStateHash).toBe("sh2-4122835f3963d13b");
    expect(computeTraceDigest(res1)).toBe(
      "cf982b065e3aaea9880962b8e6b29b651359e3b5ce3c4df265f1d3bcd8a3bcc0"
    );
  });

  it("Test 3: Match 2 (Offspring #2 vs FirstLegal, Seed 92001, Leg 1) の 2 回再実行一致 & R3 Evidence 完全一致", () => {
    const seed = 92001;
    const leg = 0; // model_as_p1
    const runMatch = () => {
      const matchContext: BatchMatchContext = {
        matchIndex: leg,
        matchId: `val-offspring-2-vs-first-legal-s${seed}-leg1`,
        baseSeed: seed,
        matchSeed: seed,
        playerSeeds: {
          p1: deriveSeed(seed, "p1"),
          p2: deriveSeed(seed, "p2"),
        },
      };
      const session = sessionFactory(matchContext);
      const policies = {
        p1: new GenomePolicy(modelsFixture.offspring2.dna),
        p2: new FirstLegalPolicy(false),
      };
      return SimulationRunner.run(session, policies, { maxDecisions: 500 });
    };

    const res1 = runMatch();
    const res2 = runMatch();

    // 1. 同一条件での 2 回実行における Trace 完全一致
    const divergence = huntFirstDivergence(res1.decisionTrace, res2.decisionTrace);
    expect(divergence.status).toBe("NO_DIVERGENCE");
    expect(divergence.classification).toBe("NO_DIVERGENCE");

    // 2 回再実行間での全対戦結果指標の完全一致検証
    expect(res1.completed).toBe(res2.completed);
    expect(res1.winner).toBe(res2.winner);
    expect(res1.totalDecisions).toBe(res2.totalDecisions);
    expect(res1.turnCount).toBe(res2.turnCount);
    expect(res1.finalStateHash).toBe(res2.finalStateHash);
    expect(computeTraceDigest(res1)).toBe(computeTraceDigest(res2));

    // 2. R3 Evidence の期待値検証
    expect(res1.completed).toBe(true);
    expect(res1.winner).toBe("p1");
    expect(res1.totalDecisions).toBe(70);
    expect(res1.turnCount).toBe(3);
    expect(res1.finalStateHash).toBe("sh2-2cab13b4423e6489");
    expect(computeTraceDigest(res1)).toBe(
      "a9af3c8c12ed91c7d14c1983c5ef15e416291c7408d1a821ce1b672c65a89d0d"
    );
  });

  it("Test 4: Match 3 (Offspring #1 vs FirstLegal, Seed 92001, Leg 2 / 座席反転) の 2 回再実行一致 & R3 Evidence 完全一致", () => {
    const seed = 92001;
    const leg = 1; // model_as_p2 (FirstLegal が p1 先攻)
    const runMatch = () => {
      const matchContext: BatchMatchContext = {
        matchIndex: leg,
        matchId: `val-offspring-1-vs-first-legal-s${seed}-leg2`,
        baseSeed: seed,
        matchSeed: seed,
        playerSeeds: {
          p1: deriveSeed(seed, "p1"),
          p2: deriveSeed(seed, "p2"),
        },
      };
      const session = sessionFactory(matchContext);
      const policies = {
        p1: new FirstLegalPolicy(false),
        p2: new GenomePolicy(modelsFixture.offspring1.dna),
      };
      return SimulationRunner.run(session, policies, { maxDecisions: 500 });
    };

    const res1 = runMatch();
    const res2 = runMatch();

    // 1. 同一条件での 2 回実行における Trace 完全一致
    const divergence = huntFirstDivergence(res1.decisionTrace, res2.decisionTrace);
    expect(divergence.status).toBe("NO_DIVERGENCE");
    expect(divergence.classification).toBe("NO_DIVERGENCE");

    // 2 回再実行間での全対戦結果指標の完全一致検証
    expect(res1.completed).toBe(res2.completed);
    expect(res1.winner).toBe(res2.winner);
    expect(res1.totalDecisions).toBe(res2.totalDecisions);
    expect(res1.turnCount).toBe(res2.turnCount);
    expect(res1.finalStateHash).toBe(res2.finalStateHash);
    expect(computeTraceDigest(res1)).toBe(computeTraceDigest(res2));

    // 2. R3 Evidence の期待値検証
    expect(res1.completed).toBe(true);
    expect(res1.winner).toBe("p2"); // Offspring #1 が p2 で勝利
    expect(res1.totalDecisions).toBe(265);
    expect(res1.turnCount).toBe(17);
    expect(res1.finalStateHash).toBe("sh2-006d8c3dcf63de08");
    expect(computeTraceDigest(res1)).toBe(
      "721802239d0b53c79f42f078fd4f22c0244b6a0efcc9eba2678de4afaddd6021"
    );
  });
});
