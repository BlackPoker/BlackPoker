import * as fs from "fs";
import * as path from "path";

const summaryPath = path.resolve(".artifacts/phase1-gen7-diagnostic/diagnostic-summary.json");
const data = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

const allStats: any[] = data.allStats;

console.log("=== DETAILED DEEP INSPECTION OF PHASE 1 ===");

// 1. 各相手ごとの勝率・勝敗詳細
for (const opp of ["gen5", "self", "random", "first-legal"]) {
  const matches = allStats.filter((m) => m.opponent === opp);
  const wins = matches.filter((m) => m.won).length;
  const p1Matches = matches.filter((m) => m.seat === "p1");
  const p2Matches = matches.filter((m) => m.seat === "p2");
  const p1Wins = p1Matches.filter((m) => m.won).length;
  const p2Wins = p2Matches.filter((m) => m.won).length;
  console.log(`\n[Opponent: ${opp}] Total: ${wins}/${matches.length} (${((wins/matches.length)*100).toFixed(1)}%)`);
  console.log(`  - Seat p1 (First): ${p1Wins}/${p1Matches.length} (${((p1Wins/(p1Matches.length||1))*100).toFixed(1)}%)`);
  if (p2Matches.length > 0) {
    console.log(`  - Seat p2 (Second): ${p2Wins}/${p2Matches.length} (${((p2Wins/(p2Matches.length||1))*100).toFixed(1)}%)`);
  }
}

// 2. アクションの採択率 (Executed / Offered)
const globalExecuted: Record<string, number> = {};
const globalOffered: Record<string, number> = {};

for (const m of allStats) {
  for (const [k, v] of Object.entries(m.executedActions as Record<string, number>)) {
    globalExecuted[k] = (globalExecuted[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(m.offeredActions as Record<string, number>)) {
    globalOffered[k] = (globalOffered[k] || 0) + v;
  }
}

console.log("\n[Action Acceptance Rates (Executed / Offered)]:");
const actionKeys = Array.from(new Set([...Object.keys(globalExecuted), ...Object.keys(globalOffered)]));
actionKeys.sort((a, b) => (globalExecuted[b] || 0) - (globalExecuted[a] || 0));

for (const key of actionKeys) {
  const exec = globalExecuted[key] || 0;
  const offer = globalOffered[key] || 0;
  const rate = offer > 0 ? ((exec / offer) * 100).toFixed(1) : "N/A";
  console.log(`  - ${key.padEnd(25)}: Exec=${exec.toString().padStart(5)} / Offer=${offer.toString().padStart(6)} (${rate.padStart(5)}%)`);
}

// 3. Gen 5 に対する敗北試合の分析
const vsGen5Losses = allStats.filter((m) => m.opponent === "gen5" && !m.won);
console.log(`\n[vs Gen 5 Losses Deep Dive: ${vsGen5Losses.length} matches]`);
for (const loss of vsGen5Losses.slice(0, 5)) {
  console.log(`  - Match: ${loss.matchId} (Seat: ${loss.seat}, Turns: ${loss.turnCount}, Decisions: ${loss.totalDecisions}, Pass%: ${((loss.passDecisions/loss.totalDecisions)*100).toFixed(1)}%) Reason: ${loss.reason}`);
}

// 4. 先手・後手の全体勝率
const allP1 = allStats.filter((m) => m.seat === "p1");
const allP2 = allStats.filter((m) => m.seat === "p2");
console.log(`\n[Seat Advantage (All Matches)]`);
console.log(`  - P1 WinRate: ${((allP1.filter(m => m.won).length / allP1.length)*100).toFixed(1)}% (${allP1.filter(m => m.won).length}/${allP1.length})`);
console.log(`  - P2 WinRate: ${((allP2.filter(m => m.won).length / allP2.length)*100).toFixed(1)}% (${allP2.filter(m => m.won).length}/${allP2.length})`);
