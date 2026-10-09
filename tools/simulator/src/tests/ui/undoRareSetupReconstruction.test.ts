import { describe, it, expect, beforeAll } from "vitest";
import {
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import {
  loadRegulationCatalogForBrowser,
  clearBrowserRegulationCache,
} from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import {
  startMatchAttempt,
  ActiveMatchContext,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService";
import type { ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes";
import {
  buildUndoReconstructParams,
} from "../../ui/playtest/CoreBattlePlaytest";

describe("Undo Rare Setup Reconstruction Regression Tests [BP-SIM-UNDO-RARE-SETUP-RECONSTRUCTION-R1]", () => {
  let catalog: any;
  let fullRulePackage: any;

  beforeAll(() => {
    clearRegulationCache();
    clearBrowserRegulationCache();
    catalog = loadRegulationCatalogForBrowser();
    fullRulePackage = loadRulePackageForBrowser();
  });

  const RARE_PACK_ENV = "official:pro-rarePack";
  const DIAGNOSTIC_SEED = 1636917953;

  const RARE_SELECTIONS_LIVE = {
    p1: [{ suit: "S" as const, rank: "K" as const, occurrence: 0 }],
    p2: [{ suit: "J" as const, rank: "Joker" as const, occurrence: 0 }],
  };

  // 実機 Diagnostic (seed 1636917953, official:pro-rarePack) における seq 1〜25 の判断列
  const DIAGNOSTIC_TRANSCRIPT_SEQ_1_TO_25: readonly ReplayDecisionEntryV1[] = [
    { seq: 1, actor: "policy", playerId: "p2", response: { decisionId: "d-1", stateVersion: 2, selectedPatternRef: 47 } },
    { seq: 2, actor: "policy", playerId: "p2", response: { decisionId: "d-2", stateVersion: 3, selectedPatternRef: 18 } },
    { seq: 3, actor: "policy", playerId: "p2", response: { decisionId: "d-3", stateVersion: 4, selectedPatternRef: 0 } },
    { seq: 4, actor: "policy", playerId: "p2", response: { decisionId: "d-4", stateVersion: 5, selectedPatternRef: 105 } },
    { seq: 5, actor: "human", playerId: "p1", response: { decisionId: "d-5", stateVersion: 6, selectedPatternRef: 126 } },
    { seq: 6, actor: "policy", playerId: "p2", response: { decisionId: "d-6", stateVersion: 7, selectedPatternRef: 66 } },
    { seq: 7, actor: "policy", playerId: "p2", response: { decisionId: "d-7", stateVersion: 8, selectedPatternRef: 103 } },
    { seq: 8, actor: "human", playerId: "p1", response: { decisionId: "d-8", stateVersion: 9, selectedPatternRef: 167 } },
    { seq: 9, actor: "policy", playerId: "p2", response: { decisionId: "d-9", stateVersion: 10, selectedPatternRef: 52 } },
    { seq: 10, actor: "policy", playerId: "p2", response: { decisionId: "d-10", stateVersion: 11, selectedPatternRef: 82 } },
    { seq: 11, actor: "human", playerId: "p1", response: { decisionId: "d-11", stateVersion: 12, selectedPatternRef: 208 } },
    { seq: 12, actor: "policy", playerId: "p2", response: { decisionId: "d-12", stateVersion: 13, selectedPatternRef: 1 } },
    { seq: 13, actor: "policy", playerId: "p2", response: { decisionId: "d-13", stateVersion: 14, selectedPatternRef: 32 } },
    { seq: 14, actor: "human", playerId: "p1", response: { decisionId: "d-14", stateVersion: 15, selectedPatternRef: 208 } },
    { seq: 15, actor: "policy", playerId: "p2", response: { decisionId: "d-15", stateVersion: 16, selectedPatternRef: 0 } },
    { seq: 16, actor: "policy", playerId: "p2", response: { decisionId: "d-16", stateVersion: 17, selectedPatternRef: 31 } },
    { seq: 17, actor: "human", playerId: "p1", response: { decisionId: "d-17", stateVersion: 18, selectedPatternRef: 201 } },
    { seq: 18, actor: "policy", playerId: "p2", response: { decisionId: "d-18", stateVersion: 19, selectedPatternRef: 0 } },
    { seq: 19, actor: "policy", playerId: "p2", response: { decisionId: "d-19", stateVersion: 20, selectedPatternRef: 20 } },
    { seq: 20, actor: "policy", playerId: "p2", response: { decisionId: "d-20", stateVersion: 21, selectedPatternRef: 31 } },
    { seq: 21, actor: "human", playerId: "p1", response: { decisionId: "d-21", stateVersion: 22, selectedPatternRef: 201 } },
    { seq: 22, actor: "human", playerId: "p1", response: { decisionId: "d-22", stateVersion: 23, selectedPatternRef: 201 } },
    { seq: 23, actor: "policy", playerId: "p2", response: { decisionId: "d-23", stateVersion: 24, selectedPatternRef: 31 } },
    { seq: 24, actor: "human", playerId: "p1", response: { decisionId: "d-24", stateVersion: 25, selectedPatternRef: 2 } },
    { seq: 25, actor: "autoPass", playerId: "p1", response: { decisionId: "d-25", stateVersion: 26, selectedPatternRef: 309 } },
  ];

  describe("Test A: Explicit Rare Selection Reconstruction", () => {
    it("reconstructs match with explicit rareCardSelections matching live session initial state", () => {
      // 1. Live Match を開始
      const liveResult = startMatchAttempt({
        environmentId: RARE_PACK_ENV,
        matchMode: "humanVsAi",
        seedInput: String(DIAGNOSTIC_SEED),
        rareCardSelections: RARE_SELECTIONS_LIVE,
        catalog,
        fullRulePackage,
      });

      expect(liveResult.type).toBe("READY");
      if (liveResult.type !== "READY") return;

      const liveState = liveResult.session.state as any;
      expect(liveState.players.p1.rareCards[0].suit).toBe("S");
      expect(liveState.players.p1.rareCards[0].rank).toBe("K");
      expect(liveState.players.p2.rareCards[0].suit).toBe("J");
      expect(liveState.players.p2.rareCards[0].rank).toBe("Joker");

      // 2. reconstructMatch で同一条件で再構築
      const reconResult = reconstructMatch({
        environmentId: RARE_PACK_ENV,
        seed: DIAGNOSTIC_SEED,
        rareCardSelections: RARE_SELECTIONS_LIVE,
        transcript: [],
        decisionCount: 0,
        trailingNormalization: "EXACT_AFTER_TRANSCRIPT",
        catalog,
        fullRulePackage,
        expectedRulePackage: liveResult.activeMatch.rulePackage,
      });

      expect(reconResult.status).toBe("SUCCESS");
      if (reconResult.status !== "SUCCESS") return;

      const reconState = reconResult.session.state as any;

      // Rare Zone の一致検証
      expect(reconState.players.p1.rareCards).toEqual(liveState.players.p1.rareCards);
      expect(reconState.players.p2.rareCards).toEqual(liveState.players.p2.rareCards);

      // 初期デッキ・手札・ライフの完全一致検証
      expect(reconState.players.p1.deck).toEqual(liveState.players.p1.deck);
      expect(reconState.players.p2.deck).toEqual(liveState.players.p2.deck);
      expect(reconState.players.p1.hand).toEqual(liveState.players.p1.hand);
      expect(reconState.players.p2.hand).toEqual(liveState.players.p2.hand);
      expect(reconState.players.p1.life).toEqual(liveState.players.p1.life);
      expect(reconState.players.p2.life).toEqual(liveState.players.p2.life);

      // 初期 DecisionRequest の合法手数が一致すること
      if (
        liveResult.initialStep.type === "WAITING_FOR_DECISION" &&
        reconResult.currentStep.type === "WAITING_FOR_DECISION"
      ) {
        expect(reconResult.currentStep.request.patterns.length).toBe(
          liveResult.initialStep.request.patterns.length
        );
        expect(reconResult.currentStep.request.patterns.map((p) => p.patternId)).toEqual(
          liveResult.initialStep.request.patterns.map((p) => p.patternId)
        );
      }
    });
  });

  describe("Test B: Diagnostic Regression (seq 1〜25)", () => {
    it("reproduces PATTERN_REF_OUT_OF_RANGE at seq 25 when rareCardSelections is omitted (pre-fix)", () => {
      // 修正前の挙動: rareCardSelections を渡さない場合、デフォルト選択（p1: Joker, p2: Joker）となり
      // デッキ順が乖離して seq 25 で available patterns が 173 になり ref 309 でクラッシュする
      const reconOmitted = reconstructMatch({
        environmentId: RARE_PACK_ENV,
        seed: DIAGNOSTIC_SEED,
        rareCardSelections: undefined, // 省略
        transcript: DIAGNOSTIC_TRANSCRIPT_SEQ_1_TO_25,
        decisionCount: 25,
        catalog,
        fullRulePackage,
      });

      expect(reconOmitted.status).toBe("DIVERGED");
      if (reconOmitted.status === "DIVERGED") {
        expect(reconOmitted.code).toBe("PATTERN_REF_OUT_OF_RANGE");
        expect(reconOmitted.decisionSeq).toBe(25);
        expect(reconOmitted.message).toContain("selected 309, available patterns: 173");
      }
    });

    it("successfully reconstructs all 25 decisions when rareCardSelections is preserved (post-fix)", () => {
      // 修正後の挙動: 成立済み rareCardSelections を渡すことで、seq 25 で available patterns = 310 となり
      // autoPass (ref 309) が合法に受理され、全 25 ステップが SUCCESS で完了する
      const reconPreserved = reconstructMatch({
        environmentId: RARE_PACK_ENV,
        seed: DIAGNOSTIC_SEED,
        rareCardSelections: RARE_SELECTIONS_LIVE,
        transcript: DIAGNOSTIC_TRANSCRIPT_SEQ_1_TO_25,
        decisionCount: 25,
        catalog,
        fullRulePackage,
      });

      expect(reconPreserved.status).toBe("SUCCESS");
      if (reconPreserved.status === "SUCCESS") {
        expect(reconPreserved.executedDecisions).toBe(25);
        expect(reconPreserved.replayedDecisions.length).toBe(25);
        // seq 25 (autoPass) の DecisionRequest の合法手数が 310 であったことを実証
        const lastExecuted = reconPreserved.replayedDecisions[24];
        expect(lastExecuted.entry.seq).toBe(25);
        expect(lastExecuted.entry.response.selectedPatternRef).toBe(309);
        expect(lastExecuted.request.patterns.length).toBe(310);
      }
    });
  });

  describe("Test C: UI Undo Helper / Pure Function Verification", () => {
    it("buildUndoReconstructParams binds rareCardSelections from ActiveMatchContext", () => {
      const startResult = startMatchAttempt({
        environmentId: RARE_PACK_ENV,
        matchMode: "humanVsAi",
        seedInput: String(DIAGNOSTIC_SEED),
        rareCardSelections: RARE_SELECTIONS_LIVE,
        catalog,
        fullRulePackage,
      });

      expect(startResult.type).toBe("READY");
      if (startResult.type !== "READY") return;

      const activeMatch = startResult.activeMatch;

      const params = buildUndoReconstructParams({
        activeMatch,
        targetTranscript: DIAGNOSTIC_TRANSCRIPT_SEQ_1_TO_25.slice(0, 24),
        catalog,
        fullRulePackage,
      });

      expect(params.environmentId).toBe(RARE_PACK_ENV);
      expect(params.seed).toBe(DIAGNOSTIC_SEED);
      expect(params.rareCardSelections).toBe(activeMatch.rareCardSelections);
      expect(params.rareCardSelections).toEqual(RARE_SELECTIONS_LIVE);
      expect(params.transcript.length).toBe(24);
      expect(params.decisionCount).toBe(24);
      expect(params.catalog).toBe(catalog);
      expect(params.fullRulePackage).toBe(fullRulePackage);
      expect(params.expectedRulePackage).toEqual(activeMatch.rulePackage);

      // この params で reconstructMatch を実行して SUCCESS になること
      const recon = reconstructMatch(params);
      if (recon.status !== "SUCCESS") {
        console.error("Test C rare error:", recon);
      }
      expect(recon.status).toBe("SUCCESS");
      if (recon.status === "SUCCESS") {
        expect(recon.executedDecisions).toBe(24);
      }
    });

    it("buildUndoReconstructParams passes undefined rareCardSelections for non-rare environments", () => {
      const startResult = startMatchAttempt({
        environmentId: "official:light-entry16",
        matchMode: "humanVsHuman",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });

      expect(startResult.type).toBe("READY");
      if (startResult.type !== "READY") return;

      const activeMatch = startResult.activeMatch;

      const params = buildUndoReconstructParams({
        activeMatch,
        targetTranscript: [],
        catalog,
        fullRulePackage,
      });

      expect(params.environmentId).toBe("official:light-entry16");
      expect(params.seed).toBe(42);
      expect(params.rareCardSelections).toBeUndefined();
      expect(params.transcript).toEqual([]);
      expect(params.decisionCount).toBe(0);

      const recon = reconstructMatch(params);
      if (recon.status !== "SUCCESS") {
        console.error("Test C non-rare error:", recon);
      }
      expect(recon.status).toBe("SUCCESS");
    });
  });
});
