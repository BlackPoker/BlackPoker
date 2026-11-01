import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { DecisionTraceRecord } from "./SimulationRunner.js";
import { PolicyDescriptor } from "./DecisionPolicy.js";

/**
 * 実験実行時の Git および未コミット状態のメタデータ
 */
export interface GitExecutionMetadata {
  readonly headCommitSha: string;
  readonly branch: string;
  readonly isDirty: boolean;
  readonly dirtyFiles: readonly string[];
}

/**
 * 各サブシステムの実コンテンツ（ファイル内容）から計算された合成 Digest
 */
export interface SubsystemContentDigests {
  readonly rules: string;
  readonly simulation: string;
  readonly ai: string;
  readonly regulations: string;
  readonly rulesPackage: string;
  readonly dependencies: string; // package.json & package-lock.json
}

/**
 * 実験対象モデルのメタデータ
 */
export interface ModelManifestEntry {
  readonly modelId: string;
  readonly genomeId: string;
  readonly fullDnaDigest: string;
  readonly provenance?: string;
}

/**
 * プレイヤー Policy 設定
 */
export interface PlayerPolicyManifestEntry {
  readonly seat: "p1" | "p2";
  readonly descriptor: PolicyDescriptor;
  readonly constructorSettings?: Record<string, any>;
}

/**
 * 実験構成パラメータ
 */
export interface ExperimentConfigManifest {
  readonly regulationId: string;
  readonly rulePackageId: string;
  readonly rulePackageVersion: string;
  readonly rulePackageDigest: string;
  readonly campaignSeed: number;
  readonly randomGenerator: string; // 例: "DeterministicShuffle (splitmix32 / Mulberry32 / deriveSeed)"
  readonly decisionTraceVersion: number;
  readonly models: readonly ModelManifestEntry[];
  readonly playerPolicies: readonly PlayerPolicyManifestEntry[];
  readonly initialMatchSeed?: number;
  readonly initialStateHash?: string;
}

/**
 * 完全な Execution Manifest スキーマ
 */
export interface ExecutionManifest {
  readonly schemaVersion: "1.0.0";
  readonly workId: string;
  readonly generatedAt: string; // ISO 8601
  readonly environment: {
    readonly nodeVersion: string;
    readonly platform: string;
    readonly arch: string;
  };
  readonly gitMetadata: GitExecutionMetadata;
  readonly subsystemDigests: SubsystemContentDigests;
  readonly experimentConfig: ExperimentConfigManifest;
  /**
   * 実行日時等の非決定論的フィールドを除外した、
   * 静的なコード・依存・設定から算出される一意の指紋
   */
  readonly experimentFingerprint: string;
  /**
   * 自己参照を除き、全フィールドを正規化 JSON から計算した SHA-256 Digest
   */
  readonly manifestHash: string;
}

/**
 * Dirty 状態での正式結果保存を拒否するエラー
 */
export class ExecutionManifestDirtyStateError extends Error {
  constructor(message: string, public readonly dirtyFiles: readonly string[]) {
    super(message);
    this.name = "ExecutionManifestDirtyStateError";
  }
}

/**
 * SHA-256 ハッシュを計算
 */
function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * オブジェクトのキーをアルファベット順にソートして決定論的な JSON 文字列を生成
 */
export function canonicalJsonStringify(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * ディレクトリ内の全ファイルを再帰的に走査し、ファイル相対パスと内容から合成 Digest を計算
 */
export function computeDirectoryContentDigest(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    return sha256(`NOT_FOUND:${path.basename(dirPath)}`);
  }

  const fileEntries: Array<{ relPath: string; hash: string }> = [];

  function walk(currentDir: string) {
    const list = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const ent of list) {
      const fullPath = path.join(currentDir, ent.name);
      if (ent.isDirectory()) {
        walk(fullPath);
      } else if (ent.isFile()) {
        const relPath = path.relative(dirPath, fullPath).replace(/\\/g, "/");
        const content = fs.readFileSync(fullPath);
        fileEntries.push({ relPath, hash: sha256(content) });
      }
    }
  }

  walk(dirPath);
  fileEntries.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const manifestStr = fileEntries.map((e) => `${e.relPath}:${e.hash}`).join("\n");
  return sha256(manifestStr);
}

/**
 * Git メタデータを安全に取得 (Git コマンド失敗時のフォールバック付き)
 */
