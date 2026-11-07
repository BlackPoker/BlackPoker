import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { runDiagnosticReplayCli, OFFICIAL_GEN8_HUMAN_DEFEAT_DIAGNOSTIC_SHA256 } from "../../cli/replayDiagnosticRunner";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { startMatchAttempt, OFFICIAL_ENV_PREFIX } from "../../engine/playtest/PlaytestEnvironmentController";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";
import { buildPlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";

function resolveRulesDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "src/data/rules-vnext"),
    path.resolve(process.cwd(), "tools/simulator/src/data/rules-vnext"),
    path.resolve(__dirname, "../../data/rules-vnext"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve("src/data/rules-vnext");
}

function resolveRegulationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "src/data/regulations"),
    path.resolve(process.cwd(), "tools/simulator/src/data/regulations"),
    path.resolve(__dirname, "../../data/regulations"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve("src/data/regulations");
}

describe("replayDiagnosticRunner CLI Tests (Work 4-6 R3)", () => {
  it("should fail cleanly when diagnostic file does not exist", async () => {
    const code = await runDiagnosticReplayCli(["--file", "non-existent-diagnostic.json"]);
    expect(code).toBe(1);
  });

  it("should fail-closed when input file does not match official SHA-256 without fixture flag", async () => {
    const tempDir = path.resolve(process.cwd(), ".artifacts/test-fixtures");
    fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, "unauthorized-fake-diagnostic.json");
    fs.writeFileSync(tempPath, JSON.stringify({ kind: "blackpoker-playtest-diagnostic", schemaVersion: 1 }, null, 2), "utf-8");

    // 公式ハッシュと一致しないファイルは即座に拒否される
    const code = await runDiagnosticReplayCli(["--file", tempPath]);
    expect(code).toBe(1);
  });

  it("should successfully replay test fixture diagnostic bundle when --allow-test-fixture is passed", async () => {
    const rulesDir = resolveRulesDir();
    const regulationsDir = resolveRegulationsDir();
    const catalog = await loadRegulationCatalog(regulationsDir);
    const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const envId = `${OFFICIAL_ENV_PREFIX}standard-pack`;
    const outcome = startMatchAttempt({
      environmentId: envId,
      seedInput: "4127992094",
      catalog,
      fullRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = outcome.session;
    let step = outcome.initialStep;
    const transcript: any[] = [];

    // 1手実行
    if (step.type === "WAITING_FOR_DECISION") {
      transcript.push({
        seq: 1,
        actor: "human",
        playerId: step.request.playerId,
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        response: {
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: 0,
        },
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: 0,
      });
    }

    const bundle = buildPlaytestDiagnosticBundleV1({
      build: {
        sha: "974e9b00d38efc640a115f9e295f347f2054dbdb",
        ref: "refs/heads/BlackPoker/issue551-core-flow",
      },
      generatedAt: new Date().toISOString(),
      activeMatch: {
        environmentId: envId,
        environmentName: "スタンダード＋パック (公式)",
        regulationId: "standard-pack",
        seed: 4127992094,
        rulePackage: (outcome as any).activeMatch?.rulePackage ?? fullRulePackage,
      },
      activePlaytestSettings: {
        matchMode: "humanVsAi",
        humanSeat: "p1",
        policyId: "gen8-champion-candidate",
      },
      seatControllers: createSeatControllers("humanVsAi", "p1", "gen8-champion-candidate"),
      currentStep: step,
      rawState: session.state,
      canonicalMatchLog: (session as any).logRecorder?.getMatchLog ? (session as any).logRecorder.getMatchLog() : (session as any).logRecorder,
      decisionTranscript: transcript,
    });

    const tempDir = path.resolve(process.cwd(), ".artifacts/test-fixtures");
    fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, "temp-fixture-diagnostic.json");
    fs.writeFileSync(tempPath, JSON.stringify(bundle, null, 2), "utf-8");

    const code = await runDiagnosticReplayCli(["--file", tempPath, "--allow-test-fixture", "--allow-build-mismatch"]);
    expect(code).toBe(0);
  });

  it("should run official diagnostic replay if official file exists", async () => {
    // 公式ファイルが存在する場合のみ本番実行
    const officialCandidatePaths = [
      path.resolve(process.cwd(), "official-defeat-diagnostic.json"),
      path.resolve(process.cwd(), ".artifacts/official-defeat-diagnostic.json"),
    ];
    const officialPath = officialCandidatePaths.find((p) => fs.existsSync(p));

    if (officialPath) {
      const code = await runDiagnosticReplayCli(["--file", officialPath]);
      expect(code).toBe(0);
    } else {
      // 公式ファイル未配置時は Fail-Closed 設計の健全性を検証
      const code = await runDiagnosticReplayCli(["--file", "non-existent-official.json"]);
      expect(code).toBe(1);
    }
  });
});
