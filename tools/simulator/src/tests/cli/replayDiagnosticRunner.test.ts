import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { runDiagnosticReplayCli } from "../../cli/replayDiagnosticRunner";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { startMatchAttempt, OFFICIAL_ENV_PREFIX } from "../../engine/playtest/PlaytestEnvironmentController";
import { buildPlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";

describe("replayDiagnosticRunner CLI Tests", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  it("should fail cleanly when diagnostic file does not exist", async () => {
    const code = await runDiagnosticReplayCli(["--file", "non-existent-diagnostic.json"]);
    expect(code).toBe(1);
  });

  it("should successfully replay reconstructed defeat diagnostic bundle without divergence", async () => {
    const filePath = path.resolve(process.cwd(), ".artifacts/diagnostic-reconstructed/reconstructed-playtest-diagnostic-seed4127992094.json");
    if (!fs.existsSync(filePath)) {
      // CI 等で事前生成ファイルがない場合は軽量な Fixture バンドルを生成して検証
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
          actor: "policy",
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
        seatControllers: {
          p1: { kind: "HUMAN", playerId: "p1" },
          p2: { kind: "POLICY", playerId: "p2", policyId: "gen8-champion-candidate" },
        },
        currentStep: step,
        rawState: session.state,
        canonicalMatchLog: (session as any).logRecorder,
        decisionTranscript: transcript,
      });

      const tempDir = path.resolve(process.cwd(), ".artifacts/test-fixtures");
      fs.mkdirSync(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, "temp-diagnostic.json");
      fs.writeFileSync(tempPath, JSON.stringify(bundle, null, 2), "utf-8");

      const code = await runDiagnosticReplayCli(["--file", tempPath]);
      expect(code).toBe(0);
      return;
    }

    // 再現ファイルが存在する場合は本番の完全再現テストを実行
    const code = await runDiagnosticReplayCli(["--file", filePath]);
    expect(code).toBe(0);
  });
});
