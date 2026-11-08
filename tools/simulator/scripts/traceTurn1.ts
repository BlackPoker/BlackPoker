import { loadRulePackageForBrowser } from "../src/engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../src/engine/regulation/BrowserRegulationLoader";
import { startMatchAttempt, OFFICIAL_ENV_PREFIX } from "../src/engine/playtest/PlaytestEnvironmentController";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader";
import { DecisionFeatureEncoder } from "../src/engine/ai/DecisionFeatureEncoder";
import { GenomeScorer } from "../src/engine/ai/GenomeScorer";

const fullRulePackage = loadRulePackageForBrowser();
const catalog = loadRegulationCatalogForBrowser();
const envId = `${OFFICIAL_ENV_PREFIX}standard-pack`;

const outcome = startMatchAttempt({
  environmentId: envId,
  seedInput: "4127992094",
  catalog,
  fullRulePackage,
});

if (outcome.type !== "READY") {
  console.error("Failed");
  process.exit(1);
}

const session = outcome.session;
const aiPolicy = createGen8ChampionCandidatePolicy();

console.log("=== Initial Step ===");
console.log("Initial Step Type:", outcome.initialStep.type);

if (outcome.initialStep.type === "WAITING_FOR_DECISION") {
  const req = outcome.initialStep.request;
  console.log("Waiting Player:", req.playerId);
  console.log("Decision ID:", req.decisionId);
  console.log("Pattern count:", req.patterns.length);

  const features = DecisionFeatureEncoder.encode(req);
  const scored = GenomeScorer.score(features, (aiPolicy as any).dna);

  console.log("\n--- Turn 1 AI Decision Request ---");
  for (let i = 0; i < req.patterns.length; i++) {
    const p = req.patterns[i];
    const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
    const scoreObj = scored.find((s) => s.patternRef === i);
    const score = scoreObj?.score ?? -Infinity;
    console.log(`[Pattern #${i}] score: ${score.toFixed(4)} | kind: ${p.kind} | action: ${act?.actionId || 'N/A'}`);
  }

  const best = scored.reduce((max, s) => s.score > max.score ? s : max, scored[0]);
  console.log("\n--- Field State at Turn 1 ---");
  const state = session.state;
  console.log("P1 field units:", state.players.p1.field?.length ?? 0);
  console.log("P2 field units:", state.players.p2.field?.length ?? 0);
  if (state.players.p2.field) {
    console.log("P2 field details:", JSON.stringify(state.players.p2.field));
  }
  if (state.players.p1.field) {
    console.log("P1 field details:", JSON.stringify(state.players.p1.field));
  }

  console.log("\n--- Best Pattern Details ---");
  console.log(JSON.stringify(req.patterns[best.patternRef], null, 2));
  if (bestPattern.actionSelectionRef !== undefined) {
    console.log("Action catalog entry:", JSON.stringify(req.catalog.actions[bestPattern.actionSelectionRef], null, 2));
  }
}
