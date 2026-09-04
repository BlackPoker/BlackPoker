import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import {
  GameSessionSnapshotCodec,
  GameSessionSnapshotValidationError,
} from "../../engine/session/GameSessionSnapshotCodec";
import { SNAPSHOT_FORMAT_VERSION } from "../../domain/session/GameSessionSnapshot";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";

describe("Match Snapshot & Session Resume Foundation Tests (BP-SIM-AI-1.2.1-20260904-1914)", () => {
  let playtestRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    playtestRulePackage = getPlaytestRulePackage(fullPackage);
  });

  // --------------------------------------------------------------------------
  // 1. JSON Round-Trip, Format Version & RulePackage Validation Tests
  // --------------------------------------------------------------------------
  describe("Snapshot Format, Serialization & RulePackage Validation", () => {
    it("captures, serializes and deserializes snapshot with JSON round-trip (Version 1)", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage, { matchId: "test-match-123" });
      session.advance(); // WAITING_FOR_DECISION

      const snapshot = session.createSnapshot();

      // Version 1
      expect(snapshot.snapshotFormatVersion).toBe(SNAPSHOT_FORMAT_VERSION);
      expect(snapshot.snapshotFormatVersion).toBe(1);

      // Metadata with RulePackage id & version
      expect(snapshot.metadata.matchId).toBe("test-match-123");
      expect(snapshot.metadata.rulePackageRef).toBe(playtestRulePackage.id);
      expect(snapshot.metadata.rulesVersion).toBe(playtestRulePackage.version);
      expect(snapshot.metadata.createdAt).toBeGreaterThan(0);

      // State Hash v2
      expect(snapshot.gameStateHash).toBeDefined();
      expect(snapshot.gameStateHash.startsWith("sh2-")).toBe(true);
      expect(snapshot.gameStateHash).toBe(StateHasher.hash(session.state));

      // JSON Round-Trip
      const jsonString = GameSessionSnapshotCodec.serialize(snapshot);
      expect(typeof jsonString).toBe("string");

      const deserialized = GameSessionSnapshotCodec.deserialize(jsonString);
      expect(deserialized).toEqual(snapshot);

      // Restore with compatible RulePackage
      const restoredSession = GameSession.fromSnapshot(deserialized, playtestRulePackage);
      expect(restoredSession.matchId).toBe("test-match-123");
      expect(StateHasher.hash(restoredSession.state)).toBe(snapshot.gameStateHash);
    });

    it("rejects unsupported snapshot format version", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage);
      session.advance();

      const snapshot = session.createSnapshot();
      const invalidSnapshot = {
        ...snapshot,
        snapshotFormatVersion: 999 as any,
      };

      expect(() => {
        GameSessionSnapshotCodec.restore(invalidSnapshot, playtestRulePackage);
      }).toThrow(GameSessionSnapshotValidationError);
    });

    it("rejects restore when RulePackage ID does not match snapshot metadata", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage);
      session.advance();

      const snapshot = session.createSnapshot();
      const incompatibleRulePackage: RulePackage = {
        ...playtestRulePackage,
        id: "other-incompatible-rules",
      };

      expect(() => {
        GameSessionSnapshotCodec.restore(snapshot, incompatibleRulePackage);
      }).toThrow(GameSessionSnapshotValidationError);
    });

    it("rejects restore when RulePackage version does not match snapshot metadata", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage);
      session.advance();

      const snapshot = session.createSnapshot();
      const incompatibleVersionPackage: RulePackage = {
        ...playtestRulePackage,
        version: "99.9.9",
      };

      expect(() => {
        GameSessionSnapshotCodec.restore(snapshot, incompatibleVersionPackage);
      }).toThrow(GameSessionSnapshotValidationError);
    });

    it("rejects tampered game state when State Hash does not match", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage);
      session.advance();

      const snapshot = session.createSnapshot();
      const tamperedSnapshot = {
        ...snapshot,
        gameState: {
          ...snapshot.gameState,
          turnPlayer: snapshot.gameState.turnPlayer === "p1" ? "p2" : "p1", // 改ざん
        },
      };

      expect(() => {
        GameSessionSnapshotCodec.restore(tamperedSnapshot, playtestRulePackage);
      }).toThrow(GameSessionSnapshotValidationError);
    });

    it("rejects invalid or missing essential fields", () => {
      expect(() => {
        GameSessionSnapshotCodec.deserialize("");
      }).toThrow(GameSessionSnapshotValidationError);

      expect(() => {
        GameSessionSnapshotCodec.deserialize("{ invalid json }");
      }).toThrow(GameSessionSnapshotValidationError);

      expect(() => {
        GameSessionSnapshotCodec.validate(null);
      }).toThrow(GameSessionSnapshotValidationError);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Normal WAITING_FOR_DECISION Resume Tests
  // --------------------------------------------------------------------------
  describe("Normal WAITING_FOR_DECISION Resume", () => {
    it("resumes identical state transition when same decision is applied to original and restored session", () => {
      const state = createCoreBattlePresetState();
      const originalSession = new GameSession(state, playtestRulePackage, { matchId: "match-norm-001" });
      const step1 = originalSession.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");

      // Snapshot 取得
      const snapshot = originalSession.createSnapshot();

      // Restored Session 復元
      const restoredSession = GameSession.fromSnapshot(snapshot, playtestRulePackage);

      // 復元直後の状態検証
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));
      expect(restoredSession.pendingDecision).toBeDefined();
      expect(restoredSession.pendingDecision?.playerId).toBe(originalSession.pendingDecision?.playerId);
      expect(restoredSession.pendingDecision?.decisionId).toBe(originalSession.pendingDecision?.decisionId);
      expect(restoredSession.pendingDecision?.patterns.length).toBe(originalSession.pendingDecision?.patterns.length);

      // 両方のセッションに同一の DecisionResponse (First Legal) を適用
      const policy = new FirstLegalPolicy();
      const originalDecision = policy.choose(originalSession.pendingDecision!);
      const restoredDecision = policy.choose(restoredSession.pendingDecision!);

      const origNextStep = originalSession.submitDecision(originalDecision);
      const restNextStep = restoredSession.submitDecision(restoredDecision);

      // 適用後の状態が完全一致すること
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));
      expect(restNextStep.type).toBe(origNextStep.type);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Stage Request with Consecutive PASS & Stage Top Resolution Resume Tests
  // --------------------------------------------------------------------------
  describe("Stage Request with Consecutive PASS & Stage Top Resolution Resume", () => {
    it("verifies Stage TOP resolution on second PASS after resuming from snapshot with consecutivePassCount=1 and active Stage request", () => {
      const state = createCoreBattlePresetState();
      const originalSession = new GameSession(state, playtestRulePackage, { matchId: "match-stage-pass-002" });

      // Step 1: 初期判断待ち (Player A の手番)
      const step1 = originalSession.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      if (step1.type !== "WAITING_FOR_DECISION") return;

      // 通常アクション（Stage に積まれるアクション、例: action.attack）を選択
      const normalActionIdx = step1.request.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        const actId = step1.request.catalog.actions[p.actionSelectionRef]?.actionId;
        return actId === "action.attack";
      });
      expect(normalActionIdx).toBeGreaterThanOrEqual(0);

      // 1. 通常アクションを選択して送信（Stage に積まれるが未解決、チャンスは Player A のまま）
      const step2 = originalSession.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: normalActionIdx,
      });

      // 49.D: Stage 上に実際に Request が 1 件以上存在することを明示的に assert
      expect(originalSession.state.stage?.requests?.length).toBeGreaterThanOrEqual(1);
      const initialStageDepth = originalSession.state.stage.requests.length;
      const targetRequestId =
        originalSession.state.stage.requests[originalSession.state.stage.requests.length - 1].id;
      expect(targetRequestId).toBeDefined();

      // 2. 1人目 (Player A) が PASS を選択
      expect(step2.type).toBe("WAITING_FOR_DECISION");
      if (step2.type !== "WAITING_FOR_DECISION") return;
      const p1PassIdx = step2.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(p1PassIdx).toBeGreaterThanOrEqual(0);

      const step3 = originalSession.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: p1PassIdx,
      });

      // 49.F: 1人目の PASS により、consecutivePassCount = 1、チャンスが Player B へ移動
      expect(originalSession.passTracker.consecutivePassCount).toBe(1);
      expect(originalSession.state.chancePlayer).toBe("p2");

      // Stage depth が維持されており、TOP Request が未解決のまま残っていることを assert
      expect(originalSession.state.stage.requests.length).toBe(initialStageDepth);
      expect(
        originalSession.state.stage.requests[originalSession.state.stage.requests.length - 1].id
      ).toBe(targetRequestId);

      // 49.F: この「Stage 上に Request が存在し、consecutivePassCount = 1」の状態で Snapshot 取得
      const snapshot = originalSession.createSnapshot();
      expect(snapshot.session.consecutivePassCount).toBe(1);
      expect(snapshot.gameState.stage.requests.length).toBe(initialStageDepth);

      // 49.G: Snapshot からセッションを復元
      const restoredSession = GameSession.fromSnapshot(snapshot, playtestRulePackage);

      // Restore 直後の状態検証
      expect(restoredSession.passTracker.consecutivePassCount).toBe(1);
      expect(restoredSession.state.stage.requests.length).toBe(initialStageDepth);
      expect(
        restoredSession.state.stage.requests[restoredSession.state.stage.requests.length - 1].id
      ).toBe(targetRequestId);
      expect(restoredSession.state.chancePlayer).toBe("p2");
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));

      // 49.H: 両セッションで 2 人目 (Player B) が PASS を選択
      expect(step3.type).toBe("WAITING_FOR_DECISION");
      if (step3.type !== "WAITING_FOR_DECISION") return;
      const step3ReqOrig = step3.request;
      const step3ReqRest = restoredSession.pendingDecision!;

      const p2PassIdxOrig = step3ReqOrig.patterns.findIndex((p) => p.kind === "PASS");
      const p2PassIdxRest = step3ReqRest.patterns.findIndex((p) => p.kind === "PASS");
      expect(p2PassIdxOrig).toBe(p2PassIdxRest);
      expect(p2PassIdxOrig).toBeGreaterThanOrEqual(0);

      const origResult = originalSession.submitDecision({
        decisionId: step3ReqOrig.decisionId,
        stateVersion: step3ReqOrig.stateVersion,
        selectedPatternRef: p2PassIdxOrig,
      });

      const restResult = restoredSession.submitDecision({
        decisionId: step3ReqRest.decisionId,
        stateVersion: step3ReqRest.stateVersion,
        selectedPatternRef: p2PassIdxRest,
      });

      // 49.H: 全員連続 PASS 成立により、Stage TOP Request (targetRequestId) の解決が実際にトリガーされたことを検証
      // passTracker はリセットされて 0 に戻る
      expect(originalSession.passTracker.consecutivePassCount).toBe(0);
      expect(restoredSession.passTracker.consecutivePassCount).toBe(0);

      // Stage TOP Request の解決が開始され、EFFECT_RESOLUTION 待機状態に入っていること
      expect(origResult.type).toBe("WAITING_FOR_DECISION");
      expect(restResult.type).toBe("WAITING_FOR_DECISION");
      if (origResult.type === "WAITING_FOR_DECISION" && restResult.type === "WAITING_FOR_DECISION") {
        expect(origResult.request.source.type).toBe("EFFECT_RESOLUTION");
        expect(restResult.request.source.type).toBe("EFFECT_RESOLUTION");
        expect((origResult.request.source as any).sourceRequestRef).toBe(targetRequestId);
        expect((restResult.request.source as any).sourceRequestRef).toBe(targetRequestId);
      }

      // 49.I: Original / Restored で State Hash、turnPlayer、chancePlayer、GameSessionStep.type が完全一致
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));
      expect(restoredSession.state.turnPlayer).toBe(originalSession.state.turnPlayer);
      expect(restoredSession.state.chancePlayer).toBe(originalSession.state.chancePlayer);
      expect(restResult.type).toBe(origResult.type);

      // さらに両方のセッションで効果選択を実行し、最後まで解決を進めて一致することを確認
      const policy = new FirstLegalPolicy();
      if (origResult.type === "WAITING_FOR_DECISION" && restResult.type === "WAITING_FOR_DECISION") {
        const origEffResp = policy.choose(origResult.request);
        const restEffResp = policy.choose(restResult.request);

        const origStepFinal = originalSession.submitDecision(origEffResp);
        const restStepFinal = restoredSession.submitDecision(restEffResp);

        expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));
        expect(restStepFinal.type).toBe(origStepFinal.type);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. Real EFFECT_SELECTION (Multi-step Resolution) Resume Tests
  // --------------------------------------------------------------------------
  describe("Real EFFECT_SELECTION Resolution Interruption & Resume", () => {
    it("captures snapshot during EFFECT_SELECTION and successfully resumes multi-step effect resolution", () => {
      const state = createCoreBattlePresetState();
      const originalSession = new GameSession(state, playtestRulePackage, { matchId: "match-eff-003" });

      // EFFECT_SELECTION に到達するまでゲームを進行
      let effectStepReached = false;
      const policy = new FirstLegalPolicy();

      for (let s = 0; s < 100; s++) {
        const step = originalSession.advance();
        if (step.type === "WAITING_FOR_DECISION") {
          if (step.request.source.type === "EFFECT_RESOLUTION") {
            effectStepReached = true;
            break;
          }
          originalSession.submitDecision(policy.choose(step.request));
        } else if (step.type === "FINISHED") {
          break;
        }
      }

      expect(effectStepReached).toBe(true);
      expect(originalSession.pendingDecision?.source.type).toBe("EFFECT_RESOLUTION");
      expect(originalSession.continuation).toBeDefined();

      // EFFECT_SELECTION 待機状態で Snapshot 取得
      const snapshot = originalSession.createSnapshot();
      expect(snapshot.session.continuation).toBeDefined();
      expect(snapshot.session.resolvingContext).toBeDefined();

      // Snapshot から復元
      const restoredSession = GameSession.fromSnapshot(snapshot, playtestRulePackage);
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));
      expect(restoredSession.continuation).toBeDefined();
      expect(restoredSession.resolvingContext).toBeDefined();

      // 両セッションに同一の Effect Selection を適用
      const origReq = originalSession.pendingDecision!;
      const restReq = restoredSession.pendingDecision!;

      const origResp = policy.choose(origReq);
      const restResp = policy.choose(restReq);

      const origStepAfter = originalSession.submitDecision(origResp);
      const restStepAfter = restoredSession.submitDecision(restResp);

      // 効果解決後の状態が完全一致すること
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));
      expect(restStepAfter.type).toBe(origStepAfter.type);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Match Log Continuation & Deduplication Tests
  // --------------------------------------------------------------------------
  describe("Canonical Match Log Continuation & No Duplicate match.started", () => {
    it("preserves match log prefix and appends new events without duplicate match.started", () => {
      const state = createCoreBattlePresetState();
      const originalSession = new GameSession(state, playtestRulePackage, { matchId: "match-log-004" });
      const step1 = originalSession.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");

      // 1手進める
      const policy = new FirstLegalPolicy();
      originalSession.submitDecision(policy.choose(originalSession.pendingDecision!));
      originalSession.advance();

      const logBefore = originalSession.getMatchLog();
      const eventCountBefore = logBefore.events.length;
      expect(eventCountBefore).toBeGreaterThan(0);

      // Snapshot 取得 & 復元
      const snapshot = originalSession.createSnapshot();
      const restoredSession = GameSession.fromSnapshot(snapshot, playtestRulePackage);

      // 復元直後のログ検証
      const logAfterRestore = restoredSession.getMatchLog();
      expect(logAfterRestore.events.length).toBe(eventCountBefore);
      expect(logAfterRestore.events).toEqual(logBefore.events);

      // 復元セッションをさらに 1 手進める
      restoredSession.submitDecision(policy.choose(restoredSession.pendingDecision!));
      restoredSession.advance();

      const logAfterProgress = restoredSession.getMatchLog();
      expect(logAfterProgress.events.length).toBeGreaterThan(eventCountBefore);

      // match.started イベントが重複して記録されていないこと (1回のみ)
      const matchStartedEvents = logAfterProgress.events.filter((e) => e.type === "match.started");
      expect(matchStartedEvents.length).toBe(1);

      // イベント sequence が単調増加であること
      for (let i = 0; i < logAfterProgress.events.length; i++) {
        expect(logAfterProgress.events[i].seq).toBe(i + 1);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. Deep Isolation & Branching (What-if) Tests
  // --------------------------------------------------------------------------
  describe("Snapshot Deep Isolation & Branching (What-if)", () => {
    it("restores multiple independent sessions from a single snapshot and branches them without mutual state contamination", () => {
      const state = createCoreBattlePresetState();
      const baseSession = new GameSession(state, playtestRulePackage, { matchId: "match-branch-005" });
      baseSession.advance();

      // Snapshot 取得
      const snapshot = baseSession.createSnapshot();
      const snapshotJson = JSON.stringify(snapshot);

      // 2 つの独立したセッションを復元
      const sessionA = GameSession.fromSnapshot(snapshot, playtestRulePackage);
      const sessionB = GameSession.fromSnapshot(snapshot, playtestRulePackage);

      expect(StateHasher.hash(sessionA.state)).toBe(StateHasher.hash(sessionB.state));

      // Session A と Session B で異なる合法手を選択（分岐）
      const reqA = sessionA.pendingDecision!;
      const reqB = sessionB.pendingDecision!;

      // 選択肢が2つ以上存在することを確認
      expect(reqA.patterns.length).toBeGreaterThan(1);

      const choiceA = {
        decisionId: reqA.decisionId,
        stateVersion: reqA.stateVersion,
        selectedPatternRef: 0,
      };
      const choiceB = {
        decisionId: reqB.decisionId,
        stateVersion: reqB.stateVersion,
        selectedPatternRef: reqB.patterns.length - 1, // 異なる手 (例: PASS)
      };

      sessionA.submitDecision(choiceA);
      sessionA.advance();

      sessionB.submitDecision(choiceB);
      sessionB.advance();

      // 分岐後、Session A と Session B の State Hash が異なること
      expect(StateHasher.hash(sessionA.state)).not.toBe(StateHasher.hash(sessionB.state));

      // 元の Snapshot オブジェクトが一切変更・汚染されていないこと
      expect(JSON.stringify(snapshot)).toBe(snapshotJson);
    });
  });
});
