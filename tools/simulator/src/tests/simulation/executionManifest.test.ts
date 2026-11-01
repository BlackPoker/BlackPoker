import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  createExecutionManifest,
  assertNotDirty,
  canonicalJsonStringify,
  computeExperimentFingerprint,
  parsePorcelainLine,
  computeDirectoryContentDigest,
  saveOfficialEvidenceWithManifest,
  ExecutionManifestDirtyStateError,
  ExecutionManifestUnverifiedGitStateError,
  ExecutionManifestMissingSubsystemError,
  ExecutionManifest,
} from "../../engine/simulation/ExecutionManifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

describe("ExecutionManifest", () => {
  const dummyExperimentConfig = {
    regulationId: "standard-pack",
    rulePackageId: "standard-rule",
    rulePackageVersion: "1.0.0",
    rulePackageDigest: "abc123digest",
    campaignSeed: 20261031,
    randomGenerator: "DeterministicShuffle (deriveSeed)",
    decisionTraceVersion: 2,
    models: [
      {
        modelId: "candidate",
        genomeId: "genome-sp-g0-004",
        fullDnaDigest: "8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa",
      },
    ],
    playerPolicies: [
      {
        seat: "p1" as const,
        descriptor: { kind: "genome", policyVersion: 1, name: "GenomePolicy" },
      },
      {
        seat: "p2" as const,
        descriptor: { kind: "firstLegal", policyVersion: 1, name: "FirstLegalPolicy", metadata: { preferPass: false } },
        constructorSettings: { preferPass: false },
      },
    ],
  };

  it("Test 1: 完全な ExecutionManifest を生成し全必須フィールドが存在すること", () => {
    const manifest = createExecutionManifest({
      workId: "TEST-WORK-ID",
      rootDir,
      experimentConfig: dummyExperimentConfig,
    });

    expect(manifest.schemaVersion).toBe("1.0.0");
    expect(manifest.workId).toBe("TEST-WORK-ID");
    expect(manifest.generatedAt).toBeDefined();
    expect(manifest.environment.nodeVersion).toBe(process.version);
    expect(manifest.gitMetadata.headCommitSha).toBeDefined();
    expect(manifest.gitMetadata.verificationStatus).toMatch(/^(VERIFIED|FAILED|ENV_OVERRIDE)$/);
    expect(manifest.subsystemDigests.rules).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.simulation).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.ai).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.regulations).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.rulesPackage).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.dependencies).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.experimentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Test 2: parsePorcelainLine が空白やリネームパスを正確にパースすること", () => {
    expect(parsePorcelainLine(" M tools/simulator/file.ts")).toBe("tools/simulator/file.ts");
    expect(parsePorcelainLine("M  tools/simulator/staged.ts")).toBe("tools/simulator/staged.ts");
    expect(parsePorcelainLine("?? tools/simulator/untracked.ts")).toBe("tools/simulator/untracked.ts");
    expect(parsePorcelainLine("R  old/path.ts -> new/path.ts")).toBe("new/path.ts");
    expect(parsePorcelainLine("")).toBeNull();
    expect(parsePorcelainLine("   ")).toBeNull();
  });

  it("Test 3: canonicalJsonStringify がオブジェクトのキー順序に依存せず決定論的な文字列を返すこと", () => {
    const objA = { b: 2, a: 1, nested: { y: 20, x: 10 } };
    const objB = { a: 1, nested: { x: 10, y: 20 }, b: 2 };

    const strA = canonicalJsonStringify(objA);
    const strB = canonicalJsonStringify(objB);

    expect(strA).toBe(strB);
    expect(strA).toBe('{"a":1,"b":2,"nested":{"x":10,"y":20}}');
  });

  it("Test 4: experimentFingerprint が実行日時の影響を受けず安定して同一であること", () => {
    const manifest1 = createExecutionManifest({
      workId: "TEST-WORK-ID",
      rootDir,
      experimentConfig: dummyExperimentConfig,
    });

    const manifest2 = createExecutionManifest({
      workId: "TEST-WORK-ID",
      rootDir,
      experimentConfig: dummyExperimentConfig,
    });

    expect(manifest1.experimentFingerprint).toBe(manifest2.experimentFingerprint);
  });

  it("Test 5: assertNotDirty が clean かつ VERIFIED な状態では例外を投げず通過すること", () => {
    const cleanManifest: ExecutionManifest = {
      schemaVersion: "1.0.0",
      workId: "TEST",
      generatedAt: new Date().toISOString(),
      environment: { nodeVersion: "v20.0.0", platform: "linux", arch: "x64" },
      gitMetadata: {
        headCommitSha: "19a6ce4ac6b37b01c6dc90de3b4e38f95297f771",
        branch: "main",
        isDirty: false,
        dirtyFiles: [],
        verificationStatus: "VERIFIED",
      },
      subsystemDigests: {
        rules: "hash1",
        simulation: "hash2",
        ai: "hash3",
        regulations: "hash4",
        rulesPackage: "hash5",
        dependencies: "hash6",
      },
      experimentConfig: dummyExperimentConfig,
      experimentFingerprint: "fingerprint123",
      manifestHash: "manifesthash123",
    };

    expect(() => assertNotDirty(cleanManifest)).not.toThrow();
  });

  it("Test 6: assertNotDirty が dirty な状態では厳格に ExecutionManifestDirtyStateError を投げること", () => {
    const dirtyManifest: ExecutionManifest = {
      schemaVersion: "1.0.0",
      workId: "TEST",
      generatedAt: new Date().toISOString(),
      environment: { nodeVersion: "v20.0.0", platform: "linux", arch: "x64" },
      gitMetadata: {
        headCommitSha: "19a6ce4ac6b37b01c6dc90de3b4e38f95297f771",
        branch: "main",
        isDirty: true,
        dirtyFiles: ["tools/simulator/src/engine/rules/graveCardUtils.ts"],
        verificationStatus: "VERIFIED",
      },
      subsystemDigests: {
        rules: "hash1",
        simulation: "hash2",
        ai: "hash3",
        regulations: "hash4",
        rulesPackage: "hash5",
        dependencies: "hash6",
      },
      experimentConfig: dummyExperimentConfig,
      experimentFingerprint: "fingerprint123",
      manifestHash: "manifesthash123",
    };

    expect(() => assertNotDirty(dirtyManifest)).toThrow(ExecutionManifestDirtyStateError);
  });

  it("Test 7: assertNotDirty が Git 検証失敗 (verificationStatus=FAILED) の場合に ExecutionManifestUnverifiedGitStateError を投げること (fail-closed)", () => {
    const unverifiedManifest: ExecutionManifest = {
      schemaVersion: "1.0.0",
      workId: "TEST",
      generatedAt: new Date().toISOString(),
      environment: { nodeVersion: "v20.0.0", platform: "linux", arch: "x64" },
      gitMetadata: {
        headCommitSha: "UNVERIFIED_MISSING_GIT_SHA",
        branch: "unknown",
        isDirty: true,
        dirtyFiles: ["GIT_STATUS_COMMAND_FAILED"],
        verificationStatus: "FAILED",
      },
      subsystemDigests: {
        rules: "hash1",
        simulation: "hash2",
        ai: "hash3",
        regulations: "hash4",
        rulesPackage: "hash5",
        dependencies: "hash6",
      },
      experimentConfig: dummyExperimentConfig,
      experimentFingerprint: "fingerprint123",
      manifestHash: "manifesthash123",
    };

    expect(() => assertNotDirty(unverifiedManifest)).toThrow(ExecutionManifestUnverifiedGitStateError);
  });

  it("Test 8: assertNotDirty が ENV_OVERRIDE の場合も正式保存を拒否すること (VERIFIED のみ許可)", () => {
    const envOverrideManifest: ExecutionManifest = {
      schemaVersion: "1.0.0",
      workId: "TEST",
      generatedAt: new Date().toISOString(),
      environment: { nodeVersion: "v20.0.0", platform: "linux", arch: "x64" },
      gitMetadata: {
        headCommitSha: "19a6ce4ac6b37b01c6dc90de3b4e38f95297f771",
        branch: "env-override",
        isDirty: false,
        dirtyFiles: [],
        verificationStatus: "ENV_OVERRIDE", // 環境変数のみでGit status未検証
      },
      subsystemDigests: {
        rules: "hash1",
        simulation: "hash2",
        ai: "hash3",
        regulations: "hash4",
        rulesPackage: "hash5",
        dependencies: "hash6",
      },
      experimentConfig: dummyExperimentConfig,
      experimentFingerprint: "fingerprint123",
      manifestHash: "manifesthash123",
    };

    expect(() => assertNotDirty(envOverrideManifest)).toThrow(ExecutionManifestUnverifiedGitStateError);
    expect(() => assertNotDirty(envOverrideManifest)).toThrow(/VERIFIED/);
  });

  it("Test 9: computeDirectoryContentDigest で必須サブシステムが欠落した場合に例外を投げること (fail-closed)", () => {
    const nonExistentPath = path.resolve(rootDir, "tools/simulator/non-existent-subsystem-dir");
    expect(() => computeDirectoryContentDigest(nonExistentPath, true)).toThrow(
      ExecutionManifestMissingSubsystemError
    );
  });

  it("Test 10: saveOfficialEvidenceWithManifest が検証スキップ不可で常に assertNotDirty を強制すること", () => {
    const tmpEvidencePath = path.resolve(rootDir, "tools/simulator/reports/ai/tmp-test-evidence.json");

    const cleanManifest: ExecutionManifest = {
      schemaVersion: "1.0.0",
      workId: "TEST-CLEAN",
      generatedAt: new Date().toISOString(),
      environment: { nodeVersion: "v20.0.0", platform: "linux", arch: "x64" },
      gitMetadata: {
        headCommitSha: "19a6ce4ac6b37b01c6dc90de3b4e38f95297f771",
        branch: "main",
        isDirty: false,
        dirtyFiles: [],
        verificationStatus: "VERIFIED",
      },
      subsystemDigests: {
        rules: "hash1",
        simulation: "hash2",
        ai: "hash3",
        regulations: "hash4",
        rulesPackage: "hash5",
        dependencies: "hash6",
      },
      experimentConfig: dummyExperimentConfig,
      experimentFingerprint: "fp-clean",
      manifestHash: "mh-clean",
    };

    const dirtyManifest: ExecutionManifest = {
      ...cleanManifest,
      gitMetadata: {
        ...cleanManifest.gitMetadata,
        isDirty: true,
        dirtyFiles: ["dirty-file.ts"],
      },
    };

    // dirty 時は保存拒否
    expect(() =>
      saveOfficialEvidenceWithManifest({
        filePath: tmpEvidencePath,
        evidenceData: { testData: 123 },
        manifest: dirtyManifest,
      })
    ).toThrow(ExecutionManifestDirtyStateError);

    // clean かつ VERIFIED 時は保存成功
    expect(() =>
      saveOfficialEvidenceWithManifest({
        filePath: tmpEvidencePath,
        evidenceData: { testData: 123 },
        manifest: cleanManifest,
        options: { writeSeparateManifestFile: true },
      })
    ).not.toThrow();

    // ファイル内容の検証
    expect(fs.existsSync(tmpEvidencePath)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(tmpEvidencePath, "utf-8"));
    expect(loaded.testData).toBe(123);
    expect(loaded.executionManifest.manifestHash).toBe("mh-clean");

    const manifestFilePath = `${tmpEvidencePath}.manifest.json`;
    expect(fs.existsSync(manifestFilePath)).toBe(true);

    // クリーンアップ
    fs.unlinkSync(tmpEvidencePath);
    fs.unlinkSync(manifestFilePath);
  });
});
