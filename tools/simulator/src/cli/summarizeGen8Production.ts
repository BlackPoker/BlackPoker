import * as fs from "fs";
import * as path from "path";

const cpPath = path.resolve(".artifacts/gen8-production/checkpoint.json");
const cp = JSON.parse(fs.readFileSync(cpPath, "utf8"));

console.log("=== GEN 8 PRODUCTION EVOLUTION SUMMARY (10 GENERATIONS) ===");
console.log(`Cumulative Matches: ${cp.cumulativeMatchesExecuted}`);
console.log(`Best Ever Candidate: ${cp.bestEverCandidate.genomeId}`);
console.log(`Best Ever WinRate:   ${cp.bestEverCandidate.winRate.toFixed(1)}%`);
console.log(`Best Ever Digest:    ${cp.bestEverCandidate.dnaDigest}`);

console.log("\n[Generation-by-Generation Best Candidates]:");
for (const genRecord of cp.generationHistory) {
  const g = genRecord.generation;
  const best = genRecord.bestCandidate;
  const gen7Anchor = genRecord.ranking.find((r: any) => r.genomeId.includes("gen7champ") || r.genomeId.includes("gen7anchor"));
  const gen5Anchor = genRecord.ranking.find((r: any) => r.genomeId.includes("gen5champ"));

  console.log(
    `Gen ${g}: Best=${best.genomeId.padEnd(28)} WinRate=${best.winRate.toFixed(1)}% (vsGen7: ${best.vsGen7Wins}/${best.vsGen7Matches}, vsGen5: ${best.vsGen5Wins}/${best.vsGen5Matches}) | Atk=${best.attackCount} / Throw=${best.throwingCount} | (Anchor Gen7=${gen7Anchor?.winRate.toFixed(1)}%, Gen5=${gen5Anchor?.winRate.toFixed(1) ?? "N/A"}%)`
  );
}

// 成果物を Evidence ディレクトリにも保存
const evidenceDir = path.resolve("evidence/phase2-gen8-production");
fs.mkdirSync(evidenceDir, { recursive: true });

const summaryOut = {
  workId: cp.workId,
  timestamp: cp.timestamp,
  cumulativeMatchesExecuted: cp.cumulativeMatchesExecuted,
  maxMatchesLimit: cp.maxMatchesLimit,
  bestEverCandidate: cp.bestEverCandidate,
  generationBestSummary: cp.generationHistory.map((gh: any) => ({
    generation: gh.generation,
    bestCandidate: gh.bestCandidate,
    anchorGen7WinRate: gh.ranking.find((r: any) => r.genomeId.includes("gen7champ") || r.genomeId.includes("gen7anchor"))?.winRate,
    anchorGen5WinRate: gh.ranking.find((r: any) => r.genomeId.includes("gen5champ"))?.winRate,
  })),
};

fs.writeFileSync(path.join(evidenceDir, "production-evolution-summary.json"), JSON.stringify(summaryOut, null, 2), "utf8");
fs.copyFileSync(path.resolve(".artifacts/gen8-production/best-candidate-champion.json"), path.join(evidenceDir, "best-candidate-champion.json"));

console.log(`\nSummary saved to: ${evidenceDir}`);
