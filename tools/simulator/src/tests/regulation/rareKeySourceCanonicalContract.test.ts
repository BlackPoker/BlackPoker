import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { loadRulePackageFromDirectory, clearRulePackageCache } from "../../engine/rules/RuleLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { GameSession } from "../../engine/session/GameSession";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { KnownCardView } from "../../domain/decision/PlayerObservation";
import { STANDARD_54_DECK_CARDS } from "../../engine/regulation/SimulatorDeckProfileResolver";
import { RulePackage } from "../../domain/rules/RulePackage";

/**
 * ============================================================================
 * Canonical Rare Card Key Source Contract Tests
 * [BP-SIM-REG-4.0-G-RARE-KEY-SOURCE-CANONICAL-REOPEN]
 *
 * 【Rule Author Canonical Decision】
 * - レアカード置き場（Rare Card zone）は手札（Hand）とは異なる独立したゾーンであるが、
 *   レアカードをキーカードとするアクション（action.rareSummon, action.trapCounter）においては、
 *   ルール作者公認の正当な例外として「特別な手札」のような供給元ゾーン（source = "rare"）として
 *   直接キーカードを取り出して使用する。
 * - レアドロー（action.rareDraw: rare -> hand）はレア召喚や罠カウンターの事前必須ステップではない。
 * - 手札のカードは、印刷上の同一性（スーツ・ランク）があってもレアカード置き場の代替にはならない
 *   （物理カード単位・ゾーン準拠のフェイルクローズドモデル）。
 * - カードがレアカード置き場から離れた後、恒久的な "isRare" 属性が付与されることはない。
 * ============================================================================
 */
