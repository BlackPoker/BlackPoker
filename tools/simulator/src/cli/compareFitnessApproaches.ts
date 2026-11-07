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
import { RandomPolicy } from "../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../engine/random/RandomSource";
import {
  derivePlayerSeed,
  executeSingleInstrumentedMatch,
} from "../engine/simulation/MillionMatchCampaignEngine";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { GeneticMutation } from "../engine/ai/GeneticMutation";
import { validateGeneticOperatorConfig } from "../engine/ai/GeneticOperators";
import { SemanticSHA256 } from "../engine/ai/SemanticSHA256";

interface EvalRecord {
  genomeId: string;
  dna: DecisionDNA;
  digest: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  upperOffered: number;
  upperSummoned: number;
  upperRate: number;
  rawScore: number;
  shapedScore: number;
}

function withQuiet<T>(fn: () => T): T {
  const orig = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = orig;
  }
}

async function main() {
  console.log("================================================================================");
  console.log("BlackPoker Work 4-3 — Fitness Comparison: Outcome-First vs Auxiliary Shaped");
  console.log("================================================================================");

  const champions = loadOfficialChampionsStrict();
  const pilotBestPath = path.resolve("evidence/phase2-gen8-pilot/pilot-best-champion.json");
  const pilotBestDNA: DecisionDNA = JSON.parse(fs.readFileSync(pilotBestPath, "utf8"));

  const rulesDir = path.resolve("src/data/rules-vnext");
  const fullPkg = await loadRulePackageFromDirectory(rulesDir);
  getPlaytestRulePackage(fullPkg);
  const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);

  const BASE_SEED = 280001; // 比較実験用 Seed (他と重複なし)
  const mutationConfig = validateGeneticOperatorConfig({
    mutationRate: 0.08,
    mutationSigma: 0.05,
    mutationClampMin: -10,
    mutationClampMax: 10,
  });

  // 母集団 6 個体を用意 (PilotBest, Gen 7, および変異個体 4 体)
  const population: { genomeId: string; dna: DecisionDNA; digest: string }[] = [
    { genomeId: "pilot-best-seed", dna: DecisionDNACodec.clone(pilotBestDNA), digest: SemanticSHA256.hash(JSON.stringify(pilotBestDNA)) },
    { genomeId: "gen7-champion-seed", dna: DecisionDNACodec.clone(champions.gen7DNA), digest: champions.gen7Digest },
  ];

  for (let i = 2; i < 6; i++) {
    const mutated = GeneticMutation.mutate(
      { patternWeights: pilotBestDNA.patternWeights, contextPatternWeights: pilotBestDNA.contextPatternWeights },
      BASE_SEED + i * 199,
      mutationConfig
    );
    const dna: DecisionDNA = {
      ...pilotBestDNA,
      metadata: { ...pilotBestDNA.metadata, id: `dna-cmp-ind${i}` },
      patternWeights: mutated.patternWeights,
      contextPatternWeights: mutated.contextPatternWeights,
    };
    population.push({
      genomeId: `cmp-ind${i}`,
      dna,
      digest: SemanticSHA256.hash(JSON.stringify(dna)),
    });
  }

  console.log(`- Population Size: 6 individuals`);
  console.log(`- Comparing Selection Rankings under:`);
  console.log(`    Mode A: Outcome-First (WinRate only)`);
  console.log(`    Mode B: Auxiliary Shaped (WinRate + Upper Unit Summon Bonus)`);
  console.log("--------------------------------------------------------------------------------");

  const records: EvalRecord[] = population.map((ind) => ({
    genomeId: ind.genomeId,
    dna: ind.dna,
    digest: ind.digest,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    upperOffered: 0,
    upperSummoned: 0,
    upperRate: 0,
    rawScore: 0,
    shapedScore: 0,
  }));

  // 各個体を Gen 7 Champion (10 試合) および SeededRandom (6 試合) と対戦 (計 16 試合/個体 x 6 = 96 試合)
  for (let idx = 0; idx < records.length; idx++) {
    const rec = records[idx];
    const candPolicy = new GenomePolicy(rec.dna, rec.genomeId);

    // vs Gen 7 (5 seeds x 2 legs = 10 matches)
    for (let s = 0; s < 5; s++) {
      const matchSeed = BASE_SEED + idx * 50 + s;
      const p1Seed = derivePlayerSeed(matchSeed, "p1");
      const p2Seed = derivePlayerSeed(matchSeed, "p2");

      // Leg 0: Cand as p1
      const res0 = withQuiet(() =>
        executeSingleInstrumentedMatch({
          campaignId: "fit-cmp",
          workId: "WORK4-3-FIT-CMP",
          matchIndex: 0,
          pairIndex: 0,
          legIndex: 0,
          matchId: `cmp-s${matchSeed}-l0`,
          matchupId: "cmp",
          matchSeed,
          playerSeeds: { p1: p1Seed, p2: p2Seed },
          p1Spec: { policyId: rec.genomeId, name: rec.genomeId, kind: "GENOME", role: "CANDIDATE" },
          p2Spec: { policyId: "gen7", name: "Gen7", kind: "GENOME", role: "BASELINE" },
          p1Policy: {
            descriptor: candPolicy.descriptor,
            choose: (req) => {
              const patterns = req.patterns || [];
              if (patterns.some((p: any) => {
                const actId = p.actionSelectionRef !== undefined ? req.catalog?.actions?.[p.actionSelectionRef]?.actionId : "";
                return actId === "action.summonAce" || actId === "action.summonHero" || actId === "action.summonMagician";
              })) {
                rec.upperOffered++;
              }
              const res = candPolicy.choose(req);
              const chosen = patterns[res.selectedPatternRef];
              const chosenActId = chosen?.actionSelectionRef !== undefined ? req.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId : chosen?.kind;
              if (chosenActId === "action.summonAce" || chosenActId === "action.summonHero" || chosenActId === "action.summonMagician") {
                rec.upperSummoned++;
              }
              return res;
            }
          },
          p2Policy: new GenomePolicy(champions.gen7DNA, "Gen7"),
          sessionFactory,
          regulationId: DEFAULT_REGULATION_ID,
          frameId: DEFAULT_FRAME_ID,
          maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        })
      );

      rec.matches++;
      if (res0.outcomeRecord.winner === "p1") rec.wins++;
      else if (res0.outcomeRecord.winner === "p2") rec.losses++;
      else rec.draws++;

      // Leg 1: Cand as p2
      const res1 = withQuiet(() =>
        executeSingleInstrumentedMatch({
          campaignId: "fit-cmp",
          workId: "WORK4-3-FIT-CMP",
          matchIndex: 1,
          pairIndex: 0,
          legIndex: 1,
          matchId: `cmp-s${matchSeed}-l1`,
          matchupId: "cmp",
          matchSeed,
          playerSeeds: { p1: p1Seed, p2: p2Seed },
          p1Spec: { policyId: "gen7", name: "Gen7", kind: "GENOME", role: "BASELINE" },
          p2Spec: { policyId: rec.genomeId, name: rec.genomeId, kind: "GENOME", role: "CANDIDATE" },
          p1Policy: new GenomePolicy(champions.gen7DNA, "Gen7"),
          p2Policy: {
            descriptor: candPolicy.descriptor,
            choose: (req) => {
              const patterns = req.patterns || [];
              if (patterns.some((p: any) => {
                const actId = p.actionSelectionRef !== undefined ? req.catalog?.actions?.[p.actionSelectionRef]?.actionId : "";
                return actId === "action.summonAce" || actId === "action.summonHero" || actId === "action.summonMagician";
              })) {
                rec.upperOffered++;
              }
              const res = candPolicy.choose(req);
              const chosen = patterns[res.selectedPatternRef];
              const chosenActId = chosen?.actionSelectionRef !== undefined ? req.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId : chosen?.kind;
              if (chosenActId === "action.summonAce" || chosenActId === "action.summonHero" || chosenActId === "action.summonMagician") {
                rec.upperSummoned++;
              }
              return res;
            }
          },
          sessionFactory,
          regulationId: DEFAULT_REGULATION_ID,
          frameId: DEFAULT_FRAME_ID,
          maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        })
      );

      rec.matches++;
      if (res1.outcomeRecord.winner === "p2") rec.wins++;
      else if (res1.outcomeRecord.winner === "p1") rec.losses++;
      else rec.draws++;
    }

    // vs SeededRandom (3 seeds x 2 legs = 6 matches)
    for (let s = 0; s < 3; s++) {
      const matchSeed = BASE_SEED + 500 + idx * 50 + s;
      const p1Seed = derivePlayerSeed(matchSeed, "p1");
      const p2Seed = derivePlayerSeed(matchSeed, "p2");

      const res0 = withQuiet(() =>
        executeSingleInstrumentedMatch({
          campaignId: "fit-cmp-rand",
          workId: "WORK4-3-FIT-CMP",
          matchIndex: 0,
          pairIndex: 0,
          legIndex: 0,
          matchId: `cmp-rand-s${matchSeed}-l0`,
          matchupId: "cmp-rand",
          matchSeed,
          playerSeeds: { p1: p1Seed, p2: p2Seed },
          p1Spec: { policyId: rec.genomeId, name: rec.genomeId, kind: "GENOME", role: "CANDIDATE" },
          p2Spec: { policyId: "rand", name: "Rand", kind: "SEEDED_RANDOM", role: "BASELINE" },
          p1Policy: candPolicy,
          p2Policy: new RandomPolicy(new SeededRandom(p2Seed), "Rand"),
          sessionFactory,
          regulationId: DEFAULT_REGULATION_ID,
          frameId: DEFAULT_FRAME_ID,
          maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        })
      );
      rec.matches++;
      if (res0.outcomeRecord.winner === "p1") rec.wins++;
      else if (res0.outcomeRecord.winner === "p2") rec.losses++;
      else rec.draws++;

      const res1 = withQuiet(() =>
        executeSingleInstrumentedMatch({
          campaignId: "fit-cmp-rand",
          workId: "WORK4-3-FIT-CMP",
          matchIndex: 1,
          pairIndex: 0,
          legIndex: 1,
          matchId: `cmp-rand-s${matchSeed}-l1`,
          matchupId: "cmp-rand",
          matchSeed,
          playerSeeds: { p1: p1Seed, p2: p2Seed },
          p1Spec: { policyId: "rand", name: "Rand", kind: "SEEDED_RANDOM", role: "BASELINE" },
          p2Spec: { policyId: rec.genomeId, name: rec.genomeId, kind: "GENOME", role: "CANDIDATE" },
          p1Policy: new RandomPolicy(new SeededRandom(p1Seed), "Rand"),
          p2Policy: candPolicy,
          sessionFactory,
          regulationId: DEFAULT_REGULATION_ID,
          frameId: DEFAULT_FRAME_ID,
          maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        })
      );
      rec.matches++;
      if (res1.outcomeRecord.winner === "p2") rec.wins++;
      else if (res1.outcomeRecord.winner === "p1") rec.losses++;
      else rec.draws++;
    }

    rec.winRate = (rec.wins / rec.matches) * 100;
    rec.upperRate = rec.upperOffered > 0 ? (rec.upperSummoned / rec.upperOffered) * 100 : 0;
    rec.rawScore = (rec.wins * 1.0 + rec.draws * 0.5) / rec.matches;
    // 補助報酬: 上位ユニット召喚率ボーナス (+0.15 * upperRate / 100)
    rec.shapedScore = rec.rawScore + 0.15 * (rec.upperRate / 100);
  }

  console.log("\n[Evaluation Results for All 6 Individuals (16 matches each)]:");
  for (const r of records) {
    console.log(
      `  - ${r.genomeId.padEnd(20)}: Wins=${r.wins.toString().padStart(2)}/${r.matches} (WinRate: ${r.winRate.toFixed(1).padStart(5)}%) | UpperUnit=${r.upperRate.toFixed(1).padStart(4)}% (${r.upperSummoned}/${r.upperOffered}) | RawScore=${r.rawScore.toFixed(3)} | ShapedScore=${r.shapedScore.toFixed(3)}`
    );
  }

  // ランキング比較
  const rankedRaw = [...records].sort((a, b) => b.rawScore - a.rawScore);
  const rankedShaped = [...records].sort((a, b) => b.shapedScore - a.shapedScore);

  console.log("\n[Selection Comparison]:");
  console.log(`- Mode A (Outcome-First Winner):   ${rankedRaw[0].genomeId} (WinRate: ${rankedRaw[0].winRate.toFixed(1)}%, UpperUnit: ${rankedRaw[0].upperRate.toFixed(1)}%)`);
  console.log(`- Mode B (Auxiliary Shaped Winner): ${rankedShaped[0].genomeId} (WinRate: ${rankedShaped[0].winRate.toFixed(1)}%, UpperUnit: ${rankedShaped[0].upperRate.toFixed(1)}%)`);

  // 考察
  console.log("\n[Key Findings]:");
  if (rankedRaw[0].genomeId !== rankedShaped[0].genomeId) {
    console.log(`- Ranking Inversion DETECTED: Auxiliary reward prioritizes an individual with lower actual win rate!`);
    console.log(`  => Adopting shaped reward would DISTORT selection away from true victory objective.`);
  } else {
    console.log(`- Top individual matches, but Mode B artificially distorts relative fitness differentials.`);
  }

  const outDir = path.resolve(".artifacts/fitness-comparison");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "fitness-comparison-results.json"), JSON.stringify({
    timestamp: new Date().toISOString(),
    records,
    rankedRaw: rankedRaw.map((r) => ({ genomeId: r.genomeId, winRate: r.winRate, rawScore: r.rawScore })),
    rankedShaped: rankedShaped.map((r) => ({ genomeId: r.genomeId, winRate: r.winRate, shapedScore: r.shapedScore })),
  }, null, 2), "utf8");
}

main().catch(console.error);
