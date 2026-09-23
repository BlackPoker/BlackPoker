import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Scenario Phase Keyword Audit (BP-SIM-SCENARIO-1.0-FOUNDATION)", () => {
  const scenarioFiles = [
    "src/domain/scenario/ScenarioTypes.ts",
    "src/engine/scenario/ScenarioCompiler.ts",
    "src/ui/scenario/ScenarioShareUrl.ts",
    "src/ui/scenario/ScenarioBuilderModal.tsx",
    "src/ui/playtest/CoreBattlePlaytest.tsx",
    "src/ui/playtest/PlaytestDiagnosticBundle.ts",
    "src/engine/session/playtest/validatePlaytestPreset.ts",
    "src/engine/session/playtest/createCoreBattlePlaytest.ts",
  ];

  it("Scenario Builder の新設ファイルにゲームドメイン・State 上の Phase 概念が存在しないこと", () => {
    // Prohibited keywords representing game flow phases
    const prohibitedPatterns = [
      /\bphase\b/i,
      /\bturnPhase\b/i,
      /\bcurrentPhase\b/i,
      /\bmainPhase\b/i,
      /\battackPhase\b/i,
      /\bdrawPhase\b/i,
      /\bphaseId\b/i,
      /フェーズ/,
    ];

    for (const relPath of scenarioFiles) {
      const fullPath = path.resolve(__dirname, "../../..", relPath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        // Allow explicit defensive checks and comments that mention Phase rejection
        if (
          line.includes("Phase は存在しません") ||
          line.includes("Phase 禁止") ||
          line.includes("Phase フィールド") ||
          line.includes('path: "phase"') ||
          line.includes(".phase !== undefined") ||
          line.includes(".turnPhase !== undefined") ||
          line.includes(".currentPhase !== undefined") ||
          line.includes("Phase や Stage などの不正フィールド検出") ||
          line.includes("「Phase」概念を一切含まず")
        ) {
          continue;
        }

        for (const pattern of prohibitedPatterns) {
          const match = line.match(pattern);
          if (match) {
            throw new Error(
              `Prohibited phase keyword "${match[0]}" found in ${relPath} line ${lineIdx + 1}: ${line.trim()}`
            );
          }
        }
      }
    }
  });
});