export function getGitExecutionMetadata(rootDir: string): GitExecutionMetadata {
  try {
    const headCommitSha = execSync("git rev-parse HEAD", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    let branch = "";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      branch = "detached";
    }

    const statusOutput = execSync("git status --porcelain", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const dirtyFiles = statusOutput
      ? statusOutput
          .split("\n")
          .map((line) => line.trim().slice(3))
          .filter((f) => f.length > 0)
      : [];

    return {
      headCommitSha,
      branch,
      isDirty: dirtyFiles.length > 0,
      dirtyFiles,
    };
  } catch {
    // Git が利用できない環境でのフォールバック
    const envSha = process.env.GIT_COMMIT_SHA || "0000000000000000000000000000000000000000";
    return {
      headCommitSha: envSha,
      branch: "unknown",
      isDirty: false,
      dirtyFiles: [],
    };
  }
}

/**
 * 各サブシステムのコンテンツ Digest を計算
 */
export function computeSubsystemContentDigests(rootDir: string): SubsystemContentDigests {
  const simDir = path.resolve(rootDir, "tools/simulator");
  const rules = computeDirectoryContentDigest(path.resolve(simDir, "src/engine/rules"));
  const simulation = computeDirectoryContentDigest(path.resolve(simDir, "src/engine/simulation"));
  const ai = computeDirectoryContentDigest(path.resolve(simDir, "src/engine/ai"));
  const regulations = computeDirectoryContentDigest(path.resolve(simDir, "src/data/regulations"));
  const rulesPackage = computeDirectoryContentDigest(path.resolve(simDir, "src/data/rules-vnext"));

  // 依存関係 (package.json / package-lock.json)
  const pkgPath = path.resolve(simDir, "package.json");
  const lockPath = path.resolve(simDir, "package-lock.json");
  const rootPkgPath = path.resolve(rootDir, "package.json");

  let depContent = "";
  if (fs.existsSync(pkgPath)) depContent += fs.readFileSync(pkgPath, "utf-8");
  if (fs.existsSync(lockPath)) depContent += fs.readFileSync(lockPath, "utf-8");
  if (fs.existsSync(rootPkgPath)) depContent += fs.readFileSync(rootPkgPath, "utf-8");
  const dependencies = sha256(depContent);

  return {
    rules,
    simulation,
    ai,
    regulations,
    rulesPackage,
    dependencies,
  };
}

/**
 * 実行日時等の変動値を除いた静的設定・コードハッシュから安定した experimentFingerprint を計算
 */
export function computeExperimentFingerprint(params: {
  gitCommitSha: string;
  subsystemDigests: SubsystemContentDigests;
  experimentConfig: ExperimentConfigManifest;
}): string {
  const fingerprintPayload = {
    gitCommitSha: params.gitCommitSha,
    subsystemDigests: params.subsystemDigests,
    experimentConfig: params.experimentConfig,
  };
  return sha256(canonicalJsonStringify(fingerprintPayload));
}

/**
 * 完全な Execution Manifest を生成
 */
export function createExecutionManifest(params: {
  workId: string;
  rootDir: string;
  experimentConfig: ExperimentConfigManifest;
  overrideGitMetadata?: GitExecutionMetadata;
}): ExecutionManifest {
  const gitMetadata = params.overrideGitMetadata ?? getGitExecutionMetadata(params.rootDir);
  const subsystemDigests = computeSubsystemContentDigests(params.rootDir);
  const experimentFingerprint = computeExperimentFingerprint({
    gitCommitSha: gitMetadata.headCommitSha,
    subsystemDigests,
    experimentConfig: params.experimentConfig,
  });

  const baseManifestWithoutHash = {
    schemaVersion: "1.0.0" as const,
    workId: params.workId,
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    gitMetadata,
    subsystemDigests,
    experimentConfig: params.experimentConfig,
    experimentFingerprint,
  };

  // 自己参照 (manifestHash) を除いた正規化 JSON から manifestHash を算出
  const manifestHash = sha256(canonicalJsonStringify(baseManifestWithoutHash));

  return {
    ...baseManifestWithoutHash,
    manifestHash,
  };
}

/**
 * 実験結果の正式保存時に未コミット変更 (dirty state) がある場合は厳格に例外を投げる
 */
export function assertNotDirty(manifest: ExecutionManifest): void {
  if (manifest.gitMetadata.isDirty) {
    throw new ExecutionManifestDirtyStateError(
      `CRITICAL EXECUTION INTEGRITY FAILURE: 実験結果の正式保存は dirty な状態では許可されません。\n` +
        `未コミットの変更ファイル (${manifest.gitMetadata.dirtyFiles.length} 件):\n` +
        manifest.gitMetadata.dirtyFiles.map((f) => `  - ${f}`).join("\n"),
      manifest.gitMetadata.dirtyFiles
    );
  }
}
