import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadRegulationCatalog, RegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { GameSession } from "../../engine/session/GameSession";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { GenomeScorer } from "../../engine/ai/GenomeScorer";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { PATTERN_FEATURE_NAMES } from "../../domain/ai/DecisionFeatureTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Lightweight Benchmark (BP-SIM-AI-FEATURE-SCHEMA-V2)", () => {
  let catalog: RegulationCatalog;
  let rulePackage: RulePackage;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const setupStandardPackSession = (seed: number): GameSession => {
    const reg = catalog.regulations.get("standard-pack")!;
    const frame = catalog.frames.get(reg.frameId)!;
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, seed);
    if (outcome.type !== "READY") throw new Error(outcome.reason);
    return new GameSession(outcome.state, rulePackage);
  };

  it("Benchmark A: Single DecisionRequest Encode + Score + Argmax Throughput", () => {
    const session = setupStandardPackSession(42);
    const step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    const req = step.request;
    const dna = DecisionDNACodec.createZeroDecisionDNA();
    const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
    (dna.patternWeights as number[])[actIdx] = 2.0;

    // Warm-up
    for (let i = 0; i < 50; i++) {
      const features = DecisionFeatureEncoder.encode(req);
      const scored = GenomeScorer.score(features, dna);
      let best = -Infinity;
      let bestRef = 0;
      for (const sp of scored) {
        if (sp.score > best) {
          best = sp.score;
          bestRef = sp.patternRef;
        }
      }
    }

    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const features = DecisionFeatureEncoder.encode(req);
      const scored = GenomeScorer.score(features, dna);
      let best = -Infinity;
      let bestRef = 0;
      for (const sp of scored) {
        if (sp.score > best) {
          best = sp.score;
          bestRef = sp.patternRef;
        }
      }
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;
    const opsPerSec = Math.round((iterations / elapsed) * 1000);

    process.stderr.write(`\n[BENCHMARK A] Total: ${elapsed.toFixed(2)}ms for ${iterations} iterations\n`);
    process.stderr.write(`[BENCHMARK A] Avg: ${avgMs.toFixed(4)}ms/op (${opsPerSec} ops/sec)\n`);

    expect(avgMs).toBeLessThan(5.0); // 1回の判断は 5ms 未満であること（十分高速）
  });

  it("Benchmark B: Small-Scale Match Simulation with Standard + Pack Genome", () => {
    const matches = 3;
    const dnaA = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-a" });
    const dnaB = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-b" });
    const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
    (dnaA.patternWeights as number[])[actIdx] = 1.5;
    (dnaB.patternWeights as number[])[actIdx] = 0.5;

    const start = performance.now();
    let totalDecisions = 0;

    for (let m = 0; m < matches; m++) {
      const session = setupStandardPackSession(1000 + m);
      const policyA = new GenomePolicy(dnaA);
      const policyB = new GenomePolicy(dnaB);

      let steps = 0;
      while (steps < 30) {
        const step = session.advance();
        if (step.type === "FINISHED") break;
        if (step.type !== "WAITING_FOR_DECISION") break;
        const req = step.request;
        const policy = req.playerId === "p1" ? policyA : policyB;
        const res = policy.choose(req);
        session.submitDecision(res);
        steps++;
        totalDecisions++;
      }
    }

    const elapsed = performance.now() - start;
    const avgMsPerMatch = elapsed / matches;
    const avgMsPerDecision = elapsed / totalDecisions;

    process.stderr.write(`\n[BENCHMARK B] Total: ${elapsed.toFixed(2)}ms for ${matches} matches (${totalDecisions} decisions)\n`);
    process.stderr.write(`[BENCHMARK B] Avg per Match: ${avgMsPerMatch.toFixed(2)}ms/match\n`);
    process.stderr.write(`[BENCHMARK B] Avg per Decision: ${avgMsPerDecision.toFixed(4)}ms/decision\n\n`);

    expect(avgMsPerDecision).toBeLessThan(10.0);
  });
});
