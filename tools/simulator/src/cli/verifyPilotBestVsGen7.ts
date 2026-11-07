import * as fs from "fs";
import * as path from "path";
import {
  loadOfficialChampionsStrict,
  DEFAULT_REGULATION_ID,
  DEFAULT_FRAME_ID,
  DEFAULT_DECISION_LIMIT,
} from "./largeScaleSimulationRunner";
import { prepareOfficialSessionFactory } from "./stage3EvolutionRunner";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { derivePlayerSeed, executeSingleInstrumentedMatch } from "../engine/simulation/MillionMatchCampaignEngine";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { SemanticSHA256 } from "../engine/ai/SemanticSHA256";

async function main() {
  console.log("================================================================================");
  console.log("BlackPoker Work 4-3 — Pilot Best Candidate vs Gen 7 Champion Head-to-Head (60 Matches)");
  console.log("================================================================================");

  const bestDnaPath = path.resolve(".artifacts/phase2-gen8-pilot/pilot-best-champion.json");
  const bestDNA: DecisionDNA = JSON.parse(fs.readFileSync(bestDnaPath, "utf8"));
  const bestDigest = SemanticSHA256.hash(JSON.stringify(bestDNA));

  const champions = loadOfficialChampionsStrict();
  const rulesDir = path.resolve("src/data/rules-vnext");
  const fullPkg = await loadRulePackageFromDirectory(rulesDir);
  getPlaytestRulePackage(fullPkg);
  const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);

  console.log(`- Pilot Best Candidate: ${bestDigest}`);
  console.log(`- Official Gen 7:        ${champions.gen7Digest}`);
  console.log("--------------------------------------------------------------------------------");

  const seedsCount = 30; // 30 seeds x 2 legs = 60 matches
  const startSeed = 200001; // 診断用 Seed (Holdout 95001-95030 保護)

  let bestWins = 0;
  let gen7Wins = 0;
  let draws = 0;

  let bestThrowing = 0;
  let bestAttack = 0;
  let gen7Throwing = 0;
  let gen7Attack = 0;

  const originalLog = console.log;

  for (let i = 0; i < seedsCount; i++) {
    const matchSeed = startSeed + i;
    const p1Seed = derivePlayerSeed(matchSeed, "p1");
    const p2Seed = derivePlayerSeed(matchSeed, "p2");

    // Leg 0: Best as p1, Gen 7 as p2
    const policyBest0 = new GenomePolicy(bestDNA, "PilotBest");
    const policyGen70 = new GenomePolicy(champions.gen7DNA, "Gen7");

    console.log = () => {};
    const res0 = executeSingleInstrumentedMatch({
      campaignId: "h2h-verify",
      workId: "WORK4-3-H2H",
      matchIndex: i * 2,
      pairIndex: i,
      legIndex: 0,
      matchId: `h2h-s${matchSeed}-l0-best-vs-gen7`,
      matchupId: "h2h",
      matchSeed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: "pilot-best", name: "PilotBest", kind: "GENOME", role: "CANDIDATE", dnaDigest: bestDigest },
      p2Spec: { policyId: "gen7", name: "Gen7", kind: "GENOME", role: "BASELINE", dnaDigest: champions.gen7Digest },
      p1Policy: {
        descriptor: policyBest0.descriptor,
        choose: (req) => {
          const res = policyBest0.choose(req);
          const chosen = req.patterns?.[res.selectedPatternRef];
          const actId = chosen?.actionSelectionRef !== undefined ? req.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId : chosen?.kind;
          if (actId === "action.throwing") bestThrowing++;
          if (actId === "action.attack") bestAttack++;
          return res;
        }
      },
      p2Policy: {
        descriptor: policyGen70.descriptor,
        choose: (req) => {
          const res = policyGen70.choose(req);
          const chosen = req.patterns?.[res.selectedPatternRef];
          const actId = chosen?.actionSelectionRef !== undefined ? req.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId : chosen?.kind;
          if (actId === "action.throwing") gen7Throwing++;
          if (actId === "action.attack") gen7Attack++;
          return res;
        }
      },
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    });
    console.log = originalLog;

    if (res0.outcomeRecord.winner === "p1") bestWins++;
    else if (res0.outcomeRecord.winner === "p2") gen7Wins++;
    else draws++;

    // Leg 1: Gen 7 as p1, Best as p2
    const policyBest1 = new GenomePolicy(bestDNA, "PilotBest");
    const policyGen71 = new GenomePolicy(champions.gen7DNA, "Gen7");

    console.log = () => {};
    const res1 = executeSingleInstrumentedMatch({
      campaignId: "h2h-verify",
      workId: "WORK4-3-H2H",
      matchIndex: i * 2 + 1,
      pairIndex: i,
      legIndex: 1,
      matchId: `h2h-s${matchSeed}-l1-gen7-vs-best`,
      matchupId: "h2h",
      matchSeed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: "gen7", name: "Gen7", kind: "GENOME", role: "BASELINE", dnaDigest: champions.gen7Digest },
      p2Spec: { policyId: "pilot-best", name: "PilotBest", kind: "GENOME", role: "CANDIDATE", dnaDigest: bestDigest },
      p1Policy: {
        descriptor: policyGen71.descriptor,
        choose: (req) => {
          const res = policyGen71.choose(req);
          const chosen = req.patterns?.[res.selectedPatternRef];
          const actId = chosen?.actionSelectionRef !== undefined ? req.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId : chosen?.kind;
          if (actId === "action.throwing") gen7Throwing++;
          if (actId === "action.attack") gen7Attack++;
          return res;
        }
      },
      p2Policy: {
        descriptor: policyBest1.descriptor,
        choose: (req) => {
          const res = policyBest1.choose(req);
          const chosen = req.patterns?.[res.selectedPatternRef];
          const actId = chosen?.actionSelectionRef !== undefined ? req.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId : chosen?.kind;
          if (actId === "action.throwing") bestThrowing++;
          if (actId === "action.attack") bestAttack++;
          return res;
        }
      },
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    });
    console.log = originalLog;

    if (res1.outcomeRecord.winner === "p2") bestWins++;
    else if (res1.outcomeRecord.winner === "p1") gen7Wins++;
    else draws++;
  }

  const totalMatches = seedsCount * 2;
  const winRate = (bestWins / totalMatches) * 100;

  console.log("\n================================================================================");
  console.log("HEAD-TO-HEAD RESULT (Pilot Best vs Gen 7 Champion)");
  console.log("================================================================================");
  console.log(`- Pilot Best Wins:  ${bestWins} / ${totalMatches} (${winRate.toFixed(1)}%)`);
  console.log(`- Gen 7 Wins:       ${gen7Wins} / ${totalMatches} (${((gen7Wins / totalMatches) * 100).toFixed(1)}%)`);
  console.log(`- Draws:            ${draws}`);
  console.log("\n[Tactical Balance Comparison (All 60 Matches)]:");
  console.log(`- Pilot Best Candidate: Attack=${bestAttack} / Throwing=${bestThrowing} (Attack Ratio: ${((bestAttack / (bestAttack + bestThrowing)) * 100).toFixed(1)}%)`);
  console.log(`- Gen 7 Champion:       Attack=${gen7Attack} / Throwing=${gen7Throwing} (Attack Ratio: ${((gen7Attack / (gen7Attack + gen7Throwing)) * 100).toFixed(1)}%)`);

  const h2hSummaryPath = path.resolve(".artifacts/phase2-gen8-pilot/h2h-vs-gen7-summary.json");
  fs.writeFileSync(h2hSummaryPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalMatches,
    bestWins,
    gen7Wins,
    draws,
    winRate,
    tactics: {
      pilotBest: { attack: bestAttack, throwing: bestThrowing },
      gen7: { attack: gen7Attack, throwing: gen7Throwing },
    }
  }, null, 2), "utf8");
}

main().catch(console.error);
