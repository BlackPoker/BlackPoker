import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import {
  createExecutionManifest,
  assertNotDirty,
  canonicalJsonStringify,
  computeExperimentFingerprint,
  ExecutionManifestDirtyStateError,
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
    expect(manifest.gitMetadata.headCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.subsystemDigests.rules).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.simulation).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.ai).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.regulations).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.rulesPackage).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.subsystemDigests.dependencies).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.experimentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Test 2: canonicalJsonStringify がオブジェクトのキー順序に依存せず決定論的な文字列を返すこと", () => {
    const objA = { b: 2, a: 1, nested: { y: 20, x: 10 } };
    const objB = { a: 1, nested: { x: 10, y: 20 }, b: 2 };

    const strA = canonicalJsonStringify(objA);
    const strB = canonicalJsonStringify(objB);

    expect(strA).toBe(strB);
    expect(strA).toBe('{"a":1,"b":2,"nested":{"x":10,"y":20}}');
  });

  it("Test 3: experimentFingerprint が実行日時の影響を受けず安定して同一であること", () => {
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

    // 実行日時は異なる
    expect(manifest1.generatedAt).toBeDefined();
    expect(manifest2.generatedAt).toBeDefined();

    // しかし experimentFingerprint は静的コード・設定のみに依存するため完全一致する
    expect(manifest1.experimentFingerprint).toBe(manifest2.experimentFingerprint);
  });

  it("Test 4: assertNotDirty が clean な状態では例外を投げず通過すること", () => {
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

  it("Test 5: assertNotDirty が dirty な状態では厳格に ExecutionManifestDirtyStateError を投げること", () => {
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
    try {
      assertNotDirty(dirtyManifest);
    } catch (err: any) {
      expect(err).toBeInstanceOf(ExecutionManifestDirtyStateError);
      expect(err.dirtyFiles).toContain("tools/simulator/src/engine/rules/graveCardUtils.ts");
    }
  });
});
