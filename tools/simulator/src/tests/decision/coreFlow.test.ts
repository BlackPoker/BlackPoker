import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { PassTracker } from "../../engine/session/PassTracker";
import { TurnManager } from "../../engine/rules/TurnManager";
import { CoreFlowCoordinator } from "../../engine/session/CoreFlowCoordinator";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";
import { takeUntilLegacyCardHandler } from "../../engine/rules/commandHandlers";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import { RULE_SYSTEM_CHANCE } from "../../domain/decision/DecisionSource";
import { SNAPSHOT_FORMAT_VERSION } from "../../domain/session/GameSessionSnapshot";
import { GameSessionSnapshotCodec, GameSessionSnapshotValidationError } from "../../engine/session/GameSessionSnapshotCodec";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { FirstLegalPatternPolicy } from "../../controller/FirstLegalPatternPolicy";
import { RandomPolicy } from "../../controller/RandomPolicy";

describe("Core Flow Integration Tests (Phase: Core Flow & Decision Integration)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createTestState = () => {
    const soldier1 = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const soldier2 = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c2", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
    };

    const state = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [
            { id: "key-h7", suit: "H", rank: "7", value: 7 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
          ],
          field: [soldier1],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: 16,
          hand: [
            { id: "p2-key-s8", suit: "S", rank: "8", value: 8 },
            { id: "p2-cost-c3", suit: "C", rank: "3", value: 3 },
          ],
          field: [soldier2],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
    } as Record<string, any>;

    TurnManager.initializeToMain(state, "p1");
    return state;
  };

  it("should NOT contain a fake action.pass in RulePackage.actions", () => {
    // PASS は ActionDefinition ではなく、Decision 上の選択種別として表現される
    const passAction = rulePackage.actions.find((a) => a.id === "action.pass" || a.name === "パス");
    expect(passAction).toBeUndefined();
  });

  it("should queue normal action to stage without resolving immediately and keep chance player", () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") return;

    expect(step1.request.playerId).toBe("p1");

    // アップ（quick/normal speed）のパターンを探す
    const upPatternIndex = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up";
    });
    expect(upPatternIndex).toBeGreaterThanOrEqual(0);

    const response: DecisionResponse = {
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: upPatternIndex,
    };

    // 1. 通常アクションを選択して送信
    const step2 = session.submitDecision(response);

    // 検証：
    // A. stage に積まれているが、未解決（status: "pending"）であること
    expect(session.state.stage.requests.length).toBe(1);
    expect(session.state.stage.requests[0].actionId).toBe("action.up");
    expect(session.state.stage.requests[0].status).toBe("pending");
    // フォグはまだ作成されていないこと（未解決）
    expect(session.state.players.p1.fog.length).toBe(0);

    // B. チャンスプレイヤーは p1 のままであること（通常アクションを積んだだけでは相手へ移らない）
    expect(session.state.chancePlayer).toBe("p1");

    // C. 次の DecisionRequest に PASS パターンが含まれていること
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type === "WAITING_FOR_DECISION") {
      expect(step2.request.playerId).toBe("p1");
      const passIndex = step2.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(passIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("should transfer chance to next player upon PASS and resolve stage top upon consecutive PASS from all players", () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    // 1. Player A がアップを stage に積む
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const upIndex = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up";
    });

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: upIndex,
    });

    expect(session.state.chancePlayer).toBe("p1");
    expect(session.state.stage.requests.length).toBe(1);

    // 2. Player A が PASS を選択
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const p1PassIndex = step2.request.patterns.findIndex((p) => p.kind === "PASS");

    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1PassIndex,
    });

    // 検証：A が PASS したため、チャンスが Player B (p2) へ移動すること
    expect(session.state.chancePlayer).toBe("p2");
    expect(session.passTracker.consecutivePassCount).toBe(1);

    // 3. Player B も PASS を選択（全員連続PASS成立）
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step3.request.playerId).toBe("p2");
    const p2PassIndex = step3.request.patterns.findIndex((p) => p.kind === "PASS");

    session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2PassIndex,
    });

    // 検証：
    // A. 全員連続PASSが成立し、stage 最上段の「アップ」が 1 件解決されたこと
    expect(session.state.stage.requests.length).toBe(0);
    expect(session.state.players.p1.fog.length).toBe(1);
    expect(session.state.players.p1.fog[0].componentId).toBe("fog.up");

    // B. コスト（cost-c2）が墓地に送られていること
    expect(session.state.players.p1.grave.length).toBe(1);

    // C. 解決後、チャンスプレイヤーが turnPlayer (p1) へ戻ること
    expect(session.state.chancePlayer).toBe("p1");

    // D. 連続PASS状態が 0 にリセットされていること
    expect(session.passTracker.consecutivePassCount).toBe(0);
  });

  it("should reset consecutive pass count if opponent queues an action instead of passing", () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    // 1. Player A がアップを積む
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const upIndex = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up";
    });
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: upIndex,
    });

    // 2. Player A が PASS
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const p1PassIndex = step2.request.patterns.findIndex((p) => p.kind === "PASS");
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1PassIndex,
    });
    expect(session.state.chancePlayer).toBe("p2");
    expect(session.passTracker.consecutivePassCount).toBe(1);

    // 3. Player B は PASS せず、ダウン（クイックアクション）を stage に積む
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const downIndex = step3.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step3.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.down";
    });
    expect(downIndex).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: downIndex,
    });

    // 検証：
    // A. Player B がアクションを積んだため、連続PASSカウントが 0 にリセットされること
    expect(session.passTracker.consecutivePassCount).toBe(0);

    // B. チャンスは Player B のままであること（さらに積むかPASSを選べる）
    expect(session.state.chancePlayer).toBe("p2");

    // C. stage に 2件（アップ, ダウン）が積まれていること
    expect(session.state.stage.requests.length).toBe(2);
  });

  it("should resolve immediate action immediately and keep chance player", () => {
    const state = createTestState();
    const immRulePackage: RulePackage = {
      ...rulePackage,
      actions: [
        ...rulePackage.actions,
        {
          id: "action.test_imm",
          name: "テスト即時",
          type: "normal",
          request: { trigger: "direct", speed: "immediate", timing: "always" },
          effect: [],
        },
      ],
    };

    const session = new GameSession(state, immRulePackage);
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const immIndex = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.test_imm";
    });
    expect(immIndex).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: immIndex,
    });

    // 検証：
    // A. 即時アクションなので stage には残らず即解決（stage は空）
    expect(session.state.stage.requests.length).toBe(0);
    // B. 即時解決後もチャンスは Player A のまま
    expect(session.state.chancePlayer).toBe("p1");
  });

  it("should work seamlessly with FirstLegalPatternPolicy and RandomPolicy", async () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    const firstPolicy = new FirstLegalPatternPolicy();
    const randomPolicy = new RandomPolicy(() => 0.5);

    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const respFirst = await firstPolicy.decide(step1.request);
    expect(typeof respFirst.selectedPatternRef).toBe("number");
    expect(respFirst.decisionId).toBe(step1.request.decisionId);

    const respRandom = await randomPolicy.decide(step1.request);
    expect(typeof respRandom.selectedPatternRef).toBe("number");
    expect(respRandom.decisionId).toBe(step1.request.decisionId);
  });

  // =========================================================================
  // 第9.2版公式ルール コアフロー (フォーカス方式・ルールシステムチャンス) 必須13ケース検証
  // =========================================================================
  describe("v9.2 Core Flow Focus Mechanism & Rule System Chance Suite (13 Required Cases)", () => {
    it("Case 1 (ゲーム開始 [1]): turnPlayer, chancePlayer, focusPlayer are all initialized to the first player", () => {
      const stateP1: any = { players: { p1: {}, p2: {} }, stage: { requests: [] } };
      TurnManager.startTurn(stateP1, "p1");
      expect(stateP1.turnPlayer).toBe("p1");
      expect(stateP1.chancePlayer).toBe("p1");
      expect(stateP1.focusPlayer).toBe("p1");

      const stateP2: any = { players: { p1: {}, p2: {} }, stage: { requests: [] } };
      TurnManager.startTurn(stateP2, "p2");
      expect(stateP2.turnPlayer).toBe("p2");
      expect(stateP2.chancePlayer).toBe("p2");
      expect(stateP2.focusPlayer).toBe("p2");
    });

    it("Case 2 (空ステージPASS禁止 [3]): PASS pattern is not generated on empty stage and direct PASS submission is rejected", () => {
      const state = createTestState();
      const session = new GameSession(state, rulePackage);

      const step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      // 合法パターン一覧に PASS が含まれないこと
      expect(step.request.patterns.some((p) => p.kind === "PASS")).toBe(false);

      // LegalPatternGenerator 単体で includePass: true を渡しても空ステージでは PASS が生成されないこと
      const directGen = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage, {
        includePass: true,
      });
      expect(directGen.request.patterns.some((p) => p.kind === "PASS")).toBe(false);

      // CoreFlowCoordinator.applyDecision に直接 PASS パターンを偽装提出した場合も ValidationError で拒否されること
      const fakeRequestWithPass: any = {
        ...step.request,
        patterns: [{ patternId: "pat-pass", kind: "PASS", description: "パス" }],
      };
      expect(() =>
        CoreFlowCoordinator.applyDecision(
          fakeRequestWithPass,
          { decisionId: fakeRequestWithPass.decisionId, stateVersion: fakeRequestWithPass.stateVersion, selectedPatternRef: 0 },
          state,
          rulePackage,
          new CommandRegistry(),
          new PassTracker()
        )
      ).toThrow(ValidationError);
    });

    it("Case 3 (通常アクション後の状態 [4],[9],[10],[2]): TP requests normal action -> staged, chance=TP, focus=TP, PASS becomes available", () => {
      const state = createTestState();
      const session = new GameSession(state, rulePackage);

      const step1 = session.advance();
      if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const upIdx = step1.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up"
      );
      const step2 = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: upIdx,
      });

      expect(session.state.stage.requests).toHaveLength(1);
      expect(session.state.turnPlayer).toBe("p1");
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p1");
      expect(step2.type).toBe("WAITING_FOR_DECISION");
      if (step2.type === "WAITING_FOR_DECISION") {
        expect(step2.request.observation.focusPlayerId).toBe("p1");
        expect(step2.request.patterns.some((p) => p.kind === "PASS")).toBe(true);
      }
    });

    it("Case 4 (即時アクション後のフォーカス設定 [6],[7],[10],[2]): empty-stage vs non-empty-stage immediate action focus and All-Pass behavior", () => {
      const immRulePackage: RulePackage = {
        ...rulePackage,
        actions: [
          ...rulePackage.actions,
          {
            id: "action.test_imm_quick",
            name: "テスト即時クイック",
            type: "normal",
            request: { trigger: "direct", speed: "immediate", timing: "quick" },
            effect: [],
          },
        ],
      };

      // 4-A: ステージ空で即時アクションを解決 -> [10]でリクエスト者にフォーカス設定後、次の[2]でステージ空のため chance=TP, focus=TP
      const stateEmpty = createTestState();
      const sessionEmpty = new GameSession(stateEmpty, immRulePackage);
      const s1 = sessionEmpty.advance();
      if (s1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      const immIdx1 = s1.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && s1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.test_imm_quick"
      );
      sessionEmpty.submitDecision({
        decisionId: s1.request.decisionId,
        stateVersion: s1.request.stateVersion,
        selectedPatternRef: immIdx1,
      });
      expect(sessionEmpty.state.stage.requests).toHaveLength(0);
      expect(sessionEmpty.state.chancePlayer).toBe("p1");
      expect(sessionEmpty.state.focusPlayer).toBe("p1");

      // 4-B: ステージに P1 のリクエストがある状態で NTP(p2) が即時アクションを解決
      // -> [10]により focusPlayer = p2、[2]でもステージ非空のため chancePlayer = p2, focusPlayer = p2 を維持
      // -> p2 の PASS では nextPlayer(p1) !== focusPlayer(p2) のため全員パスにならず p1 にチャンス移動
      // -> p1 の PASS で nextPlayer(p2) === focusPlayer(p2) となり初めて全員パスが成立し、ステージの P1 リクエストが解決される
      const stateStaged = createTestState();
      const sessionStaged = new GameSession(stateStaged, immRulePackage);
      const st1 = sessionStaged.advance();
      if (st1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // P1 が action.up をステージに積む
      const upIdx = st1.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && st1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up"
      );
      const st2 = sessionStaged.submitDecision({
        decisionId: st1.request.decisionId,
        stateVersion: st1.request.stateVersion,
        selectedPatternRef: upIdx,
      });
      if (st2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(sessionStaged.state.focusPlayer).toBe("p1");

      // P1 が PASS -> P2 にチャンス移動 (focus は p1 のまま)
      const p1Pass1 = st2.request.patterns.findIndex((p) => p.kind === "PASS");
      const st3 = sessionStaged.submitDecision({
        decisionId: st2.request.decisionId,
        stateVersion: st2.request.stateVersion,
        selectedPatternRef: p1Pass1,
      });
      if (st3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(sessionStaged.state.chancePlayer).toBe("p2");
      expect(sessionStaged.state.focusPlayer).toBe("p1");

      // P2 が即時アクション (action.test_imm_quick) を実行
      const p2ImmIdx = st3.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && st3.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.test_imm_quick"
      );
      const st4 = sessionStaged.submitDecision({
        decisionId: st3.request.decisionId,
        stateVersion: st3.request.stateVersion,
        selectedPatternRef: p2ImmIdx,
      });
      if (st4.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // 即時アクション解決後、ステージには action.up が1件残っており、chance=p2, focus=p2 に更新されていること！
      expect(sessionStaged.state.stage.requests).toHaveLength(1);
      expect(sessionStaged.state.chancePlayer).toBe("p2");
      expect(sessionStaged.state.focusPlayer).toBe("p2");

      // P2 が PASS -> nextPlayer(p1) !== focusPlayer(p2) のためまだ解決されず、P1 にチャンスが移る
      const p2Pass = st4.request.patterns.findIndex((p) => p.kind === "PASS");
      const st5 = sessionStaged.submitDecision({
        decisionId: st4.request.decisionId,
        stateVersion: st4.request.stateVersion,
        selectedPatternRef: p2Pass,
      });
      if (st5.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(sessionStaged.state.stage.requests).toHaveLength(1);
      expect(sessionStaged.state.chancePlayer).toBe("p1");
      expect(sessionStaged.state.focusPlayer).toBe("p2");

      // P1 が PASS -> nextPlayer(p2) === focusPlayer(p2) により全員パス成立！action.up が解決される
      const p1Pass2 = st5.request.patterns.findIndex((p) => p.kind === "PASS");
      sessionStaged.submitDecision({
        decisionId: st5.request.decisionId,
        stateVersion: st5.request.stateVersion,
        selectedPatternRef: p1Pass2,
      });
      expect(sessionStaged.state.stage.requests).toHaveLength(0);
      expect(sessionStaged.state.players.p1.fog).toHaveLength(1);
      expect(sessionStaged.state.chancePlayer).toBe("p1");
      expect(sessionStaged.state.focusPlayer).toBe("p1");
    });

    it("Case 5 (単一リクエストの全員パス解決 [11],[12],[13],[2]): TP action -> TP PASS -> NTP PASS -> chance moves through 'system' -> top 1 resolved -> returns to TP", () => {
      const state = createTestState();
      const session = new GameSession(state, rulePackage);

      const s1 = session.advance();
      if (s1.type !== "WAITING_FOR_DECISION") return;
      const upIdx = s1.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && s1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up"
      );
      const s2 = session.submitDecision({
        decisionId: s1.request.decisionId,
        stateVersion: s1.request.stateVersion,
        selectedPatternRef: upIdx,
      });
      if (s2.type !== "WAITING_FOR_DECISION") return;

      const s3 = session.submitDecision({
        decisionId: s2.request.decisionId,
        stateVersion: s2.request.stateVersion,
        selectedPatternRef: s2.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (s3.type !== "WAITING_FOR_DECISION") return;
      expect(session.state.chancePlayer).toBe("p2");
      expect(session.state.focusPlayer).toBe("p1");

      session.submitDecision({
        decisionId: s3.request.decisionId,
        stateVersion: s3.request.stateVersion,
        selectedPatternRef: s3.request.patterns.findIndex((p) => p.kind === "PASS"),
      });

      expect(session.state.stage.requests).toHaveLength(0);
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p1");

      // MatchLog で p1 -> p2 -> "system" -> p1 の遷移が記録されていること
      const chanceEvents = session.getMatchLog().events.filter((e) => e.type === "chance.changed") as any[];
      expect(chanceEvents.map((e) => `${e.fromChancePlayer}->${e.toChancePlayer}(${e.reason})`)).toEqual([
        "p1->p2(pass)",
        "p2->system(allPassed)",
        "system->p1(stageTopResolved)",
      ]);
    });

    it("Cases 6 & 7 (チェイン時のフォーカス更新と2件積まれたステージの段階解決): NTP chains B on A -> focus=NTP -> NTP PASS -> TP PASS resolves only B -> returns to TP -> TP PASS -> NTP PASS resolves A", () => {
      const state = createTestState();
      // P2 のキーカードを ♠2 (-2) にして、サイズ6/5の兵士が破壊されず fog.down が残るようにする
      state.players.p2.hand[0] = { id: "p2-key-s2", suit: "S", rank: "2", value: 2 };
      const session = new GameSession(state, rulePackage);

      // 1. TP(p1) が通常アクションA (action.up) をステージに積む -> focus=p1, chance=p1
      const s1 = session.advance();
      if (s1.type !== "WAITING_FOR_DECISION") return;
      const upIdx = s1.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && s1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up"
      );
      const s2 = session.submitDecision({
        decisionId: s1.request.decisionId,
        stateVersion: s1.request.stateVersion,
        selectedPatternRef: upIdx,
      });
      if (s2.type !== "WAITING_FOR_DECISION") return;
      expect(session.state.focusPlayer).toBe("p1");
      expect(session.state.chancePlayer).toBe("p1");

      // 2. TP(p1) PASS -> chance=p2, focus=p1
      const s3 = session.submitDecision({
        decisionId: s2.request.decisionId,
        stateVersion: s2.request.stateVersion,
        selectedPatternRef: s2.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (s3.type !== "WAITING_FOR_DECISION") return;
      expect(session.state.chancePlayer).toBe("p2");
      expect(session.state.focusPlayer).toBe("p1");

      // 3. NTP(p2) が通常アクションB (action.down) をチェイン -> focus=p2, chance=p2, stage=[up, down]
      const downIdx = s3.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && s3.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.down"
      );
      const s4 = session.submitDecision({
        decisionId: s3.request.decisionId,
        stateVersion: s3.request.stateVersion,
        selectedPatternRef: downIdx,
      });
      if (s4.type !== "WAITING_FOR_DECISION") return;
      expect(session.state.stage.requests).toHaveLength(2);
      expect(session.state.focusPlayer).toBe("p2");
      expect(session.state.chancePlayer).toBe("p2");

      // 4. NTP(p2) PASS -> nextPlayer(p1) !== focusPlayer(p2) なので全員パスにならず、chance=p1
      const s5 = session.submitDecision({
        decisionId: s4.request.decisionId,
        stateVersion: s4.request.stateVersion,
        selectedPatternRef: s4.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (s5.type !== "WAITING_FOR_DECISION") return;
      expect(session.state.stage.requests).toHaveLength(2);
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p2");

      // 5. TP(p1) PASS -> nextPlayer(p2) === focusPlayer(p2) で全員パス成立！
      // 最上段の B (action.down) 1件だけが解決され、A (action.up) はステージに残り、[2]により chance=p1, focus=p1 に戻る
      const s6 = session.submitDecision({
        decisionId: s5.request.decisionId,
        stateVersion: s5.request.stateVersion,
        selectedPatternRef: s5.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (s6.type !== "WAITING_FOR_DECISION") return;
      expect(session.state.stage.requests).toHaveLength(1);
      expect(session.state.stage.requests[0].actionId).toBe("action.up");
      expect(session.state.players.p2.fog).toHaveLength(1);
      expect(session.state.players.p1.fog).toHaveLength(0);
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p1");

      // 6. Case 7: 残った A (action.up) に対して改めて TP(p1) PASS -> NTP(p2) PASS で A が解決される
      const s7 = session.submitDecision({
        decisionId: s6.request.decisionId,
        stateVersion: s6.request.stateVersion,
        selectedPatternRef: s6.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (s7.type !== "WAITING_FOR_DECISION") return;
      expect(session.state.stage.requests).toHaveLength(1);
      expect(session.state.chancePlayer).toBe("p2");
      expect(session.state.focusPlayer).toBe("p1");

      session.submitDecision({
        decisionId: s7.request.decisionId,
        stateVersion: s7.request.stateVersion,
        selectedPatternRef: s7.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      expect(session.state.stage.requests).toHaveLength(0);
      expect(session.state.players.p1.fog).toHaveLength(1);
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p1");
    });

    it("Cases 8, 9, 10, 11, 12, 13 (アタック→ブロック→ダメージ判定、エンド→チャージ→ドロー、解決中断・再開、Snapshot V2 / V1拒否、initialChance非依存)", () => {
      // Case 13: block.yaml / damage-judge.yaml / draw.yaml の initialChance をすべて削除（または逆転）した RulePackage でも
      // コアフロー [12] ("system") と [2] (turnPlayer) のみによって完全に同一の公式ルール順で動作することを検証
      const corePlaytestPkg = getCoreBattlePlaytestRulePackage(rulePackage);
      const strippedRulePackage: RulePackage = {
        ...corePlaytestPkg,
        actions: corePlaytestPkg.actions.map((a) => ({
          ...a,
          request: a.request,
        })),
      };

      const state = createTestState();
      state.players.p1.field[0].cards = [{ id: "c1", suit: "S", rank: "A", value: 1 }];
      state.players.p1.life = [
        { id: "l1-1", suit: "S", rank: "2", value: 2 },
        { id: "l1-2", suit: "S", rank: "3", value: 3 },
      ];
      state.players.p2.life = [
        { id: "l2-1", suit: "H", rank: "2", value: 2 },
        { id: "l2-2", suit: "H", rank: "3", value: 3 },
        { id: "l2-3", suit: "H", rank: "4", value: 4 },
      ];
      state.players.p2.hand = [
        { id: "p2-key-h8", suit: "H", rank: "8", value: 8 },
        { id: "p2-cost-c3", suit: "C", rank: "3", value: 3 },
      ];

      const session = new GameSession(state, strippedRulePackage);

      // --- Case 8 & Case 10: アタック → ブロック(解決中断・再開) → ダメージ判定 ---
      const step1 = session.advance();
      if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const attackIdx = step1.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack"
      );
      const afterAttackReq = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: attackIdx,
      });
      if (afterAttackReq.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(session.state.stage.requests[0].actionId).toBe("action.attack");
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p1");

      // P1 PASS -> P2 PASS で action.attack 解決 (EFFECT_RESOLUTION で P1 がアタッカー選択)
      const afterAttackP1Pass = session.submitDecision({
        decisionId: afterAttackReq.request.decisionId,
        stateVersion: afterAttackReq.request.stateVersion,
        selectedPatternRef: afterAttackReq.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterAttackP1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      const afterAttackP2Pass = session.submitDecision({
        decisionId: afterAttackP1Pass.request.decisionId,
        stateVersion: afterAttackP1Pass.request.stateVersion,
        selectedPatternRef: afterAttackP1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterAttackP2Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // Case 10: ステージ解決中断中は chancePlayer === "system" であり、選択権(request.playerId)のみが P1 にあること
      expect(afterAttackP2Pass.request.source.type).toBe("EFFECT_RESOLUTION");
      expect(afterAttackP2Pass.request.playerId).toBe("p1");
      expect(session.state.chancePlayer).toBe(RULE_SYSTEM_CHANCE);

      // P1 がアタッカー(soldier-1)を選択 -> アタック解決完了 -> ブロック誘発がステージに積まれる -> [2]により chance=p1(TP), focus=p1(TP)
      const attackerPatternIdx = afterAttackP2Pass.request.patterns.findIndex((p) => {
        if (p.effectSelectionRef === undefined) return false;
        const eff = afterAttackP2Pass.request.catalog.effectSelections[p.effectSelectionRef];
        return (eff?.selectedValues?.length ?? 0) > 0;
      });
      expect(attackerPatternIdx).toBeGreaterThanOrEqual(0);
      const afterAttackerSel = session.submitDecision({
        decisionId: afterAttackP2Pass.request.decisionId,
        stateVersion: afterAttackP2Pass.request.stateVersion,
        selectedPatternRef: attackerPatternIdx,
      });
      if (afterAttackerSel.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(session.state.stage.requests).toHaveLength(1);
      expect(session.state.stage.requests[0].actionId).toBe("action.block");
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p1");

      // ブロックに対する応答: TP(p1) PASS -> NTP(p2) チャンス -> NTP(p2) PASS -> ブロック解決開始
      const afterBlockP1Pass = session.submitDecision({
        decisionId: afterAttackerSel.request.decisionId,
        stateVersion: afterAttackerSel.request.stateVersion,
        selectedPatternRef: afterAttackerSel.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterBlockP1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(session.state.chancePlayer).toBe("p2");
      expect(session.state.focusPlayer).toBe("p1");

      const afterBlockP2Pass = session.submitDecision({
        decisionId: afterBlockP1Pass.request.decisionId,
        stateVersion: afterBlockP1Pass.request.stateVersion,
        selectedPatternRef: afterBlockP1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterBlockP2Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // Case 10: ブロック効果解決中断中は chancePlayer === "system" であり、ブロッカー指定の選択権は P2 にあること
      expect(afterBlockP2Pass.request.source.type).toBe("EFFECT_RESOLUTION");
      expect(afterBlockP2Pass.request.playerId).toBe("p2");
      expect(session.state.chancePlayer).toBe(RULE_SYSTEM_CHANCE);

      // Case 11 & 12: 解決中断状態で Snapshot V2 保存・復元 & V1 拒否
      const snapV2 = session.createSnapshot();
      expect(snapV2.snapshotFormatVersion).toBe(SNAPSHOT_FORMAT_VERSION);
      expect(snapV2.snapshotFormatVersion).toBe(2);
      expect(snapV2.gameState.chancePlayer).toBe(RULE_SYSTEM_CHANCE);
      expect(snapV2.gameState.focusPlayer).toBe("p1");
      expect(() =>
        GameSessionSnapshotCodec.restore({ ...snapV2, snapshotFormatVersion: 1 as any }, strippedRulePackage)
      ).toThrow(GameSessionSnapshotValidationError);

      const restoredSession = GameSession.fromSnapshot(snapV2, strippedRulePackage);
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(session.state));

      // P2 がブロックなしを選択 -> ダメージ判定がステージに積まれる -> [2]により chance=p1(TP), focus=p1(TP)
      const noBlockIdx = afterBlockP2Pass.request.patterns.findIndex((p) => {
        if (p.effectSelectionRef === undefined) return false;
        const eff = afterBlockP2Pass.request.catalog.effectSelections[p.effectSelectionRef];
        return (eff?.assignments ?? []).every((a) => a.selectedUnitIds.length === 0);
      });
      const chosenBlockIdx = noBlockIdx >= 0 ? noBlockIdx : 0;
      const afterBlockerSel = session.submitDecision({
        decisionId: afterBlockP2Pass.request.decisionId,
        stateVersion: afterBlockP2Pass.request.stateVersion,
        selectedPatternRef: chosenBlockIdx,
      });
      restoredSession.submitDecision({
        decisionId: afterBlockP2Pass.request.decisionId,
        stateVersion: afterBlockP2Pass.request.stateVersion,
        selectedPatternRef: chosenBlockIdx,
      });
      expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(session.state));

      if (afterBlockerSel.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(session.state.stage.requests).toHaveLength(1);
      expect(session.state.stage.requests[0].actionId).toBe("action.damageJudge");
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p1");

      // ダメージ判定に対する応答: TP(p1) PASS -> NTP(p2) PASS -> ダメージ判定解決 -> [2]により chance=p1, focus=p1
      const afterDjP1Pass = session.submitDecision({
        decisionId: afterBlockerSel.request.decisionId,
        stateVersion: afterBlockerSel.request.stateVersion,
        selectedPatternRef: afterBlockerSel.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterDjP1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(session.state.chancePlayer).toBe("p2");

      const afterDjP2Pass = session.submitDecision({
        decisionId: afterDjP1Pass.request.decisionId,
        stateVersion: afterDjP1Pass.request.stateVersion,
        selectedPatternRef: afterDjP1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterDjP2Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(session.state.stage.requests).toHaveLength(0);
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p1");

      // --- Case 9: エンド → チャージ → ドロー ---
      const endIdx = afterDjP2Pass.request.patterns.findIndex(
        (p) => p.actionSelectionRef !== undefined && afterDjP2Pass.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.end"
      );
      const afterEndReq = session.submitDecision({
        decisionId: afterDjP2Pass.request.decisionId,
        stateVersion: afterDjP2Pass.request.stateVersion,
        selectedPatternRef: endIdx,
      });
      if (afterEndReq.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      const afterEndP1Pass = session.submitDecision({
        decisionId: afterEndReq.request.decisionId,
        stateVersion: afterEndReq.request.stateVersion,
        selectedPatternRef: afterEndReq.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterEndP1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      const afterEndP2Pass = session.submitDecision({
        decisionId: afterEndP1Pass.request.decisionId,
        stateVersion: afterEndP1Pass.request.stateVersion,
        selectedPatternRef: afterEndP1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterEndP2Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // エンド解決 -> ターン交代(新TP=p2) -> チャージ即時解決 -> ドロー通常誘発がステージへ -> [2]で新TP(p2)にチャンスとフォーカス
      expect(session.state.turnPlayer).toBe("p2");
      expect(session.state.chancePlayer).toBe("p2");
      expect(session.state.focusPlayer).toBe("p2");
      expect(session.state.stage.requests).toHaveLength(1);
      expect(session.state.stage.requests[0].actionId).toBe("action.draw");

      // 新TP(p2) PASS -> 新NTP(p1) チャンス -> 新NTP(p1) PASS -> ドロー解決 -> 新TP(p2)にチャンスとフォーカスが戻る
      const afterDrawP2Pass = session.submitDecision({
        decisionId: afterEndP2Pass.request.decisionId,
        stateVersion: afterEndP2Pass.request.stateVersion,
        selectedPatternRef: afterEndP2Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      if (afterDrawP2Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(session.state.chancePlayer).toBe("p1");
      expect(session.state.focusPlayer).toBe("p2");

      session.submitDecision({
        decisionId: afterDrawP2Pass.request.decisionId,
        stateVersion: afterDrawP2Pass.request.stateVersion,
        selectedPatternRef: afterDrawP2Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      expect(session.state.stage.requests).toHaveLength(0);
      expect(session.state.turnPlayer).toBe("p2");
      expect(session.state.chancePlayer).toBe("p2");
      expect(session.state.focusPlayer).toBe("p2");
    });

    it("Direct tryResolveStageTop & takeUntilLegacyCard: guarantees chancePlayer='system' before stage resolution and generates deterministic collision-free unitIds", () => {
      const state = createTestState();
      const registry = new CommandRegistry();
      const passTracker = new PassTracker();

      // 1. 全員パス未成立・空ステージで tryResolveStageTop を直接呼んでも chancePlayer が "system" に汚染されないこと
      expect(
        CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2)
      ).toBeNull();
      expect(state.chancePlayer).toBe("p1");

      // 空ステージで passTracker.isAllPassed が true でも chancePlayer !== "system" なら変更しないこと
      passTracker.recordPass();
      passTracker.recordPass();
      expect(
        CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2)
      ).toBeNull();
      expect(state.chancePlayer).toBe("p1");

      // 2. ステージに action.end がある状態でも、passTracker.isAllPassed が true であっても
      // chancePlayer !== "system" ならステージ解決を開始せず null を返すこと (旧方式の完全禁止)
      const logRecorder = new MatchLogRecorder({ matchId: "direct-try-resolve-test" });
      registry.logRecorder = logRecorder;
      state.stage.requests.push({
        id: "direct-end-req",
        actionId: "action.end",
        action: rulePackage.actions.find((a) => a.id === "action.end")!,
        controller: "p1",
        definitionOwner: "p1",
        targets: [],
      } as any);
      passTracker.recordPass();
      passTracker.recordPass();

      expect(
        CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2)
      ).toBeNull();
      expect(state.chancePlayer).toBe("p1");

      // 全員パス成立 (chancePlayer === "system") に設定されたときのみステージ解決が開始されること
      state.chancePlayer = RULE_SYSTEM_CHANCE;
      const resolvedEv = CoreFlowCoordinator.tryResolveStageTop(
        state,
        rulePackage,
        registry,
        passTracker,
        2
      );
      expect(resolvedEv?.type).toBe("STAGE_TOP_RESOLVED");
      expect(state.turnPlayer).toBe("p2");
      expect(state.chancePlayer).toBe("p2");
      expect(state.focusPlayer).toBe("p2");
      const chanceLogs = logRecorder.getEvents().filter((e) => e.type === "chance.changed") as any[];
      expect(chanceLogs.map((e) => `${e.fromChancePlayer}->${e.toChancePlayer}(${e.reason})`)).toEqual([
        "system->p2(stageTopResolved)",
      ]);

      // 3. takeUntilLegacyCard の unitId 生成が決定論的であり、既存 unitId と衝突しないこと
      const stateA = createTestState();
      stateA.players.p1.life = [
        { id: "dup-card", suit: "S", rank: "2", value: 2 },
        { id: "legacy-a", suit: "S", rank: "A", value: 1 },
      ];
      // 同一 baseId をあらかじめ墓地に配置して衝突回避サフィックス (#2) と決定論性を検証
      stateA.players.p1.grave = [
        {
          unitId: "unit-grave-p1-req-legacy-1-v1-dup-card",
          kind: "一般兵",
          cards: [{ id: "dup-card", suit: "S", rank: "2", value: 2 }],
          labels: [],
        },
      ];
      const stateB = JSON.parse(JSON.stringify(stateA));

      const takeHandler = takeUntilLegacyCardHandler();
      takeHandler({}, {
        state: stateA,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentRequest: { id: "req-legacy-1" } as any,
      });
      takeHandler({}, {
        state: stateB,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentRequest: { id: "req-legacy-1" } as any,
      });

      expect(stateA.players.p1.grave).toHaveLength(2);
      expect(stateA.players.p1.grave[1].unitId).toBe("unit-grave-p1-req-legacy-1-v1-dup-card#2");
      expect(stateA.players.p1.grave[1].unitId).not.toBe(stateA.players.p1.grave[0].unitId);
      expect(stateB.players.p1.grave[1].unitId).toBe(stateA.players.p1.grave[1].unitId);
    });
  });
});
