import * as fs from "fs";
import * as path from "path";
import { loadOfficialChampionsStrict } from "./largeScaleSimulationRunner";
import { prepareOfficialSessionFactory } from "./stage3EvolutionRunner";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { derivePlayerSeed, executeSingleInstrumentedMatch } from "../engine/simulation/MillionMatchCampaignEngine";
import { DEFAULT_REGULATION_ID, DEFAULT_FRAME_ID, DEFAULT_DECISION_LIMIT } from "./largeScaleSimulationRunner";

async function verifyPhase1Evidence() {
  const originalLog = console.log;
  // 一時的に console.log を抑制（エンジン内のログで埋まるのを防ぐ）
  const results: any = {};

  // 1. Champion DNA の検証
  const champions = loadOfficialChampionsStrict();
  results.champions = {
    gen7Digest: champions.gen7Digest,
    gen5Digest: champions.gen5Digest,
  };

  // 2. 診断 Seed 履歴との衝突検証
  const diagSeeds = Array.from({ length: 30 }, (_, i) => 200_001 + i);
  const knownRanges = [
    { name: "Stage 3 Training", start: 1, end: 50_000 },
    { name: "Stage 3 Validation", start: 70_001, end: 70_100 },
    { name: "Stage 3 Official Holdout (Protected)", start: 95_001, end: 95_030 },
    { name: "Stage A Benchmark/Pilot", start: 1_001, end: 1_500 },
    { name: "Stage B 10K", start: 10_001, end: 15_000 },
  ];
  let seedCollisions = 0;
  for (const s of diagSeeds) {
    for (const r of knownRanges) {
      if (s >= r.start && s <= r.end) {
        seedCollisions++;
      }
    }
  }
  results.seedCollisions = seedCollisions;

  // 3. 210試合の整合性確認 (diagnostic-summary.json)
  const summaryPath = path.resolve(".artifacts/phase1-gen7-diagnostic/diagnostic-summary.json");
  const data = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const allStats: any[] = data.allStats;
  const oppCounts: Record<string, number> = {};
  for (const m of allStats) {
    oppCounts[m.opponent] = (oppCounts[m.opponent] || 0) + 1;
  }
  results.oppCounts = oppCounts;
  results.totalMatches = allStats.length;

  // 4. アクション採択率と PASS の質の詳細分析 (強制PASS vs 任意PASS)
  const rulesDir = path.resolve("src/data/rules-vnext");
  const fullPkg = await loadRulePackageFromDirectory(rulesDir);
  getPlaytestRulePackage(fullPkg);
  const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);

  let totalDecisions = 0;
  let forcedPassDecisions = 0;      // 選択肢が PASS のみ
  let optionalPassDecisions = 0;    // PASS 以外の選択肢があるのに PASS を選択した
  let actionChosenDecisions = 0;    // PASS 以外の行動を選択した
  let upperUnitAvailableDecisions = 0; // エース/英雄/魔術師が選択可能だったデシジョン
  let upperUnitChosenDecisions = 0;    // エース/英雄/魔術師を実際に召喚したデシジョン

  // console.log を一時的に空関数に
  console.log = () => {};

  for (let s = 200001; s <= 200010; s++) {
    const p1Seed = derivePlayerSeed(s, "p1");
    const p2Seed = derivePlayerSeed(s, "p2");

    const policy1 = new GenomePolicy(champions.gen7DNA, "Gen7");
    const policy2 = new GenomePolicy(champions.gen5DNA, "Gen5");

    executeSingleInstrumentedMatch({
      campaignId: "diag-verify",
      workId: "BP-SIM-AI-V92-WORK4-3-PHASE1-VERIFY",
      matchIndex: 0,
      pairIndex: 0,
      legIndex: 0,
      matchId: `verify-${s}`,
      matchupId: "verify",
      matchSeed: s,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: "gen7", name: "Gen7", kind: "GENOME", role: "CANDIDATE" },
      p2Spec: { policyId: "gen5", name: "Gen5", kind: "GENOME", role: "BASELINE" },
      p1Policy: {
        descriptor: policy1.descriptor,
        choose: (req) => {
          totalDecisions++;
          const patterns = req.patterns || [];
          const nonPassPatterns = patterns.filter((p: any) => p.kind !== "PASS");
          const hasUpperUnit = patterns.some((p: any) => {
            const actId = p.actionSelectionRef !== undefined ? req.catalog?.actions?.[p.actionSelectionRef]?.actionId : "";
            return actId === "action.summonAce" || actId === "action.summonHero" || actId === "action.summonMagician";
          });

          if (hasUpperUnit) {
            upperUnitAvailableDecisions++;
          }

          const res = policy1.choose(req);
          const chosen = patterns[res.selectedPatternRef];
          const chosenActId = chosen?.actionSelectionRef !== undefined ? req.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId : chosen?.kind;

          if (chosenActId === "action.summonAce" || chosenActId === "action.summonHero" || chosenActId === "action.summonMagician") {
            upperUnitChosenDecisions++;
          }

          if (patterns.length === 1 && patterns[0].kind === "PASS") {
            forcedPassDecisions++;
          } else if (chosen?.kind === "PASS" || chosenActId?.includes("pass")) {
            optionalPassDecisions++;
          } else {
            actionChosenDecisions++;
          }

          return res;
        }
      },
      p2Policy: policy2,
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    });
  }

  // console.log を復元
  console.log = originalLog;

  results.decisionQuality = {
    totalDecisions,
    forcedPassDecisions,
    forcedPassRate: (forcedPassDecisions / totalDecisions) * 100,
    optionalPassDecisions,
    optionalPassRate: (optionalPassDecisions / totalDecisions) * 100,
    actionChosenDecisions,
    actionChosenRate: (actionChosenDecisions / totalDecisions) * 100,
    upperUnitAvailableDecisions,
    upperUnitChosenDecisions,
    upperUnitAcceptanceRate: (upperUnitChosenDecisions / (upperUnitAvailableDecisions || 1)) * 100,
  };

  // 5. 自己対戦の先後差の二項検定
  const selfWinsP1 = 17;
  const selfWinsP2 = 13;
  const totalSelf = 30;
  function binomialPValue(n: number, k: number): number {
    function comb(n: number, r: number): number {
      let c = 1;
      for (let i = 0; i < r; i++) {
        c = (c * (n - i)) / (i + 1);
      }
      return c;
    }
    let pSum = 0;
    for (let x = k; x <= n; x++) {
      pSum += comb(n, x) * Math.pow(0.5, n);
    }
    return pSum * 2;
  }
  const pVal = binomialPValue(totalSelf, selfWinsP1);
  results.selfPlayTest = {
    selfWinsP1,
    selfWinsP2,
    totalSelf,
    pVal,
    isSignificant: pVal < 0.05,
  };

  const outPath = path.resolve(".artifacts/phase1-gen7-diagnostic/verify-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log("VERIFY_COMPLETE");
  console.log(JSON.stringify(results, null, 2));
}

verifyPhase1Evidence().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
