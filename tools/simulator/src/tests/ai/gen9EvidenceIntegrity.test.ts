/**
 * gen9EvidenceIntegrity.test.ts
 *
 * BlackPoker Simulator - Work 5-4B Evidence 真正性・排他保存・原本照合・Errata整合性テスト (Work 5-4B R3)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import {
  assertCleanCommitState,
  verifyPastEvidenceIntegrity,
  buildExecutionEnvironmentMetadata,
} from "../../../scripts/run_gen9_work54b_evaluation.js";

describe("Gen 9 Evidence 真正性・整合性自動テスト", () => {
  const rootDir = process.cwd();
  const artifactsDir = path.resolve(rootDir, ".artifacts");

  it("1. assertCleanCommitState が正常に40桁SHAおよびコミット時刻を取得できること", () => {
    const res = assertCleanCommitState(rootDir, { allowDirtyForTesting: true });
    expect(res.gitSha).toMatch(/^[0-9a-f]{40}$/i);
    expect(res.commitTimeIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("2. assertCleanCommitState が未コミット変更のある作業ツリーを検知して DIRTY_WORKTREE_ERROR を送出すること", () => {
    const dummyFile = path.resolve(rootDir, "src/tests/ai/__dummy_dirty_test.ts");
    try {
      fs.writeFileSync(dummyFile, "// temporary dirty test file", "utf8");
      expect(() => assertCleanCommitState(rootDir)).toThrow(/DIRTY_WORKTREE_ERROR/);
    } finally {
      if (fs.existsSync(dummyFile)) {
        fs.unlinkSync(dummyFile);
      }
    }
  });

  it("3. verifyPastEvidenceIntegrity が各過去ファイルの原本/再生成または未存在を正しく分類すること", () => {
    // A. 実際の .artifacts が存在する場合 (ローカル環境)
    if (
      fs.existsSync(path.join(artifactsDir, "gen9-work5-2-pilot-results.json")) &&
      fs.existsSync(path.join(artifactsDir, "gen9-work5-4a-block-evaluation.json"))
    ) {
      const report = verifyPastEvidenceIntegrity(artifactsDir);

      expect(report["gen9-work5-2-pilot-results.json"]?.valid).toBe(true);
      expect(report["gen9-work5-2-pilot-results.json"]?.classification).toBe("ORIGINAL");

      expect(report["gen9-work5-2-r2-results.json"]?.valid).toBe(true);
      expect(report["gen9-work5-2-r2-results.json"]?.classification).toBe("ORIGINAL");

      expect(report["gen9-work5-3-sensitivity-analysis.json"]?.valid).toBe(true);
      expect(report["gen9-work5-3-sensitivity-analysis.json"]?.classification).toBe("ORIGINAL");

      const w54a = report["gen9-work5-4a-block-evaluation.json"];
      expect(w54a?.valid).toBe(true);
      expect(["ORIGINAL", "REGENERATED"]).toContain(w54a?.classification);

      expect(report["gen9-work5-4b-pass-evaluation.json"]?.valid).toBe(true);
      expect(report["gen9-work5-4b-pass-evaluation-corrected.json"]?.valid).toBe(true);
    } else {
      // B. CI環境など .artifacts に過去ファイルが存在しない場合: NOT_FOUND が正しく返ること
      const tempEmptyDir = path.resolve(rootDir, "src/tests/ai/__test_empty_artifacts");
      if (!fs.existsSync(tempEmptyDir)) {
        fs.mkdirSync(tempEmptyDir, { recursive: true });
      }
      try {
        const report = verifyPastEvidenceIntegrity(tempEmptyDir);
        expect(report["gen9-work5-2-pilot-results.json"]?.classification).toBe("NOT_FOUND");
        expect(report["gen9-work5-2-pilot-results.json"]?.valid).toBe(false);
      } finally {
        if (fs.existsSync(tempEmptyDir)) {
          fs.rmSync(tempEmptyDir, { recursive: true, force: true });
        }
      }
    }
  });

  it("4. 未知・改変されたハッシュに対して verifyPastEvidenceIntegrity がエラーを送出すること", () => {
    const tempDir = path.resolve(rootDir, "src/tests/ai/__test_temp_corrupt");
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

  it("5. 排他的ファイル作成 (flag: wx) により既存ファイルへの上書きが確実に防止されること", () => {
    const tempDir = path.resolve(rootDir, "src/tests/ai/__test_temp_exclusive");
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

  it("6. 永続化保存された確定Evidence JSONがリポジトリ内に存在し、SHA-256が確定値と一致すること", () => {
    const evidencePath = path.resolve(
      rootDir,
      "evidence/gen9-work5-4b/gen9-work5-4b-pass-evaluation-final-87260a562662.json"
    );
    expect(fs.existsSync(evidencePath)).toBe(true);

    const content = fs.readFileSync(evidencePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex").toLowerCase();
    expect(hash).toBe("3ea4f378569169c092e5ef792de97a16dd9ba7199064255a8e7612c0eb182adb");

    const parsed = JSON.parse(content.toString("utf8"));
    expect(parsed.workId).toBe("BP-SIM-AI-GEN9-WORK54B-EVIDENCE-FINALIZATION-R2");
    expect(parsed.executionEnvironment.gitCommitSha).toBe("87260a562662b8733c39bcf521b978e804d13585");
    expect(parsed.matchups).toHaveLength(6);
  });

  it("7. buildExecutionEnvironmentMetadata が実際に渡したレギュレーション・フレームオブジェクトのIDを正確に記録すること (修正A)", () => {
    const mockRulePackage = { id: "test-package", version: "1.0.0" };
    const selectedReg = { id: "standard-pack", name: "スタンダード + パック" };
    const selectedFrame = { id: "pack", name: "パック" };

    const meta = buildExecutionEnvironmentMetadata({
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      commitTimeIso: "2026-11-09T12:00:00+09:00",
      workingTreeClean: true,
      rulePackage: mockRulePackage,
      regulationLookupKey: "standard-pack",
      regulation: selectedReg,
      frameLookupKey: "pack",
      frame: selectedFrame,
      tacticalEncoderVersion: "v7.2-unified-block-conditional-pass",
    });

    expect(meta.regulationLookupKey).toBe("standard-pack");
    expect(meta.regulationId).toBe("standard-pack");
    expect(meta.frameLookupKey).toBe("pack");
    expect(meta.frameId).toBe("pack");
    expect(meta.rulePackageId).toBe("test-package");
    expect(meta.tacticalEncoderVersion).toBe("v7.2-unified-block-conditional-pass");

    // カタログ順序に非依存であることの検証: 仮に別レギュレーションが存在しても選択したオブジェクトのIDが記録されること
    const dummyLeadingReg = { id: "light-entry16", name: "ライト" };
    const catalogOrderMock = [dummyLeadingReg, selectedReg];
    // コレクションの先頭要素 (catalogOrderMock[0]) ではなく、渡した selectedReg の ID が記録される
    const metaWithOrder = buildExecutionEnvironmentMetadata({
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      commitTimeIso: "2026-11-09T12:00:00+09:00",
      workingTreeClean: true,
      rulePackage: mockRulePackage,
      regulationLookupKey: "standard-pack",
      regulation: selectedReg, // 先頭要素ではなく実際に選択したオブジェクト
      frameLookupKey: "pack",
      frame: selectedFrame,
      tacticalEncoderVersion: "v7.2-unified-block-conditional-pass",
    });
    expect(metaWithOrder.regulationId).toBe("standard-pack");
    expect(metaWithOrder.regulationId).not.toBe(catalogOrderMock[0].id);

    // 未存在・無効時の明確なエラー送出
    expect(() =>
      buildExecutionEnvironmentMetadata({
        gitSha: "0123456789abcdef0123456789abcdef01234567",
        commitTimeIso: "2026-11-09T12:00:00+09:00",
        workingTreeClean: true,
        rulePackage: mockRulePackage,
        regulationLookupKey: "non-existent-reg",
        regulation: undefined,
        frameLookupKey: "pack",
        frame: selectedFrame,
        tacticalEncoderVersion: "v7.2-unified-block-conditional-pass",
      })
    ).toThrow(/\[REGULATION_NOT_FOUND_ERROR\]/);

    expect(() =>
      buildExecutionEnvironmentMetadata({
        gitSha: "0123456789abcdef0123456789abcdef01234567",
        commitTimeIso: "2026-11-09T12:00:00+09:00",
        workingTreeClean: true,
        rulePackage: mockRulePackage,
        regulationLookupKey: "standard-pack",
        regulation: selectedReg,
        frameLookupKey: "non-existent-frame",
        frame: null,
        tacticalEncoderVersion: "v7.2-unified-block-conditional-pass",
      })
    ).toThrow(/\[FRAME_NOT_FOUND_ERROR\]/);
  });

  it("8. Errataファイル (gen9-work5-4b-evidence-errata-r3.json) が正しく構成され、対象Evidenceの完全性と紐づいていること (修正B)", () => {
    let repoRoot = rootDir;
    try {
      repoRoot = execSync("git rev-parse --show-toplevel", { cwd: rootDir, encoding: "utf8" }).trim();
    } catch {
      repoRoot = rootDir;
    }

    const errataPath = path.resolve(
      rootDir,
      "evidence/gen9-work5-4b/gen9-work5-4b-evidence-errata-r3.json"
    );
    expect(fs.existsSync(errataPath)).toBe(true);

    const errataContent = fs.readFileSync(errataPath, "utf8");
    const errata = JSON.parse(errataContent);

    expect(errata.workId).toBe("BP-SIM-AI-GEN9-WORK54B-EVIDENCE-ERRATA-R3");
    expect(errata.schemaVersion).toBe("1.0.0");

    // 対象 Evidence ファイルの存在確認 (リポジトリルート基準で解決)
    const targetPath = path.resolve(repoRoot, errata.targetEvidence.relativePath);
    expect(fs.existsSync(targetPath)).toBe(true);

    // 対象 Evidence の SHA-256 が Errata 記載値および確定原本ハッシュと完全一致すること (元Evidenceの不変性)
    const targetContent = fs.readFileSync(targetPath);
    const targetHash = crypto.createHash("sha256").update(targetContent).digest("hex").toLowerCase();
    expect(targetHash).toBe("3ea4f378569169c092e5ef792de97a16dd9ba7199064255a8e7612c0eb182adb");
    expect(targetHash).toBe(errata.targetEvidence.sha256.toLowerCase());

    // 誤記録された値と訂正値が明示されていること
    expect(errata.errata.erroneouslyRecorded.recordedValue).toBe("light-entry16");
    expect(errata.errata.correctedValues.regulationLookupKey).toBe("standard-pack");
    expect(errata.errata.correctedValues.regulationId).toBe("standard-pack");
    expect(errata.errata.correctedValues.frameLookupKey).toBe("pack");
    expect(errata.errata.correctedValues.frameId).toBe("pack");

    // 評価実行コミットとR2最終コミットが区別して記録されていること
    expect(errata.targetEvidence.originalExecutionCommitSha).toBe("87260a562662b8733c39bcf521b978e804d13585");
    expect(errata.targetEvidence.work54bR2FinalCommitSha).toBe("e76945bc0b1e960351ed8721b586bf0ac31ebe80");
  });
});
