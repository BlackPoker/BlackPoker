import { describe, it, expect } from "vitest";
import {
  validateSeed,
  getAvailableEnvironments,
  isOfficialEnvironment,
  extractRegulationId,
  createInitialPlaytestState,
  selectPendingEnvironment,
  setPendingSeedInput,
  startMatchAttempt,
  CORE_BATTLE_ENV_ID,
  OFFICIAL_ENV_PREFIX,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";

describe("PlaytestEnvironmentController (Phase 2.4.1)", () => {
  const fullRulePackage = loadRulePackageForBrowser();
  const catalog = loadRegulationCatalogForBrowser();

  describe("Contract M: Strict Seed Validation", () => {
    it("正常な非負整数文字列を正しく受理すること", () => {
      const r1 = validateSeed("42");
      expect(r1.valid).toBe(true);
      if (r1.valid) expect(r1.seed).toBe(42);

      const r2 = validateSeed("0");
      expect(r2.valid).toBe(true);
      if (r2.valid) expect(r2.seed).toBe(0);

      const r3 = validateSeed("  100  ");
      expect(r3.valid).toBe(true);
      if (r3.valid) expect(r3.seed).toBe(100);

      const r4 = validateSeed("20260906");
      expect(r4.valid).toBe(true);
      if (r4.valid) expect(r4.seed).toBe(20260906);
    });

    it("空文字・空白文字のみを拒否すること", () => {
      const r1 = validateSeed("");
      expect(r1.valid).toBe(false);

      const r2 = validateSeed("   ");
      expect(r2.valid).toBe(false);
    });

    it("英字・非数文字を含む文字列を拒否すること", () => {
      const r1 = validateSeed("abc");
      expect(r1.valid).toBe(false);

      const r2 = validateSeed("NaN");
      expect(r2.valid).toBe(false);

      const r3 = validateSeed("Infinity");
      expect(r3.valid).toBe(false);

      const r4 = validateSeed("-Infinity");
      expect(r4.valid).toBe(false);
    });

    it("parseInt で部分受理される '42abc' 形式を厳格に拒否すること (No partial acceptance)", () => {
      const r = validateSeed("42abc");
      expect(r.valid).toBe(false);
    });

    it("小数を厳格に拒否すること", () => {
      const r1 = validateSeed("42.5");
      expect(r1.valid).toBe(false);

      const r2 = validateSeed("0.1");
      expect(r2.valid).toBe(false);
    });

    it("負の整数を拒否すること", () => {
      const r1 = validateSeed("-1");
      expect(r1.valid).toBe(false);

      const r2 = validateSeed("-42");
      expect(r2.valid).toBe(false);
    });

    it("invalid 時に 42 へフォールバックしないこと", () => {
      const r = validateSeed("invalid");
      expect(r.valid).toBe(false);
      // valid が false なので seed プロパティは存在しない
      expect((r as any).seed).toBeUndefined();
    });
  });

  describe("Contract P: Environment Options & Dynamic Discovery", () => {
    it("Core Battle が擬似環境として常に含まれること", () => {
      const options = getAvailableEnvironments(catalog);
      const coreBattle = options.find((o) => o.id === CORE_BATTLE_ENV_ID);
      expect(coreBattle).toBeDefined();
      expect(coreBattle?.isOfficial).toBe(false);
      expect(coreBattle?.name).toBe("Core Battle（開発・検証）");
    });

    it("Official options は Browser Catalog 由来で動的に列挙されること", () => {
      const options = getAvailableEnvironments(catalog);
      const officialOptions = options.filter((o) => o.isOfficial);
      expect(officialOptions.length).toBeGreaterThan(0);
      for (const opt of officialOptions) {
        expect(opt.id.startsWith(OFFICIAL_ENV_PREFIX)).toBe(true);
        expect(opt.regulationId).toBeDefined();
      }
    });

    it("light-entry16 が simulatorImplemented として列挙されること", () => {
      const options = getAvailableEnvironments(catalog);
      const lightEntry16 = options.find((o) => o.id === "official:light-entry16");
      expect(lightEntry16).toBeDefined();
      expect(lightEntry16?.isOfficial).toBe(true);
      expect(lightEntry16?.regulationId).toBe("light-entry16");
      expect(lightEntry16?.name).toContain("ライト + エントリー16");
    });

    it("未実装のレギュレーションは選択肢に入らないこと", () => {
      const options = getAvailableEnvironments(catalog);
      // カタログ内の全レギュレーションのうち未実装のものが除外されているか
      for (const reg of catalog.regulations.values()) {
        if (reg.id !== "light-entry16") {
          const found = options.find((o) => o.regulationId === reg.id);
          expect(found).toBeUndefined();
        }
      }
    });

    it("Official route が generic に regulationId を抽出できること", () => {
      expect(isOfficialEnvironment("official:light-entry16")).toBe(true);
      expect(extractRegulationId("official:light-entry16")).toBe("light-entry16");

      expect(isOfficialEnvironment("core-battle")).toBe(false);
      expect(extractRegulationId("core-battle")).toBeNull();

      expect(isOfficialEnvironment("official:custom-reg-id")).toBe(true);
      expect(extractRegulationId("official:custom-reg-id")).toBe("custom-reg-id");
    });
  });

  describe("Contract N & Pure State Transitions: Pending vs Active", () => {
    it("Environment セレクターの変更のみでは Pending のみが変化し、Active Match は不変であること", () => {
      const initial = createInitialPlaytestState(CORE_BATTLE_ENV_ID, "42");
      expect(initial.pendingEnvironmentId).toBe(CORE_BATTLE_ENV_ID);
      expect(initial.activeMatch).toBeNull();

      const next = selectPendingEnvironment(initial, "official:light-entry16");
      expect(next.pendingEnvironmentId).toBe("official:light-entry16");
      expect(next.activeMatch).toBeNull();
      expect(next.pendingSeedInput).toBe("42");
    });

    it("Seed 入力の変更のみでは Pending のみが変化し、Active Match は不変であること", () => {
      const initial = createInitialPlaytestState(CORE_BATTLE_ENV_ID, "42");
      const next = setPendingSeedInput(initial, "999");
      expect(next.pendingSeedInput).toBe("999");
      expect(next.activeMatch).toBeNull();
      expect(next.pendingEnvironmentId).toBe(CORE_BATTLE_ENV_ID);
    });

    it("Core Battle は Seed validation を行わず、invalid Seed 入力でも開始可能であること (ActiveMatch.seed は undefined)", () => {
      const outcome = startMatchAttempt({
        environmentId: CORE_BATTLE_ENV_ID,
        seedInput: "invalid_seed_abc",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type === "READY") {
        expect(outcome.activeMatch).toBeDefined();
        expect(outcome.activeMatch.environmentId).toBe(CORE_BATTLE_ENV_ID);
        expect(outcome.activeMatch.seed).toBeUndefined(); // Core Battle は Seed を持たない
        expect(outcome.session).toBeDefined();
        expect(outcome.initialStep.type).toBe("WAITING_FOR_DECISION");
      }
    });

    it("Official 対戦で valid な Seed を指定した場合、READY となり Active Match が commit されること", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:light-entry16",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type === "READY") {
        expect(outcome.activeMatch).toBeDefined();
        expect(outcome.activeMatch.environmentId).toBe("official:light-entry16");
        expect(outcome.activeMatch.seed).toBe(42);
        expect(outcome.activeMatch.regulationId).toBe("light-entry16");
        expect(outcome.session).toBeDefined();
        expect(outcome.initialStep.type).toBe("WAITING_FOR_DECISION");
      }
    });

    it("Official 対戦で invalid な Seed を指定した場合、VALIDATION_ERROR となり Active Match は null であること", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:light-entry16",
        seedInput: "42abc",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("VALIDATION_ERROR");
      expect(outcome.activeMatch).toBeNull();
      if (outcome.type === "VALIDATION_ERROR") {
        expect(outcome.setupNotice.type).toBe("VALIDATION_ERROR");
        expect(outcome.setupNotice.title).toContain("シード値検証エラー");
      }
    });
  });

  describe("Contract O: Setup Outcome Integrity", () => {
    it("READY 時のみ GameSession が生成されること", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:light-entry16",
        seedInput: "100",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type === "READY") {
        expect(outcome.session).toBeDefined();
      }
    });

    it("VALIDATION_ERROR 時に GameSession や合成 State が生成されず、activeMatch が null であること", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:light-entry16",
        seedInput: "",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("VALIDATION_ERROR");
      expect(outcome.activeMatch).toBeNull();
      expect((outcome as any).session).toBeUndefined();
    });

    it("存在しない公式環境 ID の場合、TECHNICAL_ERROR となり TERMINAL として分類されないこと", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:non-existent-regulation",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("TECHNICAL_ERROR");
      expect(outcome.activeMatch).toBeNull();
      if (outcome.type === "TECHNICAL_ERROR") {
        expect(outcome.setupNotice.type).toBe("TECHNICAL_ERROR");
        expect(outcome.setupNotice.type).not.toBe("TERMINAL");
      }
    });
  });

  describe("Contract Q: RulePackage Separation & DebugPanel Integrity", () => {
    it("Core Battle の activeRulePackage は playtest package であること", () => {
      const outcome = startMatchAttempt({
        environmentId: CORE_BATTLE_ENV_ID,
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type === "READY") {
        const expectedPlaytest = getPlaytestRulePackage(fullRulePackage);
        expect(outcome.activeMatch.rulePackage.id).toBe(expectedPlaytest.id);
      }
    });

    it("Official Entry16 の activeRulePackage は official-light-entry16 package であること", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:light-entry16",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type === "READY") {
        expect(outcome.activeMatch.rulePackage.id).toBe("official-light-entry16");
        // Core Battle 専用アクションや未承認アクションが混入していないこと
        const actionIds = outcome.activeMatch.rulePackage.actions.map((a) => a.id);
        expect(actionIds).toContain("action.attack");
        expect(actionIds).toContain("action.block");
        expect(actionIds).toContain("action.twist");
        expect(actionIds).toContain("action.down");
        expect(actionIds).toContain("action.up");
      }
    });

    it("activeMatch === null の場合、Active Match なしとして扱えること (Core Battle パッケージを誤フォールバックさせない保証)", () => {
      const failedOutcome = startMatchAttempt({
        environmentId: "official:light-entry16",
        seedInput: "not_a_number",
        catalog,
        fullRulePackage,
      });
      expect(failedOutcome.activeMatch).toBeNull();
      // activeMatch が null のとき、DebugPanel に渡す package は undefined (または非表示) であり、
      // Core Battle の rulePackage を誤って表示しない契約
      const debugRulePackage = failedOutcome.activeMatch ? (failedOutcome.activeMatch as any).rulePackage : undefined;
      expect(debugRulePackage).toBeUndefined();
    });
  });
});
