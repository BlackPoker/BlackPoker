import fs from "node:fs";
import path from "node:path";

interface MatchOutcome {
  matchIndex: number;
  pairIndex: number;
  legIndex: number;
  matchId: string;
  matchSeed: number;
  p1PolicyId: string;
  p2PolicyId: string;
  p1DnaDigest: string;
  p2DnaDigest: string;
  status: string;
  completed: boolean;
  winner: "p1" | "p2" | "draw";
  reason: string;
  totalDecisions: number;
  turnCount: number;
  passDecisions: number;
  maxConsecutivePasses: number;
  streamingDecisions: number;
  maxLegalPatterns: number;
  instantiationFailures: number;
  reachedDecisionLimit: boolean;
  finalStateHash: string;
  playerStats: {
    p1: {
      offeredActions: Record<string, number>;
      executedActions: Record<string, number>;
      passDecisions: number;
    };
    p2: {
      offeredActions: Record<string, number>;
      executedActions: Record<string, number>;
      passDecisions: number;
    };
  };
}

const CANDIDATE_DIGEST = "11fff0f578c92af376eece46ff90f9eba3785e59d0cf64d5eeffc7967946445e";
const GEN7_DIGEST = "04a1e2fa1b25c117558a9fb71fc60a57b10a26750540474d4c858e139e7aa3f4";

const dir = path.resolve(process.cwd(), ".artifacts/gen8-holdout-evaluation/chunks");
const chunkFiles = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort();

const matches: MatchOutcome[] = [];

for (const file of chunkFiles) {
  const filePath = path.join(dir, file);
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(l => l.trim().length > 0);
  for (const line of lines) {
    matches.push(JSON.parse(line));
  }
}

matches.sort((a, b) => a.matchIndex - b.matchIndex);

console.log(`Loaded ${matches.length} matches from ${chunkFiles.length} chunks.`);

// Pair calculation
const pairsMap = new Map<number, { leg0?: MatchOutcome; leg1?: MatchOutcome }>();
for (const m of matches) {
  if (!pairsMap.has(m.pairIndex)) {
    pairsMap.set(m.pairIndex, {});
  }
  const pair = pairsMap.get(m.pairIndex)!;
  if (m.legIndex === 0) pair.leg0 = m;
  else if (m.legIndex === 1) pair.leg1 = m;
}

let candWins = 0;
let candLosses = 0;
let draws = 0;

let leg0CandWins = 0;
let leg0CandLosses = 0;
let leg0Draws = 0;

let leg1CandWins = 0;
let leg1CandLosses = 0;
let leg1Draws = 0;

const pairScores: number[] = [];

for (let i = 0; i < 120; i++) {
  const pair = pairsMap.get(i);
  if (!pair || !pair.leg0 || !pair.leg1) {
    throw new Error(`Incomplete pair ${i}`);
  }

  // Leg 0: Cand is p1, Gen7 is p2
  let s0 = 0.5;
  if (pair.leg0.winner === "p1") {
    candWins++;
    leg0CandWins++;
    s0 = 1.0;
  } else if (pair.leg0.winner === "p2") {
    candLosses++;
    leg0CandLosses++;
    s0 = 0.0;
  } else {
    draws++;
    leg0Draws++;
  }

  // Leg 1: Gen7 is p1, Cand is p2
  let s1 = 0.5;
  if (pair.leg1.winner === "p2") {
    candWins++;
    leg1CandWins++;
    s1 = 1.0;
  } else if (pair.leg1.winner === "p1") {
    candLosses++;
    leg1CandLosses++;
    s1 = 0.0;
  } else {
    draws++;
    leg1Draws++;
  }

  pairScores.push((s0 + s1) / 2.0);
}

const nPairs = pairScores.length;
const meanPairScore = pairScores.reduce((a, b) => a + b, 0) / nPairs;
const variance = pairScores.reduce((acc, x) => acc + Math.pow(x - meanPairScore, 2), 0) / (nPairs - 1);
const standardDeviation = Math.sqrt(variance);
const standardError = standardDeviation / Math.sqrt(nPairs);

// t-critical for df=119 at alpha=0.05 (two-sided) is 1.9801
const tCritical95 = 1.9801;
const ci95Lower = meanPairScore - tCritical95 * standardError;
const ci95Upper = meanPairScore + tCritical95 * standardError;

// Z or t-stat for H0: mu <= 0.50
const tStatSup = (meanPairScore - 0.50) / standardError;
// Standard normal cdf approximation
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}
const pValueSup = 1 - normCdf(tStatSup); // one-sided p-value

const tStatNonInf = (meanPairScore - 0.45) / standardError;
const pValueNonInf = 1 - normCdf(tStatNonInf);

// Action stats aggregation
interface ActionCounter {
  executed: Record<string, number>;
  totalExecuted: number;
}
const candStats: ActionCounter = { executed: {}, totalExecuted: 0 };
const gen7Stats: ActionCounter = { executed: {}, totalExecuted: 0 };

let totalTurns = 0;
let totalDecisions = 0;
let reachedLimitCount = 0;
let instantiationFailureCount = 0;

