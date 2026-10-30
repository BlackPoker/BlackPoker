import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1 Acceptance Suite", () => {
  let reportJson: any;
  let markdownContent: string;

  beforeAll(() => {
    const jsonPath = path.resolve(__dirname, "../../../reports/ai/v92-v6-evolution-baseline-v1.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    reportJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    const mdPath = path.resolve(__dirname, "../../../docs/ai-v92-v6-evolution-baseline-v1.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    markdownContent = fs.readFileSync(mdPath, "utf-8");
  });

  describe("Group 1: Artifact & Schema Integrity", () => {
    it("Test 1: Report Metadata - matches workId, schemaVersion 6, and target commit", () => {
      expect(reportJson.workId).toBe("BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1");
      expect(reportJson.schemaVersion).toBe(6);
      expect(reportJson.startSha).toBe("9c07b350ae9af8140a6c53466db8c49add299b4d");
    });

    it("Test 2: Markdown Synchronization - markdown contains workId, schemaVersion, and key section headings", () => {
      expect(markdownContent).toContain("BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1");
      expect(markdownContent).toContain("**Feature Schema**: `v6`");
      expect(markdownContent).toContain("308 features");
      expect(markdownContent).toContain("23,738");
      expect(markdownContent).toContain("Light-Entry16 Controlled Evolution");
      expect(markdownContent).toContain("Standard + Pack Smoke");
      expect(markdownContent).toContain("Diagnostic v2");
      expect(markdownContent).toContain("Historical Comparison");
    });
  });

  describe("Group 2: Evolution Baseline B (light-entry16) Outcomes & Conservation", () => {
    it("Test 3: g0 Evaluation - 30 scheduled, 30 completed, 0 incomplete, status ADVANCED", () => {
      const g0 = reportJson.evolution.g0;
      expect(g0.totalScheduledMatches).toBe(30);
      expect(g0.completedMatches).toBe(30);
      expect(g0.incompleteMatches).toBe(0);
      expect(g0.failedMatches).toBe(0);
      expect(g0.drawMatches).toBe(0);
      expect(g0.status).toBe("ADVANCED");
      expect(g0.decisionStats.min).toBeGreaterThan(0);
      expect(g0.decisionStats.max).toBeLessThanOrEqual(500);
    });

    it("Test 4: g1 Evaluation - 30 scheduled, 30 completed, 0 incomplete, status ADVANCED", () => {
      const g1 = reportJson.evolution.g1;
      expect(g1.totalScheduledMatches).toBe(30);
      expect(g1.completedMatches).toBe(30);
      expect(g1.incompleteMatches).toBe(0);
      expect(g1.failedMatches).toBe(0);
      expect(g1.drawMatches).toBe(0);
      expect(g1.status).toBe("ADVANCED");
      expect(g1.decisionStats.min).toBeGreaterThan(0);
      expect(g1.decisionStats.max).toBeLessThanOrEqual(500);
    });

    it("Test 5: DNA Weights Dimensions - all g0 and g1 individuals have exactly 23,738 total weights", () => {
      for (const d of reportJson.evolution.g0.dnaDigests) {
        expect(d.totalWeights).toBe(23738);
      }
      for (const d of reportJson.evolution.g1.dnaDigests) {
        expect(d.totalWeights).toBe(23738);
      }
    });

    it("Test 6: Fitness Conservation Laws - mathematically satisfied for both g0 and g1", () => {
      const fc0 = reportJson.evolution.g0.fitnessConservation;
      expect(fc0.valid).toBe(true);
      expect(fc0.individualConservationAllOk).toBe(true);
      expect(fc0.winsEqualsDecisive).toBe(true);
      expect(fc0.lossesEqualsDecisive).toBe(true);
      expect(fc0.drawsEqualsMatchDraws).toBe(true);
      expect(fc0.completedEqualsDoubleMatches).toBe(true);

      const fc1 = reportJson.evolution.g1.fitnessConservation;
      expect(fc1.valid).toBe(true);
      expect(fc1.individualConservationAllOk).toBe(true);
      expect(fc1.winsEqualsDecisive).toBe(true);
      expect(fc1.lossesEqualsDecisive).toBe(true);
      expect(fc1.drawsEqualsMatchDraws).toBe(true);
      expect(fc1.completedEqualsDoubleMatches).toBe(true);
    });
  });

  describe("Group 3: Determinism Across Independent Re-executions (Run A vs Run B)", () => {
    it("Test 7: g0 Determinism - Run A == Run B across all DNA, matches, fitness, and trace digests", () => {
      const det0 = reportJson.evolution.g0.determinism;
      expect(det0.overall).toBe(true);
      expect(det0.dnaFullEquality.overall).toBe(true);
      expect(det0.matchesEqual).toBe(true);
      expect(det0.fitnessEqual).toBe(true);
      expect(det0.manifestEqual).toBe(true);
      expect(det0.decisionTraceDigestsEqual).toBe(true);
    });

    it("Test 8: g1 Determinism - Run A == Run B across all DNA, schedules, matches, fitness, and trace digests", () => {
      const det1 = reportJson.evolution.g1.determinism;
      expect(det1.overall).toBe(true);
      expect(det1.dnaFullEquality.overall).toBe(true);
      expect(det1.scheduleEqual).toBe(true);
      expect(det1.matchesEqual).toBe(true);
      expect(det1.fitnessEqual).toBe(true);
      expect(det1.manifestEqual).toBe(true);
      expect(det1.decisionTraceDigestsEqual).toBe(true);
    });
  });

  describe("Group 4: Diagnostic v2 Validation (Representative Matches)", () => {
    it("Test 9: Representative Match Criteria - tests include multi-turn, stage resolution, decisions > 20 from both g0 and g1", () => {
      const diagVal = reportJson.diagnosticValidation;
      expect(diagVal.diagnosticVersion).toBe(2);
      expect(diagVal.prefixes).toEqual(["pof2-", "drsf2-", "gpif2-"]);
      expect(diagVal.cases.length).toBeGreaterThanOrEqual(2);

      for (const c of diagVal.cases) {
        expect(c.totalDecisions).toBeGreaterThan(20);
        expect(c.turnCount).toBeGreaterThan(1);
        expect(c.stageResolutionObserved).toBe(true);
      }
    });

    it("Test 10: Diagnostic OFF vs ON Full Parity - 100% match on outcomes, trace logical sequence, and normalized match logs", () => {
      const diagVal = reportJson.diagnosticValidation;
      expect(diagVal.allCasesParityOk).toBe(true);

      for (const c of diagVal.cases) {
        expect(c.outcomesEqual).toBe(true);
        expect(c.traceParityAllOk).toBe(true);
        expect(c.matchLogParity).toBe(true);
        expect(c.diagVersionOk).toBe(true);
        expect(c.prefixesOk).toBe(true);
        expect(c.overallParity).toBe(true);
      }
    });
  });

  describe("Group 5: Standard + Pack Smoke Analysis (Cohort A vs Cohort B)", () => {
    it("Test 11: Cohort A (maxDecisions = 200) - 4 matches safely reached cap without exceptions", () => {
      const cohortA = reportJson.standardPackSmoke.cohortA_max200;
      expect(cohortA.maxDecisions).toBe(200);
      expect(cohortA.matches.length).toBe(4);
      expect(cohortA.completedMatchesCount).toBe(0);
      expect(cohortA.incompleteMatchesCount).toBe(4);
      expect(cohortA.failedMatchesCount).toBe(0);

      for (const m of cohortA.matches) {
        expect(m.completed).toBe(false);
        expect(m.incomplete).toBe(true);
        expect(m.failed).toBe(false);
        expect(m.totalDecisions).toBe(200);
        expect(m.passProportionPct).toBeGreaterThan(0);
        expect(m.endCount).toBeGreaterThan(0);
      }
    });

    it("Test 12: Cohort B (maxDecisions = 500) - 4 matches completed upon raising decision cap", () => {
      const cohortB = reportJson.standardPackSmoke.cohortB_max500;
      expect(cohortB.maxDecisions).toBe(500);
      expect(cohortB.matches.length).toBe(4);
      expect(cohortB.completedMatchesCount).toBe(4);
      expect(cohortB.incompleteMatchesCount).toBe(0);
      expect(cohortB.failedMatchesCount).toBe(0);

      for (const m of cohortB.matches) {
        expect(m.completed).toBe(true);
        expect(m.incomplete).toBe(false);
        expect(m.failed).toBe(false);
        expect(m.totalDecisions).toBeLessThanOrEqual(500);
        expect(m.passProportionPct).toBeGreaterThan(0);
        expect(m.endCount).toBeGreaterThan(0);
      }
    });

    it("Test 13: Standard+Pack Telemetry Completeness - action distributions, pass ratios, and diagnostic signals present", () => {
      const smoke = reportJson.standardPackSmoke;
      expect(smoke.summary.avgPassProportionPct).toBeGreaterThan(50);
      expect(smoke.summary.avgEndCount).toBeGreaterThan(0);
      expect(smoke.summary.topActionsSummary).toContain("action.attack");
      expect(smoke.summary.topActionsSummary).toContain("action.end");
    });
  });

  describe("Group 6: Historical Comparison & Production Freeze", () => {
    it("Test 14: Historical Comparison Table - accurately contrasts Schema v5 and Schema v6 baselines with cautionary notes", () => {
      const hc = reportJson.historicalComparison;
      expect(hc.v5Baseline.totalWeights).toBe(23452);
      expect(hc.v5Baseline.featureSchemaVersion).toBe(5);
      expect(hc.v6Baseline.totalWeights).toBe(23738);
      expect(hc.v6Baseline.featureSchemaVersion).toBe(6);
      expect(hc.notes.length).toBeGreaterThanOrEqual(3);
    });

    it("Test 15: Historical Evidence Untouched - reports/ai/v92-core-baseline-evidence-v1.json exists with schema 5", () => {
      const histPath = path.resolve(__dirname, "../../../reports/ai/v92-core-baseline-evidence-v1.json");
      expect(fs.existsSync(histPath)).toBe(true);
      const histJson = JSON.parse(fs.readFileSync(histPath, "utf-8"));
      expect(histJson.workId).toBe("BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R2");
      expect(histJson.featureCompatibilityAudit.featureSchemaVersion).toBe(5);
      expect(histJson.featureCompatibilityAudit.totalWeights).toBe(23452);
    });
  });
});
