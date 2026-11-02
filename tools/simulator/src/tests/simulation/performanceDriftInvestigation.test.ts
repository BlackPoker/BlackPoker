import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { DriftInvestigationReport } from "../../cli/performanceDriftInvestigator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

describe("Performance Drift Investigation Verification Gate", () => {
  const reportAPath = path.resolve(
    rootDir,
    "tools/simulator/.artifacts/drift-investigation-A.json"
  );
  const reportBPath = path.resolve(
    rootDir,
    "tools/simulator/.artifacts/drift-investigation-B.json"
  );

  it("Test 1: 条件A・条件Bの調査ベンチマークレポートが存在すること", () => {
    expect(fs.existsSync(reportAPath)).toBe(true);
    expect(fs.existsSync(reportBPath)).toBe(true);
  });

  it("Test 2: 条件A (2,000試合・チェックポイントあり) の集計データが正常であること", () => {
    const reportA: DriftInvestigationReport = JSON.parse(
      fs.readFileSync(reportAPath, "utf-8")
    );

    expect(reportA.workId).toBe("BP-SIM-AI-V92-WORK2-PERFORMANCE-DRIFT-INVESTIGATION");
    expect(reportA.mode).toBe("A");
    expect(reportA.totalMatches).toBe(2000);
    expect(reportA.totalDecisions).toBe(381248);
    expect(reportA.checkpoints.length).toBe(3); // 500, 1000, 1500
    expect(reportA.segments.length).toBe(8); // 250試合 * 8区間

    // チェックポイント直接保存時間は全体の1%未満 (335ms / ~499s)
    const chkRatio = reportA.totalCheckpointDurationMs / reportA.wallClockElapsedMs;
    expect(chkRatio).toBeLessThan(0.01);
  });

  it("Test 3: 条件B (2,000試合・通常チェックポイントなし) の集計データが正常であること", () => {
    const reportB: DriftInvestigationReport = JSON.parse(
      fs.readFileSync(reportBPath, "utf-8")
    );

    expect(reportB.workId).toBe("BP-SIM-AI-V92-WORK2-PERFORMANCE-DRIFT-INVESTIGATION");
    expect(reportB.mode).toBe("B");
    expect(reportB.totalMatches).toBe(2000);
    expect(reportB.totalDecisions).toBe(381248);
    expect(reportB.checkpoints.length).toBe(0);
    expect(reportB.segments.length).toBe(8);

    // 条件Bのスループットが条件Aを上回っていること
    const reportA: DriftInvestigationReport = JSON.parse(
      fs.readFileSync(reportAPath, "utf-8")
    );
    expect(reportB.overallMatchesPerSecond).toBeGreaterThan(reportA.overallMatchesPerSecond);
  });

  it("Test 4: 正しいCPU型番 (Intel Core Ultra 7 155U) が記録されていること", () => {
    const reportA: DriftInvestigationReport = JSON.parse(
      fs.readFileSync(reportAPath, "utf-8")
    );
    expect(reportA.cpuInfo).toContain("Intel(R) Core(TM) Ultra 7 155U");
  });
});
