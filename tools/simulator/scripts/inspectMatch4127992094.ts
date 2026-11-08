import { loadRulePackageForBrowser } from "../src/engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../src/engine/regulation/BrowserRegulationLoader";
import { startMatchAttempt, OFFICIAL_ENV_PREFIX } from "../src/engine/playtest/PlaytestEnvironmentController";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader";

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
  console.error("Match start failed:", outcome);
  process.exit(1);
}

const state = outcome.session.state;
console.log("=== Match Initial Setup (Seed: 4127992094) ===");
console.log("Turn Player:", state.turnPlayer);
console.log("Turn Count:", state.turnCount);

console.log("\n--- Player 1 (Human) Initial Hand (count:", state.players.p1.hand.length, ") ---");
console.log(state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}(val:${c.value})`).join(", "));

console.log("\n--- Player 2 (Gen 8 AI) Initial Hand (count:", state.players.p2.hand.length, ") ---");
console.log(state.players.p2.hand.map((c: any) => `${c.suit}${c.rank}(val:${c.value})`).join(", "));

console.log("\n--- Player 1 (Human) Life Cards (top to bottom, count:", state.players.p1.life.length, ") ---");
console.log(state.players.p1.life.map((c: any) => `${c.suit}${c.rank}`).join(", "));

console.log("\n--- Player 2 (Gen 8 AI) Life Cards (top to bottom, count:", state.players.p2.life.length, ") ---");
console.log(state.players.p2.life.map((c: any) => `${c.suit}${c.rank}`).join(", "));

console.log("\n--- P1 Deck (next cards to draw) ---");
console.log((state.players.p1.deck || []).slice(0, 10).map((c: any) => `${c.suit}${c.rank}`).join(", "));

console.log("\n--- P2 Deck (next cards to draw) ---");
console.log((state.players.p2.deck || []).slice(0, 10).map((c: any) => `${c.suit}${c.rank}`).join(", "));