describe("Canonical Rare Key Source Contract [BP-SIM-REG-4.0-G-RARE-KEY-SOURCE-CANONICAL-REOPEN]", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let rarePackRulePackage: RulePackage;

  beforeAll(async () => {
    clearRegulationCache();
    clearRulePackageCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const standardFormat = await getFormat("standard");
    const rarePackFrame = await getFrame("rarePack");
    const standardRarePackReg = await getRegulation("standard-rarePack");
    rarePackRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardRarePackReg,
      rarePackFrame
    );
  });

  // =========================================================================
  // 1. Rare Summon Direct Use & Lifecycle (Section 11, 12, 28, 29)
  // =========================================================================
  describe("1. Rare Summon Direct Use Contract", () => {
    it("1.1: Rare Summon does not require Rare Draw; Rare zone is a direct Key Card source", async () => {
      const reg = await getRegulation("standard-rarePack");
      const frame = await getFrame("rarePack");
      const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const session = new GameSession(outcome.state, rarePackRulePackage, {
        matchId: "match-test-rare-summon-canonical",
      });
      const turnPlayer = session.state.turnPlayer;
      const opponentPlayer = turnPlayer === "p1" ? "p2" : "p1";

      // 条件整備: Life <= 9
      const excessLife = session.state.players[turnPlayer].life.splice(9);
      session.state.players[turnPlayer].grave.push(...excessLife);

      // 初期状態確認: レアカードはレアカード置き場に1枚存在し、レアドローは実行されていない
      expect(session.state.players[turnPlayer].rareCards).toHaveLength(1);
      const rareCard = session.state.players[turnPlayer].rareCards[0];
      expect(rareCard).toBeDefined();

      // カード保存則確認
      expect(() => {
        OfficialRegulationMatchSetup.verifyCardConservation(
          turnPlayer,
          session.state.players[turnPlayer],
          STANDARD_54_DECK_CARDS,
          session.state
        );
      }).not.toThrow();

      // 観測契約 (Section 29): 使用前、自身はKNOWN、相手は秘密（countのみ）
      const obsBeforeTurnPlayer = ObservationFactory.createObservation(session.state, turnPlayer);
      const obsBeforeOpponent = ObservationFactory.createObservation(session.state, opponentPlayer);
      const tpRareView = obsBeforeTurnPlayer.players.find((p) => p.playerId === turnPlayer)?.rareCards;
      const oppRareView = obsBeforeOpponent.players.find((p) => p.playerId === turnPlayer)?.rareCards;
      expect(tpRareView?.cards[0]?.visibility).toBe("KNOWN");
      expect(oppRareView?.count).toBe(1);
      expect(oppRareView?.canViewCards).toBe(false);
      expect(oppRareView?.cards).toEqual([]);

      const initialFieldCount = session.state.players[turnPlayer].field.length; // 2 preset units

      // Step 1: Advance -> WAITING_FOR_DECISION
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      // LegalPatternGenerator は Rare Draw を経ずに直接 rareSummon を生成すること
      const qsPatternIdx = step.request.patterns.findIndex(
        (p: any) =>
          p.kind === "ACTION" &&
          step.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.rareSummon"
      );
      expect(qsPatternIdx).toBeGreaterThanOrEqual(0);

      const selectedPattern = step.request.patterns[qsPatternIdx];
      const keyRef = selectedPattern.keyCardSelectionRef!;
      const selectedKeyCardId = step.request.catalog.cardSelections[keyRef].cardIds[0];
      // 選択されたキーカードはレアカード置き場の物理カードそのものであること
      expect(selectedKeyCardId).toBe(rareCard.id);

      // Step 2: リクエスト送信 (リクエスト作成 & コストS支払い)
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: qsPatternIdx,
      });

      // レアカード置き場は空になる
      expect(session.state.players[turnPlayer].rareCards).toHaveLength(0);

      // ステージにリクエストが積載され、キーカードが載っている
      expect(session.state.stage.requests).toHaveLength(1);
      const stageReq = session.state.stage.requests[0];
      expect(stageReq.actionId).toBe("action.rareSummon");
      expect(stageReq.keyCards?.[0].id).toBe(rareCard.id);

      // コストS支払い: 戦場のキャラクター1体が墓地へ
      expect(session.state.players[turnPlayer].field).toHaveLength(initialFieldCount - 1);

      // 観測契約 (Section 29): visibilityOnRequest: public により、コントローラー・対戦相手双方からKNOWN
      const obsAfterTurnPlayer = ObservationFactory.createObservation(session.state, turnPlayer);
      const obsAfterOpponent = ObservationFactory.createObservation(session.state, opponentPlayer);
      const tpReqKeyCard = obsAfterTurnPlayer.stageRequests[0].keyCards?.[0] as KnownCardView;
      const oppReqKeyCard = obsAfterOpponent.stageRequests[0].keyCards?.[0] as KnownCardView;
      expect(tpReqKeyCard?.visibility).toBe("KNOWN");
      expect(oppReqKeyCard?.visibility).toBe("KNOWN");
      expect(oppReqKeyCard.suit).toBe(rareCard.suit);
      expect(oppReqKeyCard.rank).toBe(rareCard.rank);
      expect(oppReqKeyCard.cardInstanceId).toBe(rareCard.id);

      // カード保存則確認 (ステージリクエスト中)
      expect(() => {
        OfficialRegulationMatchSetup.verifyCardConservation(
          turnPlayer,
          session.state.players[turnPlayer],
          STANDARD_54_DECK_CARDS,
          session.state
        );
      }).not.toThrow();

      // Step 3: 両プレイヤーPASSでステージ解決
      while (step.type === "WAITING_FOR_DECISION" && (session.state.stage?.requests?.length || 0) > 0) {
        const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passIdx === -1) break;
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passIdx,
        });
      }

      // Step 4: 解決結果の検証 (request -> field)
      expect(session.state.stage.requests).toHaveLength(0);
      expect(session.state.players[turnPlayer].field).toHaveLength(initialFieldCount);
      const summonedUnit = session.state.players[turnPlayer].field.find(
        (u: any) => u.cards?.[0]?.id === rareCard.id
      );
      expect(summonedUnit).toBeDefined();
      expect(summonedUnit.face).toBe("up");
      expect(summonedUnit.state).toBe("charge");
      expect(summonedUnit.cards[0].id).toBe(rareCard.id);

      // 解決後の54枚カード保存則
      expect(() => {
        OfficialRegulationMatchSetup.verifyCardConservation(
          turnPlayer,
          session.state.players[turnPlayer],
          STANDARD_54_DECK_CARDS,
          session.state
        );
      }).not.toThrow();

      // Canonical Match Log 検証 (Section 28)
      const matchLog = session.getMatchLog();
      const cardMovedEvents = matchLog.events.filter((e) => e.type === "card.moved") as any[];

      // Key moves: rare -> request
      const keyRareToReq = cardMovedEvents.find(
        (e) =>
          e.cardId === rareCard.id &&
          e.from.kind === "zone" &&
          e.from.zone === "rare" &&
          e.to.kind === "request"
      );
      expect(keyRareToReq).toBeDefined();

      // Key moves: request -> field
      const keyReqToField = cardMovedEvents.find(
        (e) =>
          e.cardId === rareCard.id &&
          e.from.kind === "request" &&
          e.to.kind === "zone" &&
          e.to.zone === "field"
      );
      expect(keyReqToField).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Trap Counter Direct Use Contract (Section 13)
  // =========================================================================
  describe("2. Trap Counter Direct Use Contract", () => {
    it("2.1: Trap Counter does not require Rare Draw; consumes Rare card directly from Rare zone and cancels matched request", () => {
      const trapRare = { id: "p1-rare-7", suit: "S", rank: "7", value: 7 };
      const targetKey = { id: "p2-hand-7", suit: "S", rank: "7", value: 7 }; // Different physical ID, same printed card

      const targetReq = {
        id: "req-up-target",
        actionId: "action.up",
        controller: "p2",
        status: "pending",
        keyCards: [targetKey],
      };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p2",
        chancePlayer: "p1",
        players: {
          p1: {
            name: "Player A",
            rareCards: [trapRare],
            hand: [{ id: "p1-h1", suit: "H", rank: "2", value: 2 }],
            life: [{ id: "p1-l1", suit: "H", rank: "3", value: 3 }],
            grave: [],
            field: [],
          },
          p2: {
            name: "Player B",
            rareCards: [],
            hand: [],
            life: [{ id: "p2-l1", suit: "C", rank: "4", value: 4 }],
            grave: [],
            field: [],
          },
        },
        stage: {
          requests: [targetReq],
          history: [],
        },
      };

      const trapDef = rarePackRulePackage.actions.find((a) => a.id === "action.trapCounter")!;
      expect(trapDef).toBeDefined();

      // LegalPatternGenerator checks eligibility with source=rare directly
      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rarePackRulePackage);
      const trapPatterns = decision.request.patterns.filter(
        (p: any) =>
          p.kind === "ACTION" &&
          decision.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.trapCounter"
      );
      expect(trapPatterns).toHaveLength(1);

      // Key card is taken from rareCards
      const keyRef = trapPatterns[0].keyCardSelectionRef!;
      expect(decision.request.catalog.cardSelections[keyRef].cardIds[0]).toBe(trapRare.id);

      // Execute via GameSession
      const session = new GameSession(state, rarePackRulePackage, { matchId: "match-test-trap-canonical" });
      const step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const trapPatternIdx = step.request.patterns.findIndex(
        (p: any) =>
          p.kind === "ACTION" &&
          step.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.trapCounter"
      );
      expect(trapPatternIdx).toBeGreaterThanOrEqual(0);

      session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: trapPatternIdx,
      });

      // Immediate resolution:
      // 1. Rare card consumed from p1.rareCards directly
      expect(session.state.players.p1.rareCards).toHaveLength(0);
      expect(session.state.players.p1.grave).toContainEqual(trapRare);

      // 2. Matching target request was cancelled and removed from stage
      expect(session.state.stage.requests).toHaveLength(0);
      expect(session.state.players.p2.grave).toContainEqual(targetKey);
    });

    it("2.2: Trap Counter with unmatched printed key card consumes Rare card but leaves target request pending", () => {
      const trapRare = { id: "p1-rare-7", suit: "S", rank: "7", value: 7 };
      const unmatchedTargetKey = { id: "p2-hand-9", suit: "H", rank: "9", value: 9 };

      const targetReq = {
        id: "req-target-unmatched",
        actionId: "action.up",
        controller: "p2",
        status: "pending",
        keyCards: [unmatchedTargetKey],
      };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p2",
        chancePlayer: "p1",
        players: {
          p1: {
            name: "Player A",
            rareCards: [trapRare],
            hand: [],
            life: [{ id: "p1-l1", suit: "H", rank: "3", value: 3 }],
            grave: [],
            field: [],
          },
          p2: {
            name: "Player B",
            rareCards: [],
            hand: [],
            life: [{ id: "p2-l1", suit: "C", rank: "4", value: 4 }],
            grave: [],
            field: [],
          },
        },
        stage: {
          requests: [targetReq],
          history: [],
        },
      };

      const session = new GameSession(state, rarePackRulePackage);
      const step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const trapPatternIdx = step.request.patterns.findIndex(
        (p: any) =>
          p.kind === "ACTION" &&
          step.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.trapCounter"
      );
      expect(trapPatternIdx).toBeGreaterThanOrEqual(0);

      session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: trapPatternIdx,
      });

      // Rare card consumed to grave
      expect(session.state.players.p1.rareCards).toHaveLength(0);
      expect(session.state.players.p1.grave).toContainEqual(trapRare);

      // But target request was NOT cancelled (still on stage because key cards did not match)
      expect(session.state.stage.requests).toHaveLength(1);
      expect(session.state.stage.requests[0].id).toBe("req-target-unmatched");
    });
  });

  // =========================================================================
  // 3. Hand Must Not Substitute for Rare Zone (Section 14 & 16)
  // =========================================================================
  describe("3. Hand Substitution Fail-Closed & Physical Identity", () => {
    const validator = new ActionRequestValidator();

    it("3.1: Case A - Rare zone empty, Hand has normal card: Rare Summon fails closed without mutation", () => {
      const handCard = { id: "c-hand-normal", suit: "S", rank: "A", value: 1 };
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            rareCards: [],
            hand: [handCard],
            field: [{ unitId: "u-sac", componentId: "character.bulwark", cards: [{ id: "c-bul" }] }],
            life: Array.from({ length: 9 }, (_, i) => ({ id: `l-${i}` })),
            grave: [],
          },
          p2: { rareCards: [], hand: [], field: [], life: [], grave: [] },
        },
        stage: { requests: [] },
      };

      const rareSummonDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

      // Pattern generator produces no rareSummon pattern
      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rarePackRulePackage);
      const pattern = decision.request.patterns.find(
        (p: any) =>
          p.kind === "ACTION" &&
          decision.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.rareSummon"
      );
      expect(pattern).toBeUndefined();

      // Validator throws ValidationError for card in Hand
      expect(() => {
        validator.validateActionRequest(rareSummonDef, {
          state,
          playerKey: "p1",
          keyCard: handCard,
          components: rarePackRulePackage.components,
        });
      }).toThrow(ValidationError);

      // State remains completely unmutated
      expect(state.players.p1.rareCards).toHaveLength(0);
      expect(state.players.p1.hand).toHaveLength(1);
      expect(state.players.p1.field).toHaveLength(1);
    });

    it("3.2: Case B - Rare zone empty, Hand has card with same printed identity as former Rare card: still fails closed", () => {
      const formerRareIdentityInHand = { id: "c-hand-joker", suit: "J", rank: "Joker", value: 0 };
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            rareCards: [],
            hand: [formerRareIdentityInHand],
            field: [{ unitId: "u-sac", componentId: "character.bulwark", cards: [{ id: "c-bul" }] }],
            life: Array.from({ length: 8 }, (_, i) => ({ id: `l-${i}` })),
            grave: [],
          },
          p2: { rareCards: [], hand: [], field: [], life: [], grave: [] },
        },
        stage: { requests: [] },
      };

      const rareSummonDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

      expect(() => {
        validator.validateActionRequest(rareSummonDef, {
          state,
          playerKey: "p1",
          keyCard: formerRareIdentityInHand,
          components: rarePackRulePackage.components,
        });
      }).toThrow(/指定元ゾーン 'rare' に存在しません/);
    });

    it("3.3: Case C - Rare zone has Card A, Hand has Card B with same printed suit/rank: physical identity enforces Card A", () => {
      const rareCardA = { id: "p1-phys-rare-A", suit: "J", rank: "Joker", value: 0 };
      const handCardB = { id: "p1-phys-hand-B", suit: "J", rank: "Joker", value: 0 };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            rareCards: [rareCardA],
            hand: [handCardB],
            field: [{ unitId: "u-sac", componentId: "character.bulwark", cards: [{ id: "c-bul" }] }],
            life: Array.from({ length: 7 }, (_, i) => ({ id: `l-${i}` })),
            grave: [],
          },
          p2: { rareCards: [], hand: [], field: [], life: [], grave: [] },
        },
        stage: { requests: [] },
      };

      const rareSummonDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

      // Card A from rare zone succeeds validation
      expect(() => {
        validator.validateActionRequest(rareSummonDef, {
          state,
          playerKey: "p1",
          keyCard: rareCardA,
          components: rarePackRulePackage.components,
        });
      }).not.toThrow();

      // Card B from hand zone is rejected (physical ID mismatch in rareCards)
      expect(() => {
        validator.validateActionRequest(rareSummonDef, {
          state,
          playerKey: "p1",
          keyCard: handCardB,
          components: rarePackRulePackage.components,
        });
      }).toThrow(/指定元ゾーン 'rare' に存在しません/);

      // LegalPatternGenerator uses Card A, never Card B
      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rarePackRulePackage);
      const rarePatterns = decision.request.patterns.filter(
        (p: any) =>
          p.kind === "ACTION" &&
          decision.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.rareSummon"
      );
      expect(rarePatterns.length).toBeGreaterThan(0);
      for (const pat of rarePatterns) {
        const keyRef = pat.keyCardSelectionRef!;
        const cardId = decision.request.catalog.cardSelections[keyRef].cardIds[0];
        expect(cardId).toBe(rareCardA.id);
        expect(cardId).not.toBe(handCardB.id);
      }
    });
  });

  // =========================================================================
  // 4. Rare Draw Interaction Contract (Section 15)
  // =========================================================================
  describe("4. Rare Draw Interaction Contract", () => {
    it("4.1: Executing Rare Draw moves rare card to hand; subsequent Rare Summon cannot be activated (zone-based model)", () => {
      const rareCard = { id: "p1-draw-rare", suit: "J", rank: "Joker", value: 0 };
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            rareCards: [rareCard],
            hand: [],
            field: [{ unitId: "u-sac", componentId: "character.bulwark", cards: [{ id: "c-bul" }] }],
            life: Array.from({ length: 8 }, (_, i) => ({ id: `l-${i}` })),
            grave: [],
          },
          p2: { rareCards: [], hand: [], field: [], life: [{ id: "p2-l1", suit: "C", rank: "4", value: 4 }], grave: [] },
        },
        stage: { requests: [] },
      };

      const session = new GameSession(state, rarePackRulePackage);
      const step1: any = session.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");

      // Find Rare Draw pattern
      const rareDrawPatternIdx = step1.request.patterns.findIndex(
        (p: any) =>
          p.kind === "ACTION" &&
          step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.rareDraw"
      );
      expect(rareDrawPatternIdx).toBeGreaterThanOrEqual(0);

      // Submit Rare Draw
      const step2: any = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: rareDrawPatternIdx,
      });

      // Verification: Rare card is now in hand, Rare zone is empty
      expect(session.state.players.p1.rareCards).toHaveLength(0);
      expect(session.state.players.p1.hand).toContainEqual(rareCard);

      // In this state, Rare Summon CANNOT be activated because Rare zone is empty
      const step3: any = session.advance();
      expect(step3.type).toBe("WAITING_FOR_DECISION");
      const rareSummonAfterDraw = step3.request.patterns.find(
        (p: any) =>
          p.kind === "ACTION" &&
          step3.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.rareSummon"
      );
      expect(rareSummonAfterDraw).toBeUndefined();

      // No persistent Rare identity exists: card in hand does not satisfy source=rare
      const validator = new ActionRequestValidator();
      const rareSummonDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;
      expect(() => {
        validator.validateActionRequest(rareSummonDef, {
          state: session.state,
          playerKey: "p1",
          keyCard: rareCard,
          components: rarePackRulePackage.components,
        });
      }).toThrow(/指定元ゾーン 'rare' に存在しません/);
    });
  });
});
