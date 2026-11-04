/**
 * BlackPoker Work 3-6 R2 — Holdout Evidence 完全性監査 合成 240 試合 Fixture テスト
 *
 * 本番 Seed (95001〜95030) の「実試合」は一切実行しない。
 * 合成 Outcome から正しい 240 試合構成の成果物を生成し、1 条件ずつ破壊して監査の有効性を検証する。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  CANDIDATE_CHAMPION_EXPECTED_DIGEST,
  CANDIDATE_CHAMPION_GENOME_ID,
  HOLDOUT_BONFERRONI_ALPHA,
  HOLDOUT_WORK_ID,
  OFFICIAL_HOLDOUT_SEEDS,
  OLD_CHAMPION_EXPECTED_DIGEST,
  OLD_CHAMPION_GENOME_ID,
  auditHoldoutArtifacts,
  computeFileSha256,
  computeHoldoutCertification,
  loadChampionDNA,
} from "../../cli/stage3HoldoutRunner";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager";

const OPPONENTS = [
  { id: "holdout-first-legal", name: "FirstLegal", target: 0.85, splits: 3 },
  { id: "holdout-seeded-random", name: "SeededRandom", target: 0.75, splits: 3 },
  { id: "holdout-zero-dna", name: "ZeroDNA", target: 0.7, splits: 3 },
  { id: "holdout-stage3-gen5-champion", name: "Stage3Gen5Champion", target: 0.5, splits: 10 },
];

type Outcome = any;

function buildOutcomes(): Outcome[] {
  const outcomes: Outcome[] = [];
  OPPONENTS.forEach((opp, oi) => {
    OFFICIAL_HOLDOUT_SEEDS.forEach((seed, si) => {
      const pairIndex = oi * 30 + si;
      const split = si < opp.splits; // split ペア: Leg0 勝ち / Leg1 負け
      for (const leg of [0, 1] as const) {
        const won = split ? leg === 0 : true;
        const candSeat = leg === 0 ? "p1" : "p2";
        const oppSeat = leg === 0 ? "p2" : "p1";
        outcomes.push({
          matchIndex: pairIndex * 2 + leg,
          matchId:
            leg === 0
              ? `pair-${pairIndex}-leg0-${seed}-cand-vs-${opp.id}`
              : `pair-${pairIndex}-leg1-${seed}-${opp.id}-vs-cand`,
          pairIndex,
          legIndex: leg,
          matchSeed: seed,
          opponentId: opp.id,
          opponentName: opp.name,
          candidateSeat: candSeat,
          opponentSeat: oppSeat,
          completed: true,
          winner: won ? candSeat : oppSeat,
          candidateWon: won,
          candidateDraw: false,
          candidateLost: !won,
          totalDecisions: 60,
          turnCount: 6,
          failed: false,
          incomplete: false,
          reachedDecisionLimit: false,
          instantiationFailures: 0,
        });
      }
    });
  });
  return outcomes;
}

function buildSummary(outcomes: Outcome[]): Record<string, any> {
  const res: Record<string, any> = {};
  for (const opp of OPPONENTS) {
    const scores: number[] = [];
    const byPair = new Map<number, Outcome[]>();
    for (const o of outcomes.filter((x) => x.opponentId === opp.id)) {
      byPair.set(o.pairIndex, [...(byPair.get(o.pairIndex) ?? []), o]);
    }
    for (const legs of byPair.values()) {
      const s = legs.map((l) => (l.candidateWon ? 1 : l.candidateDraw ? 0.5 : 0));
      scores.push((s[0] + s[1]) / 2);
    }
    const stats = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scores,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: opp.target,
      alpha: HOLDOUT_BONFERRONI_ALPHA,
      minCompletedPairs: 5,
    });
    res[opp.id] = { opponentId: opp.id, ...stats };
  }
  return res;
}

interface Mutations {
  outcomes?: (o: Outcome[]) => void;
  summary?: (s: Record<string, any>) => void;
  evidence?: (e: any) => void;
}

function writeFixture(dir: string, mut: Mutations = {}): string {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const outcomes = buildOutcomes();
  const summary = buildSummary(outcomes); // 破壊前の正しい統計
  mut.outcomes?.(outcomes);
  mut.summary?.(summary);

  const evidence: any = {
    candidateChampionDnaDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
    oldChampionDnaDigest: OLD_CHAMPION_EXPECTED_DIGEST,
    baselineSuperior: true,
    evidenceStatus: "VALID",
    certificationStatus: "SUPERIORITY_VERIFIED",
    improvementStatus: "IMPROVEMENT_VERIFIED",
  };
  mut.evidence?.(evidence);

  const preflight = {
    workId: HOLDOUT_WORK_ID,
    executionMode: "EXECUTE",
    candidateChampion: {
      genomeId: CANDIDATE_CHAMPION_GENOME_ID,
      expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
      verifiedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
    },
    oldChampion: {
      genomeId: OLD_CHAMPION_GENOME_ID,
      expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
      verifiedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
    },
  };
  const files: Record<string, string> = {
    "preflight-manifest.json": JSON.stringify(preflight),
    "holdout-evaluation-protocol.json": "{}",
    "holdout-evaluation-result.json": JSON.stringify({
      individualOutcomes: outcomes,
      evaluationSummary: { opponents: summary },
    }),
    "holdout-evaluation-evidence.json": JSON.stringify(evidence),
    "STAGE3_HOLDOUT_AUDIT_REPORT.md": `certificationStatus: ${evidence.certificationStatus}`,
    "AUDIT_HOLDOUT_EVIDENCE.md": `certificationStatus: ${evidence.certificationStatus}`,
  };
  const manifest: Record<string, string> = {};
  for (const [f, c] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, f), c, "utf8");
    manifest[f] = computeFileSha256(path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, "MANIFEST_SHA256.json"), JSON.stringify(manifest));
  return dir;
}

describe("Holdout 合成 240 試合 Fixture 監査 (R2)", () => {
  const tmp = path.resolve(".artifacts/test-stage3-holdout-synthetic-temp");
  beforeAll(() => {
    fs.mkdirSync(tmp, { recursive: true });
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const audit = (name: string, mut?: Mutations) => auditHoldoutArtifacts(writeFixture(path.join(tmp, name), mut));

  it("正常系: 正しい合成 240 試合は監査 PASS で SUPERIORITY_VERIFIED", () => {
    const r = audit("ok");
    expect(r.errors).toEqual([]);
    expect(r.isValid).toBe(true);
    expect(r.totalMatches).toBe(240);
    expect(r.completedMatches).toBe(240);
    expect(r.totalInstantiationFailures).toBe(0);
    expect(r.certificationStatus).toBe("SUPERIORITY_VERIFIED");
  });

  it("completed=false, failed=false, incomplete=false の矛盾 Outcome は FAIL", () => {
    const r = audit("contradict", {
      outcomes: (o) => {
        o[5].completed = false;
      },
    });
    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.includes("contradictory state"))).toBe(true);
  });

  it("1 試合だけ pairIndex が不一致なら FAIL", () => {
    const r = audit("pairidx", {
      outcomes: (o) => {
        o[11].pairIndex = 999;
      },
    });
    expect(r.isValid).toBe(false);
  });

  it("勝者と Candidate 勝敗フラグが不一致なら FAIL", () => {
    const r = audit("winner", {
      outcomes: (o) => {
        // winner は candidate 以外のまま candidateWon=true にする
        o[0].winner = "p2";
      },
    });
    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.includes("winner mismatch"))).toBe(true);
  });

  it("matchId 重複は FAIL", () => {
    const r = audit("dupid", {
      outcomes: (o) => {
        o[1].matchId = o[0].matchId;
      },
    });
    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.includes("Duplicate matchId"))).toBe(true);
  });

  it("平均が一致していても分散が不一致なら FAIL", () => {
    const r = audit("variance", {
      summary: (s) => {
        s["holdout-stage3-gen5-champion"].sampleVariance += 0.01;
      },
    });
    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.includes("variance"))).toBe(true);
  });

  it("平均が一致していても信頼下限が不一致なら FAIL", () => {
    const r = audit("lower", {
      summary: (s) => {
        s["holdout-stage3-gen5-champion"].statisticalTest.oneSidedLowerBound += 0.05;
      },
    });
    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.includes("lower bound"))).toBe(true);
  });

  it("Evidence の certificationStatus 改ざんは FAIL", () => {
    const r = audit("tamper", {
      evidence: (e) => {
        e.certificationStatus = "NON_INFERIORITY_VERIFIED";
      },
    });
    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.includes("Certification status mismatch"))).toBe(true);
  });

  it("Evidence の improvementStatus 改ざんは FAIL", () => {
    const r = audit("tamper2", {
      evidence: (e) => {
        e.improvementStatus = "CONFIRMED_REGRESSION";
      },
    });
    expect(r.isValid).toBe(false);
  });

  it("実体化失敗が発生した場合は件数が記録され、認定禁止 (INVALID_EVIDENCE, CONFIRMED_REGRESSION へ変換しない)", () => {
    const r = audit("inst", {
      outcomes: (o) => {
        o[3].instantiationFailures = 1;
      },
    });
    expect(r.isValid).toBe(false);
    expect(r.totalInstantiationFailures).toBe(1);
    expect(r.certificationStatus).toBe("INVALID_EVIDENCE");
    expect(r.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
  });

  it("UNMEASURED の実体化失敗は 0 件扱いせず FAIL", () => {
    const r = audit("unmeasured", {
      outcomes: (o) => {
        o[3].instantiationFailures = "UNMEASURED";
      },
    });
    expect(r.isValid).toBe(false);
    expect(r.totalInstantiationFailures).toBe("UNMEASURED");
  });

  it("instantiationFailures 欠落を正常値として扱わず FAIL", () => {
    const r = audit("missing", {
      outcomes: (o) => {
        delete o[3].instantiationFailures;
      },
    });
    expect(r.isValid).toBe(false);
  });

  it("computeHoldoutCertification: 実体化失敗または UNMEASURED では INVALID_EVIDENCE", () => {
    const base: any = {
      evaluationResult: { evidenceStatus: "VALID", opponents: {} },
      failedMatches: 0,
      incompleteMatches: 0,
      matchesReachingDecisionLimit: 0,
      totalMatches: 240,
      expectedMatches: 240,
    };
    expect(computeHoldoutCertification({ ...base, totalInstantiationFailures: 1 }).certificationStatus).toBe(
      "INVALID_EVIDENCE"
    );
    const un = computeHoldoutCertification({ ...base, totalInstantiationFailures: "UNMEASURED" });
    expect(un.certificationStatus).toBe("INVALID_EVIDENCE");
    expect(un.effectiveImprovementStatus).toBe("IMPROVEMENT_UNVERIFIED");
  });

  describe("Checkpoint Fail-Closed", () => {
    const cpPath = path.join(tmp, "cp", "cp.json");
    let digest = "";
    let valid: any;

    beforeAll(() => {
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "cp-g", name: "cp-g", tags: [] });
      (dna.patternWeights as number[])[0] = 0.1;
      digest = EvolutionIndependentEvaluator.computeDnaDigest(dna);
      const state: any = {
        checkpointVersion: 1,
        campaignId: "c",
        provisionalBestChampion: { genomeId: "cp-g", dna, dnaDigest: digest },
        timestamp: "t",
      };
      valid = { ...state, checksum: EvolutionCampaignManager.computeCheckpointChecksum(state) };
    });

    const load = (obj: any) => {
      fs.mkdirSync(path.dirname(cpPath), { recursive: true });
      fs.writeFileSync(cpPath, JSON.stringify(obj));
      return () =>
        loadChampionDNA({
          checkpointPath: cpPath,
          expectedGenomeId: "cp-g",
          expectedDigest: digest,
          verifyCheckpointChecksum: true,
        });
    };

    it("正常な checksum は PASS", () => {
      expect(load(valid)()).toBeDefined();
    });
    it("checksum 欠落は例外", () => {
      const { checksum, ...rest } = valid;
      expect(load(rest)).toThrow(/checksum missing/);
    });
    it("checksum 形式不正は例外", () => {
      expect(load({ ...valid, checksum: "xyz" })).toThrow(/format invalid/);
    });
    it("checksum 不一致は例外", () => {
      expect(load({ ...valid, checksum: "0".repeat(64) })).toThrow(/checksum mismatch/);
    });
  });
});
