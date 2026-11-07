import { loadOfficialChampionsStrict, DEFAULT_REGULATION_ID, DEFAULT_FRAME_ID, DEFAULT_DECISION_LIMIT } from "./largeScaleSimulationRunner";
import { prepareOfficialSessionFactory } from "./stage3EvolutionRunner";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { derivePlayerSeed, executeSingleInstrumentedMatch } from "../engine/simulation/MillionMatchCampaignEngine";
import * as path from "path";

async function main() {
  const rulesDir = path.resolve("src/data/rules-vnext");
  const fullPkg = await loadRulePackageFromDirectory(rulesDir);
  getPlaytestRulePackage(fullPkg);
  const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);
  const champions = loadOfficialChampionsStrict();

  const effectSources: Record<string, number> = {};
  let totalDecisions = 0;
  let totalPass = 0;
  let totalAttack = 0;

  // 10 Seeds でサンプル調査
  for (let s = 200001; s <= 200010; s++) {
    const p1Seed = derivePlayerSeed(s, "p1");
    const p2Seed = derivePlayerSeed(s, "p2");

    const policy1 = new GenomePolicy(champions.gen7DNA, "Gen7");
    const policy2 = new GenomePolicy(champions.gen5DNA, "Gen5");

    const res = executeSingleInstrumentedMatch({
      campaignId: "diag-sample",
      workId: "BP-SIM-AI-V92-WORK4-3-PHASE1",
      matchIndex: 0,
      pairIndex: 0,
      legIndex: 0,
      matchId: `sample-${s}`,
      matchupId: "sample",
      matchSeed: s,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: "gen7", name: "Gen7", kind: "GENOME", role: "CANDIDATE" },
      p2Spec: { policyId: "gen5", name: "Gen5", kind: "GENOME", role: "BASELINE" },
      p1Policy: {
        descriptor: policy1.descriptor,
        choose: (req) => {
          totalDecisions++;
          const pat = req.patterns?.[0];
          const srcAction = (req.source as any)?.sourceActionId || (req.source as any)?.type || req.source;
          effectSources[srcAction] = (effectSources[srcAction] || 0) + 1;
          return policy1.choose(req);
        }
      },
      p2Policy: policy2,
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    });
  }

  console.log("=== Decision Request Sources ===");
  for (const [src, count] of Object.entries(effectSources).sort((a,b) => b[1] - a[1])) {
    console.log(`  - ${src.padEnd(30)}: ${count} times`);
  }
}

main().catch(console.error);
