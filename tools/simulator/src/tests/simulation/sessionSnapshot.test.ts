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

describe("Match Snapshot & Session Resume Foundation Tests (BP-SIM-AI-1.2-20260904-1813)", () => {
  let playtestRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    playtestRulePackage = getPlaytestRulePackage(fullPackage);
  });

  // --------------------------------------------------------------------------
  // 1. JSON Round-Trip, Format Version & Metadata Tests
  // --------------------------------------------------------------------------
  describe("Snapshot Format, Serialization & Hash Validation", () => {
    it("captures, serializes and deserializes snapshot with JSON round-trip (Version 1)", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage, { matchId: "test-match-123" });
      session.advance(); // WAITING_FOR_DECISION

      const snapshot = session.createSnapshot();

      // Version 1
      expect(snapshot.snapshotFormatVersion).toBe(SNAPSHOT_FORMAT_VERSION);
      expect(snapshot.snapshotFormatVersion).toBe(1);

      // Metadata
      expect(snapshot.metadata.matchId).toBe("test-match-123");
      expect(snapshot.metadata.rulesVersion).toBeDefined();

      // State Hash v2
      expect(snapshot.gameStateHash).toBeDefined();
      expect(snapshot.gameStateHash.startsWith("sh2-")).toBe(true);
      expect(snapshot.gameStateHash).toBe(StateHasher.hash(session.state));

      // JSON Round-Trip
      const jsonString = GameSessionSnapshotCodec.serialize(snapshot);
      expect(typeof jsonString).toBe("string");

      const deserialized = GameSessionSnapshotCodec.deserialize(jsonString);
      expect(deserialized).toEqual(snapshot);

      // Restore
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
  // 3. Consecutive PASS Resume Tests
  // --------------------------------------------------------------------------
  describe("Consecutive PASS & Stage Top Resolution Resume", () => {
    it("preserves consecutivePassCount=1 across snapshot and triggers Stage TOP resolution on second PASS", () => {
      const state = createCoreBattlePresetState();
      const originalSession = new GameSession(state, playtestRulePackage, { matchId: "match-pass-002" });

      // Step 1: 1回目の判断待ち (Player A の手番)
      const step1 = originalSession.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      if (step1.type !== "WAITING_FOR_DECISION") return;

      // PASS のインデックスを検索して PASS を適用
      const passIdx = step1.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(passIdx).toBeGreaterThanOrEqual(0);
      originalSession.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: passIdx,
      });

      // Step 2: チャンスが Player B に移動し、consecutivePassCount = 1 の状態で WAITING_FOR_DECISION
      const step2 = originalSession.advance();
      expect(step2.type).toBe("WAITING_FOR_DECISION");
      expect(originalSession.passTracker.consecutivePassCount).toBe(1);

      // この consecutivePassCount = 1 の状態で Snapshot 取得
      const snapshot = originalSession.createSnapshot();
      expect(snapshot.session.consecutivePassCount).toBe(1);

      // Snapshot からセッションを復元
      const restoredSession = GameSession.fromSnapshot(snapshot, playtestRulePackage);
      expect(restoredSession.passTracker.consecutivePassCount).toBe(1);
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));

      // 両セッションで 2 回目の PASS を適用
      const step2ReqOrig = originalSession.pendingDecision!;
      const step2ReqRest = restoredSession.pendingDecision!;

      const pass2IdxOrig = step2ReqOrig.patterns.findIndex((p) => p.kind === "PASS");
      const pass2IdxRest = step2ReqRest.patterns.findIndex((p) => p.kind === "PASS");
      expect(pass2IdxOrig).toBe(pass2IdxRest);

      const origResult = originalSession.submitDecision({
        decisionId: step2ReqOrig.decisionId,
        stateVersion: step2ReqOrig.stateVersion,
        selectedPatternRef: pass2IdxOrig,
      });

      const restResult = restoredSession.submitDecision({
        decisionId: step2ReqRest.decisionId,
        stateVersion: step2ReqRest.stateVersion,
        selectedPatternRef: pass2IdxRest,
      });

      // 2人連続 PASS により Stage TOP が解決され、結果の State Hash とターン/チャンスプレイヤーが完全一致
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));
      expect(restoredSession.state.turnPlayer).toBe(originalSession.state.turnPlayer);
      expect(restoredSession.state.chancePlayer).toBe(originalSession.state.chancePlayer);
      expect(restResult.type).toBe(origResult.type);
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