for (const m of matches) {
  totalTurns += m.turnCount;
  totalDecisions += m.totalDecisions;
  if (m.reachedDecisionLimit) reachedLimitCount++;
  instantiationFailureCount += m.instantiationFailures;

  const isLeg0 = m.legIndex === 0;
  const candPlayerStats = isLeg0 ? m.playerStats.p1 : m.playerStats.p2;
  const gen7PlayerStats = isLeg0 ? m.playerStats.p2 : m.playerStats.p1;

  for (const [action, count] of Object.entries(candPlayerStats.executedActions)) {
    candStats.executed[action] = (candStats.executed[action] || 0) + count;
    candStats.totalExecuted += count;
  }
  for (const [action, count] of Object.entries(gen7PlayerStats.executedActions)) {
    gen7Stats.executed[action] = (gen7Stats.executed[action] || 0) + count;
    gen7Stats.totalExecuted += count;
  }
}

console.log("\n=== HOLDOUT STATISTICAL SUMMARY ===");
console.log(`Total Matches: ${matches.length} (${nPairs} pairs)`);
console.log(`Candidate Overall Win-Loss-Draw: ${candWins}W - ${candLosses}L - ${draws}D`);
console.log(`Candidate Overall Match Win Rate: ${(candWins / matches.length * 100).toFixed(2)}%`);
console.log(`Leg 0 (Candidate as P1): ${leg0CandWins}W - ${leg0CandLosses}L - ${leg0Draws}D (Win Rate: ${(leg0CandWins / 120 * 100).toFixed(2)}%)`);
console.log(`Leg 1 (Candidate as P2): ${leg1CandWins}W - ${leg1CandLosses}L - ${leg1Draws}D (Win Rate: ${(leg1CandWins / 120 * 100).toFixed(2)}%)`);
console.log(`Pair Score Mean: ${meanPairScore.toFixed(4)} (${(meanPairScore * 100).toFixed(2)}%)`);
console.log(`Pair Score Standard Deviation: ${standardDeviation.toFixed(4)}`);
console.log(`Standard Error (SE): ${standardError.toFixed(4)}`);
console.log(`95% Confidence Interval (t_df=119=1.9801): [${ci95Lower.toFixed(4)}, ${ci95Upper.toFixed(4)}]`);
console.log(`Superiority Test (H0: mu <= 0.50): t = ${tStatSup.toFixed(4)}, one-sided p = ${pValueSup.toExponential(4)}`);
console.log(`Superiority Criterion (95% CI Lower > 0.50): ${ci95Lower > 0.50 ? "PASS (ESTABLISHED)" : "FAIL"}`);
console.log(`Non-Inferiority Test (H0: mu <= 0.45): t = ${tStatNonInf.toFixed(4)}, one-sided p = ${pValueNonInf.toExponential(4)}`);
console.log(`Non-Inferiority Criterion (95% CI Lower > 0.45): ${ci95Lower > 0.45 ? "PASS (ESTABLISHED)" : "FAIL"}`);

console.log("\n=== GAMEPLAY QUALITY & ACTION COMPARISON ===");
console.log(`Average Turns: ${(totalTurns / matches.length).toFixed(2)}`);
console.log(`Average Decisions: ${(totalDecisions / matches.length).toFixed(2)}`);
console.log(`Reached Decision Limit (500): ${reachedLimitCount} / ${matches.length}`);
console.log(`Instantiation Failures: ${instantiationFailureCount}`);

console.log("\nAction Execution Frequencies:");
const allActionKeys = Array.from(new Set([...Object.keys(candStats.executed), ...Object.keys(gen7Stats.executed)])).sort();

console.log("Action | Candidate (Gen8) count (%) | Gen7 Champion count (%)");
console.log("---|---|---");
for (const k of allActionKeys) {
  const cCount = candStats.executed[k] || 0;
  const cPct = (cCount / candStats.totalExecuted * 100).toFixed(2);
  const gCount = gen7Stats.executed[k] || 0;
  const gPct = (gCount / gen7Stats.totalExecuted * 100).toFixed(2);
  console.log(`${k} | ${cCount} (${cPct}%) | ${gCount} (${gPct}%)`);
}

// Write summary JSON for inclusion in evidence
const summaryReport = {
  workId: "BP-SIM-AI-V92-WORK4-5-GEN8-OFFICIAL-HOLDOUT",
  headSha: "52cdb0b1f57d29f4a799fb009c4a113e3471672e",
  candidateDigest: CANDIDATE_DIGEST,
  gen7Digest: GEN7_DIGEST,
  totalMatches: matches.length,
  totalPairs: nPairs,
  candWins,
  candLosses,
  draws,
  winRate: candWins / matches.length,
  leg0: { wins: leg0CandWins, losses: leg0CandLosses, draws: leg0Draws, winRate: leg0CandWins / 120 },
  leg1: { wins: leg1CandWins, losses: leg1CandLosses, draws: leg1Draws, winRate: leg1CandWins / 120 },
  meanPairScore,
  standardDeviation,
  standardError,
  ci95Lower,
  ci95Upper,
  superiorityEstablished: ci95Lower > 0.50,
  nonInferiorityEstablished: ci95Lower > 0.45,
  tStatSup,
  pValueSup,
  totalTurns,
  averageTurns: totalTurns / matches.length,
  averageDecisions: totalDecisions / matches.length,
  reachedLimitCount,
  instantiationFailureCount,
  candStats,
  gen7Stats
};

fs.writeFileSync(
  path.resolve(process.cwd(), ".artifacts/gen8-holdout-evaluation/holdout-summary-report.json"),
  JSON.stringify(summaryReport, null, 2),
  "utf-8"
);
console.log("\nSummary report saved to .artifacts/gen8-holdout-evaluation/holdout-summary-report.json");
