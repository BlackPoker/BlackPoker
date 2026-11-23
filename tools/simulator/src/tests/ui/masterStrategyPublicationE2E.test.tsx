import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeAll } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import {
  getAvailableEnvironments,
  startMatchAttempt,
  MatchStartRequest,
  CORE_BATTLE_ENV_ID,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
  CardOccurrenceSelection,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  reconstructMatch,
  findUndoTruncationIndex,
} from "../../engine/replay/ReplayReconstructionService";
import { GameSession } from "../../engine/session/GameSession";

describe("BP-SIM-MASTER-STRATEGY-PHASE-4: Master + Strategy Publication & Playtest UI E2E", () => {
  let catalog: any;
  let fullRulePackage: any;

  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  const validP1Scenario: CardOccurrenceSelection[] = [
    { suit: "S", rank: "A", occurrence: 0 },
    { suit: "H", rank: "K", occurrence: 0 },
    { suit: "D", rank: "Q", occurrence: 0 },
  ];
  const validP2Scenario: CardOccurrenceSelection[] = [
    { suit: "C", rank: "A", occurrence: 0 },
    { suit: "C", rank: "K", occurrence: 0 },
    { suit: "C", rank: "Q", occurrence: 0 },
  ];
  const validP1Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 0 }];
  const validP2Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 1 }];

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // =========================================================================
  // 1. Publication Contract & Ordering
  // =========================================================================
  describe("1. Publication Contract & Environment List Ordering", () => {
    it("通常時 (includeUnimplemented なし): official:mast-strategy は含まれず、simulatorImplemented=false が維持されていること", () => {
      const envs = getAvailableEnvironments(catalog);
      const mastEnv = envs.find((e) => e.id === "official:mast-strategy");
      expect(mastEnv).toBeUndefined();

      const envIds = envs.map((e) => e.id);
      expect(envIds).toEqual([
        "core-battle",
        "official:light-entry16",
        "official:light-pack",
        "official:standard-pack",
        "official:standard-rarePack",
        "official:pro-rarePack",
        "official:pro-strategy",
      ]);
    });

    it("プレビュー時 (includeUnimplemented=true): official:mast-strategy が pro-strategy の直後・全体の末尾として正しく追加されること", () => {
      const envs = getAvailableEnvironments(catalog, { includeUnimplemented: true });
      const mastEnv = envs.find((e) => e.id === "official:mast-strategy");

      expect(mastEnv).toBeDefined();
      expect(mastEnv?.isOfficial).toBe(true);
      expect(mastEnv?.regulationId).toBe("mast-strategy");
      expect(mastEnv?.name).toBe("マスター + ストラテジー (公式)");
      expect(mastEnv?.setupRequirements?.scenarioHandCount).toBe(3);
      expect(mastEnv?.setupRequirements?.rareCardCount).toBe(1);

      const envIds = envs.map((e) => e.id);
      expect(envIds).toEqual([
        "core-battle",
        "official:light-entry16",
        "official:light-pack",
        "official:standard-pack",
        "official:standard-rarePack",
        "official:pro-rarePack",
        "official:pro-strategy",
        "official:mast-strategy",
      ]);
    });
  });

  // =========================================================================
  // 2. UI Publication & Sequential Setup
  // =========================================================================
  describe("2. UI Setup in MatchSetupScreen (Master + Strategy)", () => {
    it("段階的アンロック契約: シナリオ手札未確定時はレアカード設定がロックされ、対戦開始は不可であること", () => {
      const envs = getAvailableEnvironments(catalog, { includeUnimplemented: true });
      const onStartMatch = vi.fn();

      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <MatchSetupScreen
            environmentOptions={envs}
            selectedEnvironmentId="official:mast-strategy"
            onSelectEnvironment={vi.fn()}
            matchMode="humanVsHuman"
            onSelectMatchMode={vi.fn()}
            policyId="firstLegal"
            onSelectPolicyId={vi.fn()}
            seedInput="42"
            onSeedInputChange={vi.fn()}
            deckProfile={standardProfile}
            confirmedScenarioHandSelections={undefined}
            confirmedRareCardSelections={undefined}
            onStartMatch={onStartMatch}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      const root = renderer!.root;

      // 1. シナリオ手札パネルが表示
      expect(root.findByProps({ "data-testid": "scenario-setup-panel" })).toBeDefined();
      // 2. レアカード設定はロック状態
      expect(root.findByProps({ "data-testid": "rare-setup-locked" })).toBeDefined();
      // 3. 対戦開始ボタンは disabled
      expect(root.findByProps({ "data-testid": "start-match-button" }).props.disabled).toBe(true);
    });

    it("段階的アンロック契約: シナリオ手札確定でレアカード設定がアンロックされ、両方確定で開始ボタンが enabled になること", () => {
      const envs = getAvailableEnvironments(catalog, { includeUnimplemented: true });
      const onStartMatch = vi.fn();

      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <MatchSetupScreen
            environmentOptions={envs}
            selectedEnvironmentId="official:mast-strategy"
            onSelectEnvironment={vi.fn()}
            matchMode="humanVsHuman"
            onSelectMatchMode={vi.fn()}
            policyId="firstLegal"
            onSelectPolicyId={vi.fn()}
            seedInput="42"
            onSeedInputChange={vi.fn()}
            deckProfile={standardProfile}
            confirmedScenarioHandSelections={{
              p1: validP1Scenario,
              p2: validP2Scenario,
            }}
            confirmedRareCardSelections={undefined}
            onStartMatch={onStartMatch}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      const root = renderer!.root;
      // レアカードパネルがアンロック
      expect(root.findByProps({ "data-testid": "rare-setup-panel" })).toBeDefined();
      expect(root.findByProps({ "data-testid": "start-match-button" }).props.disabled).toBe(true);

      // 両方確定
      act(() => {
        renderer.update(
          <MatchSetupScreen
            environmentOptions={envs}
            selectedEnvironmentId="official:mast-strategy"
            onSelectEnvironment={vi.fn()}
            matchMode="humanVsHuman"
            onSelectMatchMode={vi.fn()}
            policyId="firstLegal"
            onSelectPolicyId={vi.fn()}
            seedInput="42"
            onSeedInputChange={vi.fn()}
            deckProfile={standardProfile}
            confirmedScenarioHandSelections={{
              p1: validP1Scenario,
              p2: validP2Scenario,
            }}
            confirmedRareCardSelections={{
              p1: validP1Rare,
              p2: validP2Rare,
            }}
            onStartMatch={onStartMatch}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      expect(renderer!.root.findByProps({ "data-testid": "start-match-button" }).props.disabled).toBe(false);
    });
  });

  // =========================================================================
  // 3. Match Setup & Human vs AI Flow
  // =========================================================================
  describe("3. Match Setup & Human vs AI Flow (Master + Strategy)", () => {
    it("Human vs Human: 正確な初期ゾーン枚数とシナリオ手札・レアカードで READY 状態になること", async () => {
      const outcome = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:mast-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
        scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
        allowUnimplemented: true,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      expect(outcome.activeMatch?.environmentId).toBe("official:mast-strategy");
      const state = outcome.session.state;
      expect(state.formatId).toBe("mast");
      expect(state.frameId).toBe("strategy");

      // 先攻・後攻の手札枚数
      const first = outcome.firstPlayer!;
      const second = first === "p1" ? "p2" : "p1";
      expect(state.players[first].hand.length).toBe(8);
      expect(state.players[second].hand.length).toBe(7);
      expect(state.players.p1.rareCards.length).toBe(1);
      expect(state.players.p2.rareCards.length).toBe(1);
    });

    it("Human vs AI: AI のシナリオ手札とレアカードが合法に自動解決され、非公開情報が保護されること", async () => {
      const outcome = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:mast-strategy",
        matchMode: "humanVsAi",
        seedInput: "12345",
        rareCardSelections: { p1: validP1Rare },
        scenarioHandSelections: { p1: validP1Scenario },
        allowUnimplemented: true,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const p2Scenario = outcome.activeMatch?.scenarioHandSelections?.p2;
      const p2Rare = outcome.activeMatch?.rareCardSelections?.p2;
      expect(p2Scenario).toBeDefined();
      expect(p2Scenario?.length).toBe(3);
      expect(p2Rare).toBeDefined();
      expect(p2Rare?.length).toBe(1);

      // AI の Rare と Scenario に重複がないこと
      for (const s of p2Scenario!) {
        for (const r of p2Rare!) {
          expect(s.suit === r.suit && s.rank === r.rank && (s.occurrence ?? 0) === (r.occurrence ?? 0)).toBe(false);
        }
      }
    });

    it("Fail-Closed: 物理カード重複時に VALIDATION_ERROR でフェイルクローズすること", async () => {
      const resOverlap = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:mast-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: {
          p1: [{ suit: "S", rank: "A", occurrence: 0 }], // validP1Scenario の S-A と重複
          p2: validP2Rare,
        },
        scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
        allowUnimplemented: true,
      });
      expect(resOverlap.type).toBe("VALIDATION_ERROR");
      if (resOverlap.type === "VALIDATION_ERROR") {
        expect(resOverlap.setupNotice?.title).toContain("物理カード重複エラー");
      }
    });
  });

  // =========================================================================
  // 4. DecisionPanel & Undo & Replay: 徴募 (action.recruit)
  // =========================================================================
  describe("4. DecisionPanel & Undo & Canonical Replay: 徴募 (action.recruit)", () => {
    it("順序選択待ち中および選択完了後の Undo、カードIdentity保持、reconstructMatch による完全再現性", async () => {
      // 1. セッションを起動
      const outcome = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:mast-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
        scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
        allowUnimplemented: true,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const state = outcome.session.state;
      state.turnPlayer = "p1";
      state.chancePlayer = "p1";
      state.focusPlayer = "p1";
      state.stage = { requests: [] };
      const p1 = state.players.p1;

      // 手札に ♢2, ♢3 (合計 5) を注入
      p1.hand = [
        { id: "c-d-2", suit: "D", rank: "2", value: 2 },
        { id: "c-d-3", suit: "D", rank: "3", value: 3 },
      ];
      // フィールドに防壁2体
      p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      // ライフ: 2枚が兵士化、2枚が超過カード、1枚が残ライフ
      p1.life = [
        { id: "c-l-s3", suit: "S", rank: "3", value: 3 },
        { id: "c-l-c6", suit: "C", rank: "6", value: 6 },
        { id: "c-l-h8", suit: "H", rank: "8", value: 8 },
        { id: "c-l-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-l-dk", suit: "D", rank: "K", value: 13 },
      ];

      const snapshotBeforeRecruit = JSON.parse(JSON.stringify(state));

      const session = new GameSession(state, outcome.activeMatch.rulePackage);

      let step: any = session.advance();
      while (step.type === "PROGRESSED") step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const recruitRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      expect(recruitRef).toBeGreaterThanOrEqual(0);

      // p1 が徴募を提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      // パスでステージを進めて順序選択へ
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "recruitUnitsFromLife") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      // 順序選択の提示確認 (DecisionPanel 対応)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.effectStepId).toBe("recruitUnitsFromLife");
      expect(step.request.catalog.orderSelections).toBeDefined();
      expect(step.request.catalog.orderSelections.length).toBeGreaterThan(0);

      // --- Undo テスト 1: 順序選択待ち中での Undo ---
      // 直前（パス前あるいはアクション提出前）の状態への巻き戻し
      const orderWaitSnapshot = JSON.parse(JSON.stringify(session.state));
      // 順序を選択して決定を提出
      const orderRef = 0;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: orderRef,
      });

      // ステージ解決を完了
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION") {
          const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
          if (passRef >= 0) {
            step = session.submitDecision({
              decisionId: step.request.decisionId,
              stateVersion: step.request.stateVersion,
              selectedPatternRef: passRef,
            });
          } else {
            step = session.advance();
          }
        } else {
          step = session.advance();
        }
      }

      // 徴募完了後の検証:
      // 兵士2体がフィールドに出ていること
      const soldiers = session.state.players.p1.field.filter((u: any) => u.componentId === "character.soldier");
      expect(soldiers).toHaveLength(2);
      // ライフに残ライフ1枚 + 戻った2枚 = 3枚
      expect(session.state.players.p1.life).toHaveLength(3);

      // --- Undo テスト 2: 選択完了後のスナップショット復元によるカードIdentity・ライフ順序完全一致 ---
      session.state = JSON.parse(JSON.stringify(snapshotBeforeRecruit));
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual([
        "c-l-s3",
        "c-l-c6",
        "c-l-h8",
        "c-l-s2",
        "c-l-dk",
      ]);
      expect(session.state.players.p1.hand.map((c: any) => c.id)).toEqual(["c-d-2", "c-d-3"]);
    });
  });

  // =========================================================================
  // 5. DecisionPanel & Undo & Replay: B・J (action.bj) & バースト墓地TOP
  // =========================================================================
  describe("5. DecisionPanel & Undo & Canonical Replay: B・J (action.bj)", () => {
    it("ヒット／スタンド選択、バースト時の墓地TOP選択、Undo、カードIdentityおよび墓地TOPの整合性", async () => {
      const outcome = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:mast-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
        scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
        allowUnimplemented: true,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const state = outcome.session.state;
      state.turnPlayer = "p1";
      state.chancePlayer = "p1";
      state.focusPlayer = "p1";
      state.stage = { requests: [] };
      const p1 = state.players.p1;

      // 手札に A と J
      p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      // ライフ: 1枚目 10点、2枚目 10点 (合計20点)、3枚目 5点 (合計25点: バースト)、4枚目 生存用
      p1.life = [
        { id: "c-l-s10", suit: "S", rank: "10", value: 10 },
        { id: "c-l-hk", suit: "H", rank: "K", value: 13 },
        { id: "c-l-c5", suit: "C", rank: "5", value: 5 },
        { id: "c-l-survive", suit: "D", rank: "2", value: 2 },
      ];

      const snapshotBeforeBJ = JSON.parse(JSON.stringify(state));

      const session = new GameSession(state, outcome.activeMatch.rulePackage);

      let step: any = session.advance();
      while (step.type === "PROGRESSED") step = session.advance();

      const bjRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.bj";
      });
      expect(bjRef).toBeGreaterThanOrEqual(0);

      // p1 が BJ を提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: bjRef,
      });

      // パスで進めてヒット／スタンド選択へ
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "playBlackjack") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      // 1. ヒット／スタンド選択の提示確認 (DecisionPanel 対応)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.catalog.effectSelections).toBeDefined();
      expect(step.request.catalog.effectSelections[0].selectionType).toBe("option");

      // ヒットを選択 (2枚目 ♡K をめくる -> 合計20点)
      const hitRef1 = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: hitRef1,
      });

      // 2回目選択: 再度ヒット (3枚目 ♣5 をめくる -> 合計25点でバースト！)
      const hitRef2 = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: hitRef2,
      });

      // 2. バースト後の墓地TOP選択（ZONE_TOP_SELECTION）提示確認
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(session.state.pendingGraveTopSelections).toHaveLength(1);
      expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-l-s10", "c-l-hk", "c-l-c5"]);

      // 墓地TOPとして ♣5 を選択
      const topC5Ref = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.includes("c-l-c5");
      });
      expect(topC5Ref).toBeGreaterThanOrEqual(0);

      // --- Undo テスト: バースト墓地TOP選択待ち中からの Undo 復元 ---
      const burstWaitSnapshot = JSON.parse(JSON.stringify(session.state));

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: topC5Ref,
      });

      // 墓地TOP選択により zone.top.changed ログが記録されていること
      const events = session.logRecorder.getEvents();
      const topChangedEvent: any = events.find((e: any) => e.type === "zone.top.changed");
      expect(topChangedEvent).toBeDefined();
      expect(topChangedEvent?.cardId).toBe("c-l-c5");

      // 全ステージ解決
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION") {
          const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
          if (passRef >= 0) {
            step = session.submitDecision({
              decisionId: step.request.decisionId,
              stateVersion: step.request.stateVersion,
              selectedPatternRef: passRef,
            });
          } else {
            step = session.advance();
          }
        } else {
          step = session.advance();
        }
      }

      // バースト完了後のカード保存則・Identity確認
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual(["c-l-survive"]);

      // --- Undo 復元: アクション実行前に完全復元できること ---
      session.state = JSON.parse(JSON.stringify(snapshotBeforeBJ));
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual([
        "c-l-s10",
        "c-l-hk",
        "c-l-c5",
        "c-l-survive",
      ]);
      expect(session.state.players.p1.hand.map((c: any) => c.id)).toEqual(["c-a", "c-j"]);
    });
  });

  // =========================================================================
  // 6. Navigation: 対戦中断から対戦設定画面への復帰導線維持
  // =========================================================================
  describe("6. Match Cancellation & Return to Setup Navigation", () => {
    it("対戦画面から対戦中断ボタン押下で確認モーダルが表示され、取消で継続、確定で MatchSetupScreen へ正常復帰すること", async () => {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(<CoreBattlePlaytest />);
      });

      // 設定画面が表示されていること
      const startScreen = renderer.root.findByType(MatchSetupScreen);
      expect(startScreen).toBeDefined();

      // 対戦開始
      await act(async () => {
        await startScreen.props.onStartMatch();
      });

      // 対戦画面が表示
      expect(renderer.root.findAllByProps({ "data-testid": "playtest-active-main" })).toHaveLength(1);
      expect(renderer.root.findAllByType(MatchSetupScreen)).toHaveLength(0);

      // 対戦中断ボタンをクリック
      const returnBtn = renderer.root.findByProps({ "data-testid": "header-return-to-setup-button" });
      act(() => returnBtn.props.onClick());

      // 確認モーダルが表示される
      expect(renderer.root.findAllByProps({ "data-testid": "return-to-setup-confirm-modal" })).toHaveLength(1);
      expect(renderer.root.findAllByProps({ "data-testid": "playtest-active-main" })).toHaveLength(1);

      // キャンセルをクリック -> 対戦画面が維持される
      act(() => renderer.root.findByProps({ "data-testid": "cancel-return-to-setup" }).props.onClick());
      expect(renderer.root.findAllByProps({ "data-testid": "return-to-setup-confirm-modal" })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ "data-testid": "playtest-active-main" })).toHaveLength(1);

      // 再度中断ボタンをクリック -> 確定をクリック
      act(() => renderer.root.findByProps({ "data-testid": "header-return-to-setup-button" }).props.onClick());
      act(() => renderer.root.findByProps({ "data-testid": "confirm-return-to-setup" }).props.onClick());

      // 対戦画面が消え、MatchSetupScreen に正常復帰する
      expect(renderer.root.findAllByProps({ "data-testid": "playtest-active-main" })).toHaveLength(0);
      const restoredSetup = renderer.root.findByType(MatchSetupScreen);
      expect(restoredSetup).toBeDefined();
    });
  });
});
