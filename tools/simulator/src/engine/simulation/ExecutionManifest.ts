import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { DecisionTraceRecord } from "./SimulationRunner.js";
import { PolicyDescriptor } from "./DecisionPolicy.js";

/**
 * Git 検証ステータス
 */
export type GitVerificationStatus = "VERIFIED" | "FAILED" | "ENV_OVERRIDE";

/**
 * 実験実行時の Git および未コミット状態のメタデータ
 */
export interface GitExecutionMetadata {
  readonly headCommitSha: string;
  readonly branch: string;
  readonly isDirty: boolean;
  readonly dirtyFiles: readonly string[];
  readonly verificationStatus: GitVerificationStatus;
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
 * Git 検証失敗（fail-closed）による保存拒否エラー
 */
export class ExecutionManifestUnverifiedGitStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionManifestUnverifiedGitStateError";
  }
}

/**
 * 必須サブシステム欠落エラー (fail-closed)
 */
export class ExecutionManifestMissingSubsystemError extends Error {
  constructor(message: string, public readonly missingPath: string) {
    super(message);
    this.name = "ExecutionManifestMissingSubsystemError";
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
 * git status --porcelain 出力の各行を解析して対象パスを抽出
 *
 * フォーマット仕様:
 * - 先頭2文字: ステータスフラグ (XY)
 * - 3文字目: 半角スペース
 * - 4文字目以降: ファイルパス (リネーム時は "old -> new")
 */
export function parsePorcelainLine(rawLine: string): string | null {
  if (!rawLine || rawLine.length < 4) return null;
  // 先頭2文字はフラグ、3文字目はスペース。slice(3) でパス部分を取得
  const pathPart = rawLine.slice(3).trim();
  if (!pathPart) return null;

  // リネーム "R  old -> new" の場合は変更後の新しいパスを抽出
  if (pathPart.includes(" -> ")) {
    const parts = pathPart.split(" -> ");
    return parts[parts.length - 1].trim();
  }
  return pathPart;
}

/**
 * ディレクトリ内の全ファイルを再帰的に走査し、ファイル相対パスと内容から合成 Digest を計算
 *
 * @param dirPath 走査対象ディレクトリのパス
 * @param required 必須フラグ。true の場合、ディレクトリが存在しなければ fail-closed で例外を送出
 */
export function computeDirectoryContentDigest(dirPath: string, required: boolean = true): string {
  if (!fs.existsSync(dirPath)) {
    if (required) {
      throw new ExecutionManifestMissingSubsystemError(
        `CRITICAL MANIFEST INTEGRITY ERROR: 必須サブシステムディレクトリが存在しません: ${dirPath}`,
        dirPath
      );
    }
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
 * Git メタデータを安全に取得 (Git コマンド失敗時は fail-closed で dirty 扱い)
 */
export function getGitExecutionMetadata(rootDir: string): GitExecutionMetadata {
  try {
    const headCommitSha = execSync("git rev-parse HEAD", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!headCommitSha || headCommitSha.length !== 40 || !/^[0-9a-f]{40}$/.test(headCommitSha)) {
      throw new Error(`Invalid HEAD commit SHA format: '${headCommitSha}'`);
    }

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
    });

    const rawLines = statusOutput ? statusOutput.split(/\r?\n/) : [];
    const dirtyFiles: string[] = [];
    for (const line of rawLines) {
      const parsed = parsePorcelainLine(line);
      if (parsed) {
        dirtyFiles.push(parsed);
      }
    }

    return {
      headCommitSha,
      branch,
      isDirty: dirtyFiles.length > 0,
      dirtyFiles,
      verificationStatus: "VERIFIED",
    };
  } catch (err: any) {
    // Git コマンドが利用できない・失敗した場合は、fail-closed 原則に基づき isDirty: true としてマーク
    // (Git 未検証の状態で誤ってクリーンと判定される重大事故を防止)
    const envSha = process.env.GIT_COMMIT_SHA;
    if (envSha && envSha.length === 40 && /^[0-9a-f]{40}$/.test(envSha)) {
      return {
        headCommitSha: envSha,
        branch: process.env.GIT_BRANCH || "env-override",
        isDirty: true, // Git status 自体が検証不能なため安全側に倒して dirty
        dirtyFiles: ["GIT_STATUS_COMMAND_UNAVAILABLE_ENV_SHA_ONLY"],
        verificationStatus: "ENV_OVERRIDE",
      };
    }

    return {
      headCommitSha: "UNVERIFIED_MISSING_GIT_SHA",
      branch: "unknown",
      isDirty: true, // fail-closed: 検証不能時は dirty 扱い
      dirtyFiles: ["GIT_STATUS_COMMAND_FAILED_OR_GIT_NOT_FOUND"],
      verificationStatus: "FAILED",
    };
  }
}

/**
 * 各サブシステムのコンテンツ Digest を計算
 */
export function computeSubsystemContentDigests(rootDir: string): SubsystemContentDigests {
  const simDir = path.resolve(rootDir, "tools/simulator");
  const rules = computeDirectoryContentDigest(path.resolve(simDir, "src/engine/rules"), true);
  const simulation = computeDirectoryContentDigest(path.resolve(simDir, "src/engine/simulation"), true);
  const ai = computeDirectoryContentDigest(path.resolve(simDir, "src/engine/ai"), true);
  const regulations = computeDirectoryContentDigest(path.resolve(simDir, "src/data/regulations"), true);
  const rulesPackage = computeDirectoryContentDigest(path.resolve(simDir, "src/data/rules-vnext"), true);

  // 依存関係 (package.json / package-lock.json)
  const pkgPath = path.resolve(simDir, "package.json");
  const lockPath = path.resolve(simDir, "package-lock.json");
  const rootPkgPath = path.resolve(rootDir, "package.json");

  let depContent = "";
  if (fs.existsSync(pkgPath)) depContent += fs.readFileSync(pkgPath, "utf-8");
  if (fs.existsSync(lockPath)) depContent += fs.readFileSync(lockPath, "utf-8");
  if (fs.existsSync(rootPkgPath)) depContent += fs.readFileSync(rootPkgPath, "utf-8");

  if (!depContent) {
    throw new ExecutionManifestMissingSubsystemError(
      "CRITICAL MANIFEST INTEGRITY ERROR: 依存関係ファイル (package.json) が検出できませんでした。",
      pkgPath
    );
  }
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
 * 実験結果の正式保存時に未コミット変更 (dirty state) または Git 検証不能状態がある場合は厳格に例外を投げる
 *
 * 【設計・運用上の重要事項】:
 * 本関数 `assertNotDirty()` は現時点では独立した整合性検証ガード関数として提供されており、
 * 既存のパイロット Runner 等への自動強制適用は未実装です。
 * 将来の自動対戦実験や正式 Evidence 出力処理においては、後述の `saveOfficialEvidenceWithManifest()`
 * を通じて本ガードを必ず呼び出すインターフェース契約を採用します。
 */
export function assertNotDirty(manifest: ExecutionManifest): void {
  if (manifest.gitMetadata.verificationStatus === "FAILED") {
    throw new ExecutionManifestUnverifiedGitStateError(
      `CRITICAL EXECUTION INTEGRITY FAILURE: Git メタデータの取得・検証に失敗しているため、正式保存は拒否されます (fail-closed)。\n` +
        `Head SHA: ${manifest.gitMetadata.headCommitSha}, Verification: ${manifest.gitMetadata.verificationStatus}`
    );
  }

  if (manifest.gitMetadata.isDirty) {
    throw new ExecutionManifestDirtyStateError(
      `CRITICAL EXECUTION INTEGRITY FAILURE: 実験結果の正式保存は dirty な状態では許可されません。\n` +
        `未コミットの変更ファイル (${manifest.gitMetadata.dirtyFiles.length} 件):\n` +
        manifest.gitMetadata.dirtyFiles.map((f) => `  - ${f}`).join("\n"),
      manifest.gitMetadata.dirtyFiles
    );
  }
}

/**
 * 将来の正式な Evidence 保存処理で必ず Manifest ガードを強制するための標準保存インターフェース
 */
export interface SaveOfficialEvidenceParams<T> {
  readonly filePath: string;
  readonly evidenceData: T;
  readonly manifest: ExecutionManifest;
  readonly options?: {
    readonly writeSeparateManifestFile?: boolean;
    readonly allowDirtyBypassExplicitly?: boolean; // 原則禁止、テスト等の限定目的のみ
  };
}

/**
 * 正式な Evidence を Execution Manifest ガード付きで安全に保存する
 *
 * @throws {ExecutionManifestDirtyStateError} dirty 状態で保存しようとした場合
 * @throws {ExecutionManifestUnverifiedGitStateError} Git 検証に失敗している場合
 */
export function saveOfficialEvidenceWithManifest<T extends Record<string, any>>(
  params: SaveOfficialEvidenceParams<T>
): void {
  if (!params.options?.allowDirtyBypassExplicitly) {
    assertNotDirty(params.manifest);
  }

  const outputPayload = {
    ...params.evidenceData,
    executionManifest: params.manifest,
  };

  const dir = path.dirname(params.filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(params.filePath, JSON.stringify(outputPayload, null, 2), "utf-8");

  if (params.options?.writeSeparateManifestFile) {
    const manifestPath = `${params.filePath}.manifest.json`;
    fs.writeFileSync(manifestPath, JSON.stringify(params.manifest, null, 2), "utf-8");
  }
}
