/**
 * gen9EvidenceIntegrity.test.ts
 *
 * BlackPoker Simulator - Work 5-4B Evidence 真正性・排他保存・原本照合テスト (Work 5-4B R2)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  assertCleanCommitState,
  verifyPastEvidenceIntegrity,
} from "../../../scripts/run_gen9_work54b_evaluation.js";

describe("Gen 9 Evidence 真正性・整合性自動テスト", () => {
  const rootDir = process.cwd();
  const artifactsDir = path.resolve(rootDir, ".artifacts");

  it("1. assertCleanCommitState が未コミット変更のある作業ツリーで DIRTY_WORKTREE_ERROR を送出し、オプション付与時は40桁SHAを取得できること", () => {
    // 現在の作業ツリーは未コミット変更があるため、通常呼び出しでは DIRTY_WORKTREE_ERROR となることを検証
    expect(() => assertCleanCommitState(rootDir)).toThrow(/DIRTY_WORKTREE_ERROR/);

    // テスト用オプション付与時はコミットSHA形式および時刻が取得できることを検証
    const res = assertCleanCommitState(rootDir, { allowDirtyForTesting: true });
    expect(res.gitSha).toMatch(/^[0-9a-f]{40}$/i);
    expect(res.commitTimeIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("2. verifyPastEvidenceIntegrity が各過去ファイルの原本/再生成を正しく分類すること", () => {
    const report = verifyPastEvidenceIntegrity(artifactsDir);

    // 必須過去ファイルがすべて VALID であること
    expect(report["gen9-work5-2-pilot-results.json"]?.valid).toBe(true);
    expect(report["gen9-work5-2-pilot-results.json"]?.classification).toBe("ORIGINAL");

    expect(report["gen9-work5-2-r2-results.json"]?.valid).toBe(true);
    expect(report["gen9-work5-2-r2-results.json"]?.classification).toBe("ORIGINAL");

    expect(report["gen9-work5-3-sensitivity-analysis.json"]?.valid).toBe(true);
    expect(report["gen9-work5-3-sensitivity-analysis.json"]?.classification).toBe("ORIGINAL");

    // Work 5-4A は ORIGINAL (26947...) または REGENERATED (85c78...) のいずれかとして VALID
    const w54a = report["gen9-work5-4a-block-evaluation.json"];
    expect(w54a?.valid).toBe(true);
    expect(["ORIGINAL", "REGENERATED"]).toContain(w54a?.classification);

    // Work 5-4B 旧版および Corrected 版
    expect(report["gen9-work5-4b-pass-evaluation.json"]?.valid).toBe(true);
    expect(report["gen9-work5-4b-pass-evaluation-corrected.json"]?.valid).toBe(true);
  });

  it("3. 未知・改変されたハッシュに対して verifyPastEvidenceIntegrity がエラーを送出すること", () => {
    const tempDir = path.resolve(rootDir, ".artifacts/test-temp-integrity");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      const corruptFile = path.join(tempDir, "gen9-work5-2-pilot-results.json");
      fs.writeFileSync(corruptFile, '{"corrupted": true}', "utf8");

      expect(() => verifyPastEvidenceIntegrity(tempDir)).toThrow(/EVIDENCE_CORRUPTION/);
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("4. 排他的ファイル作成 (flag: wx) により既存ファイルへの上書きが確実に防止されること", () => {
    const tempDir = path.resolve(rootDir, ".artifacts/test-temp-exclusive");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      const targetFile = path.join(tempDir, "test-exclusive.json");
      fs.writeFileSync(targetFile, '{"first": 1}', { encoding: "utf8", flag: "wx" });

      // 同名ファイルを wx フラグで書き込もうとすると EEXIST で失敗すること
      expect(() => {
        fs.writeFileSync(targetFile, '{"second": 2}', { encoding: "utf8", flag: "wx" });
      }).toThrow();

      // 元の内容が改変されていないこと
      const content = fs.readFileSync(targetFile, "utf8");
      expect(JSON.parse(content)).toEqual({ first: 1 });
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});
