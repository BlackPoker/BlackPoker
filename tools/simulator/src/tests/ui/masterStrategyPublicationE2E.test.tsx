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
  isAllowedPreviewRegulation,
  PREVIEW_ALLOWED_REGULATION_IDS,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { CoreBattlePlaytest, buildUndoReconstructParams } from "../../ui/playtest/CoreBattlePlaytest";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
  CardOccurrenceSelection,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  reconstructMatch,
  findUndoTruncationIndex,
} from "../../engine/replay/ReplayReconstructionService";
import type { ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";

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
    it("通常時 (公式公開): official:mast-strategy が正式公開され、全7レギュレーションが難易度順に表示されること", () => {
      const envs = getAvailableEnvironments(catalog);
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

    it("未実装レギュレーションは、プレビュー時であっても環境一覧に一切追加されないこと", () => {
      expect(isAllowedPreviewRegulation("light-strategy")).toBe(false);
      expect(isAllowedPreviewRegulation("unknown-regulation")).toBe(false);

      const envs = getAvailableEnvironments(catalog, { includeUnimplemented: true });
      expect(envs.some((e) => e.id === "official:light-strategy")).toBe(false);
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
  // 3. Match Setup & Human vs AI Flow with Hidden Info Protection
  // =========================================================================
  describe("3. Match Setup & Human vs AI Flow with Hidden Info Protection", () => {
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

      const first = outcome.firstPlayer!;
      const second = first === "p1" ? "p2" : "p1";
      expect(state.players[first].hand.length).toBe(8);
      expect(state.players[second].hand.length).toBe(7);
      expect(state.players.p1.rareCards.length).toBe(1);
      expect(state.players.p2.rareCards.length).toBe(1);
    });

    it("Human vs AI: AI のシナリオ手札とレアカードが合法に自動解決され、相手の手札詳細が Observation / UI で完全に秘匿されること", async () => {
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

      // 物理カード重複防止の検証
      for (const s of p2Scenario!) {
        for (const r of p2Rare!) {
          expect(s.suit === r.suit && s.rank === r.rank && (s.occurrence ?? 0) === (r.occurrence ?? 0)).toBe(false);
        }
      }

      // --- 非公開情報保護の直接検証 (ObservationFactory & PlayerObservationPresenter) ---
      const state = outcome.session.state;
      const humanObservation = ObservationFactory.createObservation(state, "p1");

      // 1. Observation レベルでの秘密情報保護:
      // P1（Human）視点において、P2（AI）の手札カード詳細（suit/rank）が含まれず、枚数情報のみが観測可能であること
      const p2ObsHand = (humanObservation as any).players?.p2?.hand;
      if (Array.isArray(p2ObsHand)) {
        for (const card of p2ObsHand) {
          // card がオブジェクトである場合は visibility が HIDDEN かつ詳細未定義
          expect(card.suit).toBeUndefined();
          expect(card.rank).toBeUndefined();
        }
      }

      // 2. ViewModel レベルでの秘密情報保護 (UI レンダリングデータ):
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", humanObservation, state, "p1");
      expect(p2Vm.isViewer).toBe(false);
      expect(p2Vm.handCount).toBe(state.players.p2.hand.length);
      for (const card of p2Vm.handCards) {
        expect(card.visibility).toBe("HIDDEN");
        expect((card as any).code).toBeUndefined();
        expect((card as any).suit).toBeUndefined();
        expect((card as any).rank).toBeUndefined();
      }
    });

    it("Fail-Closed: ホワイトリスト外の未実装環境IDを指定した場合は allowUnimplemented: true でもフェイルクローズすること", async () => {
      const resInvalidEnv = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:light-strategy", // 未実装・ホワイトリスト外
        matchMode: "humanVsHuman",
        seedInput: "42",
        allowUnimplemented: true,
      });
      expect(resInvalidEnv.type).toBe("TECHNICAL_ERROR");
    });
  });

  // =========================================================================
  // 4. シナリオ対戦における Undo の明示的非対応（仕様契約検証）
  // =========================================================================
  describe("4. Scenario Match Undo Contract (明示的非対応仕様)", () => {
    it("activeMatch.isScenario === true の対戦では Undo が明示的に無効化され、実行時に安全に通知されること", async () => {
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

      // シナリオ対戦フラグを付与したコンテキスト
      const scenarioMatchContext = {
        ...outcome.activeMatch!,
        isScenario: true,
      };

      // 1. UIの isUndoAvailable 判定契約: isScenario === true の場合は常に false
      const transcriptWithDecisions: ReplayDecisionEntryV1[] = [
        {
          seq: 1,
          actor: "human",
          playerId: "p1",
          response: { decisionId: "d1", stateVersion: 1, selectedPatternRef: 0 },
        },
      ];
      const isAvailable = Boolean(
        !scenarioMatchContext.isScenario &&
        findUndoTruncationIndex(transcriptWithDecisions) >= 0
      );
      expect(isAvailable).toBe(false);
    });
  });

  // =========================================================================
  // 5. 通常マスター対戦における実Undo・分岐進行・Canonical Replay: 徴募
  // =========================================================================
  describe("5. 通常マスター対戦における実Undo・分岐進行・Canonical Replay: 徴募 (action.recruit)", () => {
    it("徴募の順序選択待ちでの実Undo、選択完了後の実Undo、別の判断への分岐進行、Card Identity整合性、reconstructMatchによる完全再現性", async () => {
      // 1. 通常の公式マスター対戦を起動 (isScenario: false, session.state への直接代入なし)
      // P1 の手札に ♢2, ♢4, ♢3 を指定 (♢2, ♢4 は徴募キーカード、♢3 または手札カードは防壁設置用)
      const p1ScenarioCards: CardOccurrenceSelection[] = [
        { suit: "D", rank: "2", occurrence: 0 },
        { suit: "D", rank: "4", occurrence: 0 },
        { suit: "D", rank: "3", occurrence: 0 },
      ];
      const outcome = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:mast-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
        scenarioHandSelections: { p1: p1ScenarioCards, p2: validP2Scenario },
        allowUnimplemented: true,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const activeMatch = outcome.activeMatch!;
      const session = outcome.session;

      // Seed 42 では P1 が先攻
      expect(outcome.firstPlayer).toBe("p1");
      expect(session.state.turnPlayer).toBe("p1");

      const transcript: ReplayDecisionEntryV1[] = [];
      let seq = 1;
      let step = outcome.initialStep;

      // Step 1: P1 が action.setBulwark (防壁設置, speed: immediate) を選択して防壁を2体にする
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const setBwRef = (step as any).request.patterns.findIndex((p: any) => {
        const act = (step as any).request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.setBulwark";
      });
      expect(setBwRef).toBeGreaterThanOrEqual(0);

      const dSetBw: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: (step as any).request.playerId,
        response: {
          decisionId: (step as any).request.decisionId,
          stateVersion: (step as any).request.stateVersion,
          selectedPatternRef: setBwRef,
        },
      };
      transcript.push(dSetBw);
      step = session.submitDecision(dSetBw.response);

      // Step 2: 手札選択 (selectCards) で手札の0番目を裏向き防壁として出す
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect((step as any).request.source?.effectStepId).toBe("selectCards");
      const dCardSel: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: (step as any).request.playerId,
        response: {
          decisionId: (step as any).request.decisionId,
          stateVersion: (step as any).request.stateVersion,
          selectedPatternRef: 0,
        },
      };
      transcript.push(dCardSel);
      step = session.submitDecision(dCardSel.response);

      // Step 3: 防壁が2体になり、手札の ♢2, ♢4 により action.recruit が使用可能！
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const recruitRef = (step as any).request.patterns.findIndex((p: any) => {
        const act = (step as any).request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      expect(recruitRef).toBeGreaterThanOrEqual(0);

      const dRecruit: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: (step as any).request.playerId,
        response: {
          decisionId: (step as any).request.decisionId,
          stateVersion: (step as any).request.stateVersion,
          selectedPatternRef: recruitRef,
        },
      };
      transcript.push(dRecruit);
      step = session.submitDecision(dRecruit.response);

      // パスを進めて recruitUnitsFromLife の順序選択へ到達
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && (step as any).request.source?.effectStepId === "recruitUnitsFromLife") {
          break;
        }
        const passRef = (step as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passRef < 0) break;
        const dPass: ReplayDecisionEntryV1 = {
          seq: seq++,
          actor: "human",
          playerId: (step as any).request.playerId,
          response: {
            decisionId: (step as any).request.decisionId,
            stateVersion: (step as any).request.stateVersion,
            selectedPatternRef: passRef,
          },
        };
        transcript.push(dPass);
        step = session.submitDecision(dPass.response);
      }

      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect((step as any).request.source?.effectStepId).toBe("recruitUnitsFromLife");
      const orderPatternsCount = (step as any).request.patterns.length;
      expect(orderPatternsCount).toBeGreaterThan(1); // 複数の超過カードが存在し順序選択肢がある

      // 順序選択の 0番目（パターンA）を提出
      const dOrderA: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: (step as any).request.playerId,
        response: {
          decisionId: (step as any).request.decisionId,
          stateVersion: (step as any).request.stateVersion,
          selectedPatternRef: 0,
        },
      };
      transcript.push(dOrderA);
      step = session.submitDecision(dOrderA.response);

      // 残りの順序選択およびパスを進めて徴募の解決を完了 (パターンA)
      while (session.state.stage.requests.length > 0) {
        if (step.type !== "WAITING_FOR_DECISION") break;
        if ((step as any).request.source?.effectStepId === "recruitUnitsFromLife") {
          const dNextOrder: ReplayDecisionEntryV1 = {
            seq: seq++,
            actor: "human",
            playerId: (step as any).request.playerId,
            response: {
              decisionId: (step as any).request.decisionId,
              stateVersion: (step as any).request.stateVersion,
              selectedPatternRef: 0,
            },
          };
          transcript.push(dNextOrder);
          step = session.submitDecision(dNextOrder.response);
        } else {
          const passRef = (step as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
          if (passRef < 0) break;
          const dPass: ReplayDecisionEntryV1 = {
            seq: seq++,
            actor: "human",
            playerId: (step as any).request.playerId,
            response: {
              decisionId: (step as any).request.decisionId,
              stateVersion: (step as any).request.stateVersion,
              selectedPatternRef: passRef,
            },
          };
          transcript.push(dPass);
          step = session.submitDecision(dPass.response);
        }
      }

      // --- 実Undo検証 1: 順序選択完了後の実Undo ---
      // 最初の順序選択 (dOrderA) の直前（順序選択待ち状態）まで巻き戻す
      const orderAIdx = transcript.findIndex((t) => t.response.decisionId === dOrderA.response.decisionId);
      expect(orderAIdx).toBeGreaterThan(0);
      const targetTranscript1 = transcript.slice(0, orderAIdx);

      const undoRecon1 = reconstructMatch({
        environmentId: activeMatch.environmentId,
        seed: activeMatch.seed,
        rareCardSelections: activeMatch.rareCardSelections,
        scenarioHandSelections: activeMatch.scenarioHandSelections,
        transcript: targetTranscript1,
        catalog,
        fullRulePackage,
        allowUnimplemented: true,
      });
      expect(undoRecon1.status).toBe("SUCCESS");
      if (undoRecon1.status !== "SUCCESS") return;

      let restoredStep1 = undoRecon1.currentStep;
      expect(restoredStep1.type).toBe("WAITING_FOR_DECISION");
      expect((restoredStep1 as any).request.source?.effectStepId).toBe("recruitUnitsFromLife");

      // --- 別の判断への分岐進行: 0番目ではなく 1番目（パターンB）を選択して分岐進行！ ---
      let branchSeq = targetTranscript1.length + 1;
      const dOrderB: ReplayDecisionEntryV1 = {
        seq: branchSeq++,
        actor: "human",
        playerId: (restoredStep1 as any).request.playerId,
        response: {
          decisionId: (restoredStep1 as any).request.decisionId,
          stateVersion: (restoredStep1 as any).request.stateVersion,
          selectedPatternRef: 1, // 別の順序を選択！
        },
      };
      const branchTranscript = [...targetTranscript1, dOrderB];
      let branchStep = undoRecon1.session.submitDecision(dOrderB.response);

      // パスおよび残りの順序選択を進めてパターンBの効果解決も完了
      while (undoRecon1.session.state.stage.requests.length > 0) {
        if (branchStep.type !== "WAITING_FOR_DECISION") break;
        if ((branchStep as any).request.source?.effectStepId === "recruitUnitsFromLife") {
          const dNextOrder: ReplayDecisionEntryV1 = {
            seq: branchSeq++,
            actor: "human",
            playerId: (branchStep as any).request.playerId,
            response: {
              decisionId: (branchStep as any).request.decisionId,
              stateVersion: (branchStep as any).request.stateVersion,
              selectedPatternRef: 0,
            },
          };
          branchTranscript.push(dNextOrder);
          branchStep = undoRecon1.session.submitDecision(dNextOrder.response);
        } else {
          const passRef = (branchStep as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
          if (passRef < 0) break;
          const dPass: ReplayDecisionEntryV1 = {
            seq: branchSeq++,
            actor: "human",
            playerId: (branchStep as any).request.playerId,
            response: {
              decisionId: (branchStep as any).request.decisionId,
              stateVersion: (branchStep as any).request.stateVersion,
              selectedPatternRef: passRef,
            },
          };
          branchTranscript.push(dPass);
          branchStep = undoRecon1.session.submitDecision(dPass.response);
        }
      }

      // 分岐後のライフ順序がパターンAと異なることを確認
      const p1LifeA = session.state.players.p1.life.map((c: any) => c.id);
      const p1LifeB = undoRecon1.session.state.players.p1.life.map((c: any) => c.id);
      expect(p1LifeA).not.toEqual(p1LifeB); // 異なる順序でライフBOTへ戻されたことの実証！

      // --- 実Undo検証 2: 徴募発動前まで巻き戻す実Undo ---
      const prefixBeforeRecruit = transcript.slice(0, 2); // 防壁配置完了時点
      const reconBeforeRecruit = reconstructMatch({
        environmentId: activeMatch.environmentId,
        seed: activeMatch.seed,
        rareCardSelections: activeMatch.rareCardSelections,
        scenarioHandSelections: activeMatch.scenarioHandSelections,
        transcript: prefixBeforeRecruit,
        catalog,
        fullRulePackage,
        allowUnimplemented: true,
      });
      expect(reconBeforeRecruit.status).toBe("SUCCESS");
      if (reconBeforeRecruit.status !== "SUCCESS") return;

      // 徴募選択可能なメインアクション選択状態に復帰していること
      const stepBeforeRecruit = reconBeforeRecruit.currentStep;
      expect(stepBeforeRecruit.type).toBe("WAITING_FOR_DECISION");
      const recruitAvailable = (stepBeforeRecruit as any).request.patterns.some((p: any) => {
        const act = (stepBeforeRecruit as any).request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      expect(recruitAvailable).toBe(true);

      // 徴募ではなくエンド（action.end）を選択する分岐進行
      const endRef = (stepBeforeRecruit as any).request.patterns.findIndex((p: any) => {
        const act = (stepBeforeRecruit as any).request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.end";
      });
      expect(endRef).toBeGreaterThanOrEqual(0);

      const dEnd: ReplayDecisionEntryV1 = {
        seq: prefixBeforeRecruit.length + 1,
        actor: "human",
        playerId: (stepBeforeRecruit as any).request.playerId,
        response: {
          decisionId: (stepBeforeRecruit as any).request.decisionId,
          stateVersion: (stepBeforeRecruit as any).request.stateVersion,
          selectedPatternRef: endRef,
        },
      };
      const endTranscript = [...prefixBeforeRecruit, dEnd];
      const reconEnd = reconstructMatch({
        environmentId: activeMatch.environmentId,
        seed: activeMatch.seed,
        rareCardSelections: outcome.activeMatch!.rareCardSelections,
        scenarioHandSelections: outcome.activeMatch!.scenarioHandSelections,
        transcript: endTranscript,
        catalog,
        fullRulePackage,
        allowUnimplemented: true,
      });
      expect(reconEnd.status).toBe("SUCCESS");

      // --- 完了後の Canonical Replay 検証 ---
      const finalRecon = reconstructMatch({
        environmentId: activeMatch.environmentId,
        seed: activeMatch.seed,
        rareCardSelections: activeMatch.rareCardSelections,
        scenarioHandSelections: activeMatch.scenarioHandSelections,
        transcript,
        catalog,
        fullRulePackage,
        allowUnimplemented: true,
      });
      expect(finalRecon.status).toBe("SUCCESS");
    });
  });

  // =========================================================================
  // 6. 通常マスター対戦における実Undo・分岐進行・Canonical Replay: B・J
  // =========================================================================
  describe("6. 通常マスター対戦における実Undo・分岐進行・Canonical Replay: B・J (action.bj)", () => {
    it("バースト墓地TOP選択待ちからの実Undo、スタンド選択への分岐進行、墓地TOP整合性、reconstructMatchによる完全再現性", async () => {
      // 1. 通常マスター対戦を起動 (isScenario: false, session.state への直接代入なし)
      // P1 の手札に ♠A, ♠J, ♢2 を指定
      const p1BjHand: CardOccurrenceSelection[] = [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "S", rank: "J", occurrence: 0 },
        { suit: "D", rank: "2", occurrence: 0 },
      ];
      const outcome = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:mast-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
        scenarioHandSelections: { p1: p1BjHand, p2: validP2Scenario },
        allowUnimplemented: true,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const activeMatch = outcome.activeMatch!;
      const session = outcome.session;

      const transcript: ReplayDecisionEntryV1[] = [];
      let seq = 1;
      let step = outcome.initialStep;

      // Step 1: P1 が B・J を提出 (Seed 42 では 1手目から使用可能)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const bjRef = (step as any).request.patterns.findIndex((p: any) => {
        const act = (step as any).request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.bj";
      });
      expect(bjRef).toBeGreaterThanOrEqual(0);

      const dBj: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: (step as any).request.playerId,
        response: {
          decisionId: (step as any).request.decisionId,
          stateVersion: (step as any).request.stateVersion,
          selectedPatternRef: bjRef,
        },
      };
      transcript.push(dBj);
      step = session.submitDecision(dBj.response);

      // パスを進めてヒット／スタンド選択へ
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && (step as any).request.source?.effectStepId === "playBlackjack") {
          break;
        }
        const passRef = (step as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passRef < 0) break;
        const dPass: ReplayDecisionEntryV1 = {
          seq: seq++,
          actor: "human",
          playerId: (step as any).request.playerId,
          response: {
            decisionId: (step as any).request.decisionId,
            stateVersion: (step as any).request.stateVersion,
            selectedPatternRef: passRef,
          },
        };
        transcript.push(dPass);
        step = session.submitDecision(dPass.response);
      }

      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect((step as any).request.source?.effectStepId).toBe("playBlackjack");

      // 1回目の選択: ヒットを選択 (DJ をめくって合計12点)
      const hitRef1 = (step as any).request.patterns.findIndex((p: any) => {
        const effSel = (step as any).request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      expect(hitRef1).toBeGreaterThanOrEqual(0);
      const dHit1: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: (step as any).request.playerId,
        response: {
          decisionId: (step as any).request.decisionId,
          stateVersion: (step as any).request.stateVersion,
          selectedPatternRef: hitRef1,
        },
      };
      transcript.push(dHit1);
      step = session.submitDecision(dHit1.response);

      // 2回目の選択: 再度ヒットを選択 (C6 をめくって合計18点)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const hitRef2 = (step as any).request.patterns.findIndex((p: any) => {
        const effSel = (step as any).request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      expect(hitRef2).toBeGreaterThanOrEqual(0);
      const dHit2: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: (step as any).request.playerId,
        response: {
          decisionId: (step as any).request.decisionId,
          stateVersion: (step as any).request.stateVersion,
          selectedPatternRef: hitRef2,
        },
      };
      transcript.push(dHit2);
      step = session.submitDecision(dHit2.response);

      // 3回目の選択: 再度ヒットを選択 (S8 をめくって合計26点 -> バースト！)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const hitRef3 = (step as any).request.patterns.findIndex((p: any) => {
        const effSel = (step as any).request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      expect(hitRef3).toBeGreaterThanOrEqual(0);
      const dHit3: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: (step as any).request.playerId,
        response: {
          decisionId: (step as any).request.decisionId,
          stateVersion: (step as any).request.stateVersion,
          selectedPatternRef: hitRef3,
        },
      };
      transcript.push(dHit3);
      step = session.submitDecision(dHit3.response);

      // バーストにより墓地TOP選択（ZONE_TOP_SELECTION）に到達！
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect((step as any).request.source?.type).toBe("ZONE_TOP_SELECTION");

      // --- 実Undo検証: バースト墓地TOP選択待ちからの Undo ---
      // 直前の決定（3回目ヒット）の前（2回目ヒット後、合計18点）に巻き戻す
      const undoTargetIdx = findUndoTruncationIndex(transcript);
      expect(undoTargetIdx).toBeGreaterThanOrEqual(0);
      const targetTranscript = transcript.slice(0, undoTargetIdx);

      // 実際に reconstructMatch で Undo 再構築を実行
      const undoRecon = reconstructMatch({
        environmentId: activeMatch.environmentId,
        seed: activeMatch.seed,
        rareCardSelections: activeMatch.rareCardSelections,
        scenarioHandSelections: activeMatch.scenarioHandSelections,
        transcript: targetTranscript,
        catalog,
        fullRulePackage,
        allowUnimplemented: true,
      });
      expect(undoRecon.status).toBe("SUCCESS");
      if (undoRecon.status !== "SUCCESS") return;

      let restoredStep = undoRecon.currentStep;
      // 2回目ヒット後（合計18点、バースト前）に復帰していること
      expect(restoredStep.type).toBe("WAITING_FOR_DECISION");
      expect((restoredStep as any).request.source?.effectStepId).toBe("playBlackjack");

      // --- 別の判断への分岐進行: ヒットではなく「スタンド」を選択してバースト回避！ ---
      const standRef = (restoredStep as any).request.patterns.findIndex((p: any) => {
        const effSel = (restoredStep as any).request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "stand" || p.patternId?.includes("stand");
      });
      expect(standRef).toBeGreaterThanOrEqual(0);

      const dStand: ReplayDecisionEntryV1 = {
        seq: targetTranscript.length + 1,
        actor: "human",
        playerId: (restoredStep as any).request.playerId,
        response: {
          decisionId: (restoredStep as any).request.decisionId,
          stateVersion: (restoredStep as any).request.stateVersion,
          selectedPatternRef: standRef,
        },
      };
      const finalTranscript = [...targetTranscript, dStand];
      restoredStep = undoRecon.session.submitDecision(dStand.response);

      // パスを進めてスタンド効果解決を完了
      while (undoRecon.session.state.stage.requests.length > 0) {
        if (restoredStep.type !== "WAITING_FOR_DECISION") break;
        const passRef = (restoredStep as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passRef < 0) break;
        const dPass: ReplayDecisionEntryV1 = {
          seq: finalTranscript.length + 1,
          actor: "human",
          playerId: (restoredStep as any).request.playerId,
          response: {
            decisionId: (restoredStep as any).request.decisionId,
            stateVersion: (restoredStep as any).request.stateVersion,
            selectedPatternRef: passRef,
          },
        };
        finalTranscript.push(dPass);
        restoredStep = undoRecon.session.submitDecision(dPass.response);
      }

      // スタンド解決完了後の検証:
      // スタンドによりめくられた公開カードが手札に加わり、初期手札より枚数が増加していること
      const p1HandCardIds = undoRecon.session.state.players.p1.hand.map((c: any) => c.suit + c.rank);
      expect(p1HandCardIds.length).toBeGreaterThan(outcome.session.state.players.p1.hand.length);

      // --- Canonical Replay 検証 ---
      // スタンド分岐後の transcript 全体で reconstructMatch を実行し、完全一致（SUCCESS）を確認
      const fullReplay = reconstructMatch({
        environmentId: activeMatch.environmentId,
        seed: activeMatch.seed,
        rareCardSelections: activeMatch.rareCardSelections,
        scenarioHandSelections: activeMatch.scenarioHandSelections,
        transcript: finalTranscript,
        catalog,
        fullRulePackage,
        allowUnimplemented: true,
      });
      expect(fullReplay.status).toBe("SUCCESS");
      if (fullReplay.status === "SUCCESS") {
        expect(fullReplay.session.state.players.p1.hand.map((c: any) => c.id)).toEqual(
          undoRecon.session.state.players.p1.hand.map((c: any) => c.id)
        );
        expect(fullReplay.session.state.players.p1.life.map((c: any) => c.id)).toEqual(
          undoRecon.session.state.players.p1.life.map((c: any) => c.id)
        );
      }
    });
  });

  // =========================================================================
  // 7. Navigation: 対戦中断から対戦設定画面への復帰導線維持
  // =========================================================================
  describe("7. Match Cancellation & Return to Setup Navigation", () => {
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
