import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { DriftInvestigationReport } from "../../cli/performanceDriftInvestigator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

// 独立レビューで承認された A/B 実測データの期待 SHA-256 (改ざん・破損防止)
const EXPECTED_HASH_A = "31d9cc71636a897877c66780f4d334e746cdc6647997da6a7c61d5c1b1f2edc0";
const EXPECTED_HASH_B = "4864364b5977fc0ca29f4b180f244c0dcc31c0b5d697840a0e30a0270d7f4a25";

describe("Performance Drift Investigation Verification Gate", () => {
  const reportAPath = path.resolve(
    rootDir,
    "tools/simulator/reports/ai/drift-investigation-A.json"
  );
  const reportBPath = path.resolve(
    rootDir,
    "tools/simulator/reports/ai/drift-investigation-B.json"
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

  it("Test 4: 実行環境のCPU情報が記録されていること (ハードウェア依存しない検証)", () => {
    const reportA: DriftInvestigationReport = JSON.parse(
      fs.readFileSync(reportAPath, "utf-8")
    );
    expect(typeof reportA.cpuInfo).toBe("string");
    expect(reportA.cpuInfo.length).toBeGreaterThan(0);

    const reportB: DriftInvestigationReport = JSON.parse(
      fs.readFileSync(reportBPath, "utf-8")
    );
    expect(typeof reportB.cpuInfo).toBe("string");
    expect(reportB.cpuInfo.length).toBeGreaterThan(0);
  });

  it("Test 5: A/B 実測データが保護されており SHA-256 が改ざん・破損なく一致すること", () => {
    const bufA = fs.readFileSync(reportAPath);
    const hashA = crypto.createHash("sha256").update(bufA).digest("hex");
    expect(hashA).toBe(EXPECTED_HASH_A);

    const bufB = fs.readFileSync(reportBPath);
    const hashB = crypto.createHash("sha256").update(bufB).digest("hex");
    expect(hashB).toBe(EXPECTED_HASH_B);
  });
});
