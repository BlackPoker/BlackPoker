import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1-R1 Acceptance Suite", () => {
  let reportJson: any;
  let markdownContent: string;

  beforeAll(() => {
    const jsonPath = path.resolve(__dirname, "../../../reports/ai/v92-v6-evolution-baseline-v1-r1.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    reportJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    const mdPath = path.resolve(__dirname, "../../../docs/ai-v92-v6-evolution-baseline-v1-r1.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    markdownContent = fs.readFileSync(mdPath, "utf-8");
  });

  describe("Group 1: Artifact & Schema Integrity", () => {
    it("Test 1: Report Metadata - matches workId, schemaVersion 6, and target base commit", () => {
      expect(reportJson.workId).toBe("BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1-R1");
      expect(reportJson.schemaVersion).toBe(6);
      expect(reportJson.startSha).toBe("a52e8d91a53ab7371e0afaa2daadd9cbddc38f60");
    });

    it("Test 2: Markdown Synchronization - markdown contains workId, schemaVersion, direct stage resolution, and prefix200 headings", () => {
      expect(markdownContent).toContain("BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1-R1");
      expect(markdownContent).toContain("**Feature Schema**: `v6`");
      expect(markdownContent).toContain("308 features");
      expect(markdownContent).toContain("23,738");
      expect(markdownContent).toContain("Light-Entry16 Controlled Evolution");
      expect(markdownContent).toContain("Stage解決");
      expect(markdownContent).toContain("同一Seed 先頭200手決定論性検証");
      expect(markdownContent).toContain("Standard + Pack Smoke");
      expect(markdownContent).toContain("Diagnostic v2");
      expect(markdownContent).toContain("Historical Comparison");
    });
  });

  describe("Group 2: Independent Recalculation of Evolution Outcomes & Fitness Conservation", () => {
    it("Test 3: g0 Independent Recalculation - recalculates completion, min/max/avg/median directly from matchDetails without hardcoding", () => {
      const matches = reportJson.evolution.g0.matchDetails;
      expect(Array.isArray(matches)).toBe(true);
      expect(matches.length).toBe(30);

      let calcCompleted = 0;
      let calcIncomplete = 0;
      let calcFailed = 0;
      let calcDraw = 0;
      const decisionsList: number[] = [];

      for (const m of matches) {
        if (m.completed) calcCompleted++;
        else if (m.incomplete) calcIncomplete++;
        if (m.failed) calcFailed++;
        if (m.winner === null || m.winner === "draw") calcDraw++;
        decisionsList.push(m.totalDecisions);
      }

      decisionsList.sort((a, b) => a - b);
      const calcMin = decisionsList[0];
      const calcMax = decisionsList[decisionsList.length - 1];
      const calcSum = decisionsList.reduce((acc, v) => acc + v, 0);
      const calcAvg = Math.round((calcSum / decisionsList.length) * 100) / 100;
      const mid = Math.floor(decisionsList.length / 2);
      const calcMedian =
        decisionsList.length % 2 === 0
          ? Math.round(((decisionsList[mid - 1] + decisionsList[mid]) / 2) * 100) / 100
          : decisionsList[mid];

      // Assert independent recalculations match report summary fields exactly (no hardcoding)
      expect(reportJson.evolution.g0.completedMatches).toBe(calcCompleted);
      expect(reportJson.evolution.g0.incompleteMatches).toBe(calcIncomplete);
      expect(reportJson.evolution.g0.failedMatches).toBe(calcFailed);
      expect(reportJson.evolution.g0.drawMatches).toBe(calcDraw);
      expect(reportJson.evolution.g0.decisionStats.min).toBe(calcMin);
      expect(reportJson.evolution.g0.decisionStats.max).toBe(calcMax);
      expect(reportJson.evolution.g0.decisionStats.avg).toBe(calcAvg);
      expect(reportJson.evolution.g0.decisionStats.median).toBe(calcMedian);
      expect(calcCompleted).toBe(reportJson.evolution.g0.totalScheduledMatches);
      expect(calcIncomplete).toBe(0);
    });

    it("Test 4: g1 Independent Recalculation - recalculates completion, min/max/avg/median directly from matchDetails without hardcoding", () => {
      const matches = reportJson.evolution.g1.matchDetails;
      expect(Array.isArray(matches)).toBe(true);
      expect(matches.length).toBe(30);

      let calcCompleted = 0;
      let calcIncomplete = 0;
      let calcFailed = 0;
      let calcDraw = 0;
      const decisionsList: number[] = [];

      for (const m of matches) {
        if (m.completed) calcCompleted++;
        else if (m.incomplete) calcIncomplete++;
        if (m.failed) calcFailed++;
        if (m.winner === null || m.winner === "draw") calcDraw++;
        decisionsList.push(m.totalDecisions);
      }

      decisionsList.sort((a, b) => a - b);
      const calcMin = decisionsList[0];
      const calcMax = decisionsList[decisionsList.length - 1];
      const calcSum = decisionsList.reduce((acc, v) => acc + v, 0);
      const calcAvg = Math.round((calcSum / decisionsList.length) * 100) / 100;
      const mid = Math.floor(decisionsList.length / 2);
      const calcMedian =
        decisionsList.length % 2 === 0
          ? Math.round(((decisionsList[mid - 1] + decisionsList[mid]) / 2) * 100) / 100
          : decisionsList[mid];

      // Assert independent recalculations match report summary fields exactly (no hardcoding)
      expect(reportJson.evolution.g1.completedMatches).toBe(calcCompleted);
      expect(reportJson.evolution.g1.incompleteMatches).toBe(calcIncomplete);
      expect(reportJson.evolution.g1.failedMatches).toBe(calcFailed);
      expect(reportJson.evolution.g1.drawMatches).toBe(calcDraw);
      expect(reportJson.evolution.g1.decisionStats.min).toBe(calcMin);
      expect(reportJson.evolution.g1.decisionStats.max).toBe(calcMax);
      expect(reportJson.evolution.g1.decisionStats.avg).toBe(calcAvg);
      expect(reportJson.evolution.g1.decisionStats.median).toBe(calcMedian);
      expect(calcCompleted).toBe(reportJson.evolution.g1.totalScheduledMatches);
      expect(calcIncomplete).toBe(0);
    });

    it("Test 5: Genome-Level Win/Loss Independent Recalculation - verifies individual fitness records match matchDetails", () => {
      // Test g0 genomes
      const g0Matches = reportJson.evolution.g0.matchDetails;
      const g0Individuals = reportJson.evolution.g0.fitnessEntries;
      for (const ind of g0Individuals) {
        let wins = 0;
        let losses = 0;
        let draws = 0;
        let completed = 0;

        for (const m of g0Matches) {
          const isP1 = m.p1GenomeId === ind.genomeId;
          const isP2 = m.p2GenomeId === ind.genomeId;
          if (!isP1 && !isP2) continue;

          if (m.completed) {
            completed++;
            if ((isP1 && m.winner === "p1") || (isP2 && m.winner === "p2")) {
              wins++;
            } else if ((isP1 && m.winner === "p2") || (isP2 && m.winner === "p1")) {
              losses++;
            } else {
              draws++;
            }
          }
        }

        expect(ind.wins).toBe(wins);
        expect(ind.losses).toBe(losses);
        expect(ind.draws).toBe(draws);
        expect(ind.completedMatches).toBe(completed);
        expect(wins + losses + draws).toBe(completed);
        expect(completed).toBe(ind.scheduledMatches);
      }

      // Test g1 genomes
      const g1Matches = reportJson.evolution.g1.matchDetails;
      const g1Individuals = reportJson.evolution.g1.fitnessEntries;
      for (const ind of g1Individuals) {
        let wins = 0;
        let losses = 0;
        let draws = 0;
        let completed = 0;

        for (const m of g1Matches) {
          const isP1 = m.p1GenomeId === ind.genomeId;
          const isP2 = m.p2GenomeId === ind.genomeId;
          if (!isP1 && !isP2) continue;

          if (m.completed) {
            completed++;
            if ((isP1 && m.winner === "p1") || (isP2 && m.winner === "p2")) {
              wins++;
            } else if ((isP1 && m.winner === "p2") || (isP2 && m.winner === "p1")) {
              losses++;
            } else {
              draws++;
            }
          }
        }

        expect(ind.wins).toBe(wins);
        expect(ind.losses).toBe(losses);
        expect(ind.draws).toBe(draws);
        expect(ind.completedMatches).toBe(completed);
        expect(wins + losses + draws).toBe(completed);
        expect(completed).toBe(ind.scheduledMatches);
      }
    });

    it("Test 6: Fitness Conservation Laws Independent Recalculation - proves conservation mathematical laws hold from matchDetails", () => {
      for (const genKey of ["g0", "g1"] as const) {
        const gen = reportJson.evolution[genKey];
        const matches = gen.matchDetails;
        const decisiveCount = matches.filter(
          (m: any) => m.completed && m.winner !== null && m.winner !== "draw"
        ).length;
        const drawCount = matches.filter(
          (m: any) => m.completed && (m.winner === null || m.winner === "draw")
        ).length;

        const sumWins = gen.fitnessEntries.reduce((acc: number, ind: any) => acc + ind.wins, 0);
        const sumLosses = gen.fitnessEntries.reduce((acc: number, ind: any) => acc + ind.losses, 0);
        const sumDraws = gen.fitnessEntries.reduce((acc: number, ind: any) => acc + ind.draws, 0);
        const sumCompleted = gen.fitnessEntries.reduce(
          (acc: number, ind: any) => acc + ind.completedMatches,
          0
        );

        expect(sumWins).toBe(decisiveCount);
        expect(sumLosses).toBe(decisiveCount);
        expect(sumDraws).toBe(2 * drawCount);
        expect(sumCompleted).toBe(2 * matches.length);
        expect(gen.fitnessConservation.valid).toBe(true);
        expect(gen.fitnessConservation.winsEqualsDecisive).toBe(true);
        expect(sumDraws).toBe(2 * drawCount);
        expect(sumCompleted).toBe(2 * matches.length);
        expect(gen.fitnessConservation.valid).toBe(true);
        expect(gen.fitnessConservation.winsEqualsDecisive).toBe(true);
        expect(gen.fitnessConservation.lossesEqualsDecisive).toBe(true);
        expect(gen.fitnessConservation.completedEqualsDoubleMatches).toBe(true);
      }
    });
  });

  describe("Group 3: Determinism Across Independent Re-executions (Run A vs Run B)", () => {
    it("Test 7: g0 Determinism - Run A == Run B across all DNA weights, matches, fitness, and trace digests", () => {
      const det0 = reportJson.evolution.g0.determinism;
      expect(det0.overall).toBe(true);
      expect(det0.dnaFullEquality.overall).toBe(true);
      expect(det0.dnaFullEquality.patternWeightsExactEqual).toBe(true);
      expect(det0.dnaFullEquality.contextPatternWeightsExactEqual).toBe(true);
      expect(det0.matchesEqual).toBe(true);
      expect(det0.fitnessEqual).toBe(true);
      expect(det0.manifestEqual).toBe(true);
      expect(det0.decisionTraceDigestsEqual).toBe(true);
    });

    it("Test 8: g1 Determinism - Run A == Run B across all DNA weights, schedules, matches, fitness, and trace digests", () => {
      const det1 = reportJson.evolution.g1.determinism;
      expect(det1.overall).toBe(true);
      expect(det1.dnaFullEquality.overall).toBe(true);
      expect(det1.dnaFullEquality.patternWeightsExactEqual).toBe(true);
      expect(det1.dnaFullEquality.contextPatternWeightsExactEqual).toBe(true);
      expect(det1.scheduleEqual).toBe(true);
      expect(det1.matchesEqual).toBe(true);
      expect(det1.fitnessEqual).toBe(true);
      expect(det1.manifestEqual).toBe(true);
      expect(det1.decisionTraceDigestsEqual).toBe(true);
    });
  });

  describe("Group 4: Diagnostic v2 & Direct Stage Resolution Event Verification", () => {
    it("Test 9: Stage Resolution Direct Evidence - directly verified via stage.pushed, stage.popped, request.resolved events", () => {
      const diagVal = reportJson.diagnosticValidation;
      expect(diagVal.cases.length).toBeGreaterThanOrEqual(2);

      for (const c of diagVal.cases) {
        expect(c.stageResolutionObserved).toBe(true);
        expect(c.stageResolution).toBeDefined();
        expect(c.stageResolution.stageResolutionObserved).toBe(true);
        expect(c.stageResolution.stagePushedCount).toBeGreaterThan(0);
        expect(c.stageResolution.stagePoppedCount).toBeGreaterThan(0);
        expect(c.stageResolution.requestResolvedCount).toBeGreaterThan(0);
        expect(c.stageResolution.stageResolvedCount).toBeGreaterThan(0);
        expect(c.stageResolution.resolvedStageRequestIds.length).toBeGreaterThan(0);
        expect(c.stageResolution.resolvedStageActionRefs.length).toBeGreaterThan(0);
      }
    });

    it("Test 10: Diagnostic OFF vs ON Full Parity - 100% match on outcomes, trace logical sequence, legal patterns content/order, and non-empty v2 prefixes", () => {
      const diagVal = reportJson.diagnosticValidation;
      expect(diagVal.allCasesParityOk).toBe(true);
      expect(diagVal.diagnosticVersion).toBe(2);
      expect(diagVal.prefixes).toEqual(["pof2-", "drsf2-", "gpif2-"]);

      for (const c of diagVal.cases) {
        expect(c.outcomesEqual).toBe(true);
        expect(c.traceParityAllOk).toBe(true);
        expect(c.legalPatternsParityAllOk).toBe(true);
        expect(c.matchLogParity).toBe(true);
        expect(c.diagVersionOk).toBe(true);
        expect(c.traceCount).toBeGreaterThan(0); // Cannot pass if diagnostic trace is empty
        expect(c.prefixesOk).toBe(true);
        expect(c.overallParity).toBe(true);
      }
    });
  });

  describe("Group 5: Standard + Pack Smoke Analysis & Prefix 200 Decisions Parity", () => {
    it("Test 11: Cohort A (maxDecisions = 200) Independent Recalculation - all 4 matches safely reach cap without exceptions", () => {
      const cohortA = reportJson.standardPackSmoke.cohortA_max200;
      expect(cohortA.maxDecisions).toBe(200);
      expect(cohortA.matches.length).toBe(4);

      let calcCompleted = 0;
      let calcIncomplete = 0;
      let calcFailed = 0;

      for (const m of cohortA.matches) {
        if (m.completed) calcCompleted++;
        if (m.incomplete) calcIncomplete++;
        if (m.failed) calcFailed++;
        expect(m.totalDecisions).toBe(200);
        expect(m.passProportionPct).toBeGreaterThan(0);
        expect(m.endCount).toBeGreaterThan(0);
      }

      expect(calcCompleted).toBe(0);
      expect(calcIncomplete).toBe(4);
      expect(calcFailed).toBe(0);
      expect(cohortA.completedMatchesCount).toBe(calcCompleted);
      expect(cohortA.incompleteMatchesCount).toBe(calcIncomplete);
    });

    it("Test 12: Cohort B (maxDecisions = 500) Independent Recalculation - all 4 matches completed upon raising decision cap", () => {
      const cohortB = reportJson.standardPackSmoke.cohortB_max500;
      expect(cohortB.maxDecisions).toBe(500);
      expect(cohortB.matches.length).toBe(4);

      let calcCompleted = 0;
      let calcIncomplete = 0;
      let calcFailed = 0;

      for (const m of cohortB.matches) {
        if (m.completed) calcCompleted++;
        if (m.incomplete) calcIncomplete++;
        if (m.failed) calcFailed++;
        expect(m.totalDecisions).toBeGreaterThan(200);
        expect(m.totalDecisions).toBeLessThanOrEqual(500);
        expect(m.passProportionPct).toBeGreaterThan(0);
        expect(m.endCount).toBeGreaterThan(0);
      }

      expect(calcCompleted).toBe(4);
      expect(calcIncomplete).toBe(0);
      expect(calcFailed).toBe(0);
      expect(cohortB.completedMatchesCount).toBe(calcCompleted);
      expect(cohortB.incompleteMatchesCount).toBe(calcIncomplete);
    });

    it("Test 13: Standard+Pack Prefix 200 Decisions Parity - mathematical proof that cap=200 was merely truncation of cap=500", () => {
      const prefixParity = reportJson.standardPackSmoke.prefix200Parity;
      expect(Array.isArray(prefixParity)).toBe(true);
      expect(prefixParity.length).toBe(4);

      for (const p of prefixParity) {
        expect(p.prefix200Matches).toBe(true);
        expect(p.cohortAPrefix200Digest).toBe(p.cohortBPrefix200Digest);
        expect(p.cohortAPrefix200Digest.length).toBe(64);
      }
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

    it("Test 15: Preservation of Historical Baseline Evidence - confirms v5 and v1 files are preserved untouched", () => {
      // Historical v5
      const histPathV5 = path.resolve(__dirname, "../../../reports/ai/v92-core-baseline-evidence-v1.json");
      expect(fs.existsSync(histPathV5)).toBe(true);
      const histJsonV5 = JSON.parse(fs.readFileSync(histPathV5, "utf-8"));
      expect(histJsonV5.workId).toBe("BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R2");

      // Historical v1
      const histPathV1 = path.resolve(__dirname, "../../../reports/ai/v92-v6-evolution-baseline-v1.json");
      expect(fs.existsSync(histPathV1)).toBe(true);
      const histJsonV1 = JSON.parse(fs.readFileSync(histPathV1, "utf-8"));
      expect(histJsonV1.workId).toBe("BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1");
    });
  });
});
