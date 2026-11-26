import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import {
  GameSession,
  REQUEST_KEY_CARD_FINALIZATION_STEP_ID,
} from "../../engine/session/GameSession";
import { GameSessionSnapshotCodec } from "../../engine/session/GameSessionSnapshotCodec";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRegulationCatalog, clearRegulationCache } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { SimulatorDeckProfileResolver } from "../../engine/regulation/SimulatorDeckProfileResolver";
import { RareCardSelectionService } from "../../engine/regulation/RareCardSelectionService";
import { ScenarioHandSelectionService } from "../../engine/regulation/ScenarioHandSelectionService";
import { cleanupFogsHandler } from "../../engine/rules/commandHandlers";
import { startMatchAttempt, CORE_BATTLE_ENV_ID } from "../../engine/playtest/PlaytestEnvironmentController";
import { selectAutoGraveTopCandidate } from "../../engine/playtest/GraveTopAutoSelector";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService";
import type { ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes";
import { StateHasher } from "../../engine/simulation/StateHasher";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const simulatorRoot = path.resolve(__dirname, "../../..");

interface RecordedZoneTopPrompt {
  readonly playerId: string;
  readonly reason: string | undefined;
  readonly effectStepId: string | undefined;
  readonly candidateCardIds: readonly string[];
  readonly selectedCardId: string;
}

describe("作業6: 共通キーカード同時墓地移動・墓地TOP選択・境界整合性 E2E テスト", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let masterRulePackage: RulePackage;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog(path.join(simulatorRoot, "src/data/regulations"));
    fullRulePackage = await loadRulePackageFromDirectory(path.join(simulatorRoot, "src/data/rules-vnext"));
    const format = catalog.formats.get("mast")!;
    const regulation = catalog.regulations.get("mast-strategy")!;
    const frame = catalog.frames.get("strategy")!;
    masterRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      format,
      regulation,
      frame
    );
  });

  function createBulwark(unitId: string, cardId: string, suit: "D" | "H" | "S" | "C", rank: string, value: number, enteredFieldTurn = 1, state: "charge" | "drive" = "charge") {
    return {
      unitId,
      componentId: "character.bulwark",
      kind: "防壁",
      cards: [{ id: cardId, suit, rank, value }],
      face: "down",
      state,
      labels: ["defense"],
      enteredTurn: enteredFieldTurn,
      enteredFieldTurn,
      enteredFieldBeforeGame: false,
    };
  }

  function createSoldier(unitId: string, cardId: string, suit: "S" | "H" | "D" | "C", rank: string, value: number, enteredFieldTurn = 1, state: "charge" | "drive" = "charge") {
    return {
      unitId,
      componentId: "character.soldier",
      kind: "一般兵",
      cards: [{ id: cardId, suit, rank, value }],
      face: "up",
      state,
      labels: ["attack", "defense"],
      enteredTurn: enteredFieldTurn,
      enteredFieldTurn,
      enteredFieldBeforeGame: false,
    };
  }

  function createBaseMasterState(turnCount = 1): any {
    return {
      stateVersion: 1,
      turn: turnCount,
      turnCount,
      turnPlayer: "p1",
      chancePlayer: "p1",
      focusPlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [
            { id: "p1-l1", suit: "H", rank: "2", value: 2 },
            { id: "p1-l2", suit: "H", rank: "3", value: 3 },
            { id: "p1-l3", suit: "H", rank: "4", value: 4 },
            { id: "p1-l4", suit: "D", rank: "9", value: 9 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          graveTopCardId: undefined,
          rareCards: [],
        },
        p2: {
          name: "Player 2",
          life: [
            { id: "p2-l1", suit: "D", rank: "5", value: 5 },
            { id: "p2-l2", suit: "D", rank: "6", value: 6 },
            { id: "p2-l3", suit: "D", rank: "7", value: 7 },
            { id: "p2-l4", suit: "D", rank: "8", value: 8 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          graveTopCardId: undefined,
          rareCards: [],
        },
      },
      stage: {
        requests: [],
        history: [],
        pendingDamage: null,
        pendingEndTurn: false,
      },
      turnUsage: {
        p1: { actions: {} },
        p2: { actions: {} },
      },
    };
  }

  function findActionPatternRef(
    req: any,
    actionId: string,
    predicate?: (pattern: any, catalog: any) => boolean
  ): number {
    return req.patterns.findIndex((p: any) => {
      if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
      const act = req.catalog.actions?.[p.actionSelectionRef];
      if (act?.actionId !== actionId) return false;
      return predicate ? predicate(p, req.catalog) : true;
    });
  }

  function getZoneTopCandidates(req: any): { cardId: string; patternRef: number }[] {
    const out: { cardId: string; patternRef: number }[] = [];
    for (let i = 0; i < req.patterns.length; i++) {
      const p = req.patterns[i];
      if (p.effectSelectionRef === undefined) continue;
      const eff = req.catalog.effectSelections?.[p.effectSelectionRef];
      const cardId = eff?.selectedValues?.[0];
      if (typeof cardId === "string") {
        out.push({ cardId, patternRef: i });
      }
    }
    return out;
  }

  function selectZoneTopRefByCardId(req: any, targetCardId: string): number {
    const candidates = getZoneTopCandidates(req);
    const hit = candidates.find((c) => c.cardId === targetCardId);
    if (!hit) {
      throw new Error(
        `Card ${targetCardId} not found in ZONE_TOP_SELECTION candidates: [${candidates
          .map((c) => c.cardId)
          .join(", ")}]`
      );
    }
    return hit.patternRef;
  }

  function getGraveFlatCards(player: any): any[] {
    const cards: any[] = [];
    for (const entry of player.grave || []) {
      if (Array.isArray(entry.cards)) {
        cards.push(...entry.cards);
      } else if (entry?.card?.id) {
        cards.push(entry.card);
      } else if (entry?.id) {
        cards.push(entry);
      }
    }
    return cards;
  }

  function passUntil(
    session: GameSession,
    initialStep: any,
    options?: {
      maxSteps?: number;
      stopWhen?: (step: any) => boolean;
      chooseZoneTop?: (req: any, recorded: RecordedZoneTopPrompt[]) => string | undefined;
    }
  ): { step: any; zoneTopPrompts: RecordedZoneTopPrompt[] } {
    let step = initialStep;
    const zoneTopPrompts: RecordedZoneTopPrompt[] = [];
    const maxSteps = options?.maxSteps ?? 40;

    for (let i = 0; i < maxSteps && step.type === "WAITING_FOR_DECISION"; i++) {
      if (options?.stopWhen?.(step)) {
        return { step, zoneTopPrompts };
      }

      const req = step.request;
      if (req.source?.type === "ZONE_TOP_SELECTION") {
        const candidates = getZoneTopCandidates(req);
        const preferred = options?.chooseZoneTop?.(req, zoneTopPrompts);
        const selected = preferred
          ? candidates.find((c) => c.cardId === preferred) ?? candidates[0]
          : candidates[0];
        zoneTopPrompts.push({
          playerId: req.playerId,
          reason: req.source.reason,
          effectStepId: (req.source as any).effectStepId,
          candidateCardIds: candidates.map((c) => c.cardId),
          selectedCardId: selected.cardId,
        });
        step = session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: selected.patternRef,
        });
        continue;
      }

      if (
        (session.state as any).stage.requests.length === 0 &&
        !session.resolvingRequest &&
        req.source?.type === "ACTION_REQUEST"
      ) {
        return { step, zoneTopPrompts };
      }

      const passRef = req.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passRef < 0) {
        return { step, zoneTopPrompts };
      }
      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passRef,
      });
    }

    return { step, zoneTopPrompts };
  }

  function verifyPlayerConservationWithStage(
    session: GameSession,
    playerKey: "p1" | "p2",
    expectedDeck: readonly any[]
  ) {
    const state = session.state as any;
    const additionalCards: any[] = [];
    if (Array.isArray(state.stage?.requests)) {
      for (const req of state.stage.requests) {
        if (req.controller === playerKey && Array.isArray(req.keyCards)) {
          additionalCards.push(...req.keyCards);
        }
      }
    }
    if (
      session.resolvingRequest &&
      session.resolvingRequest.controller === playerKey &&
      Array.isArray(session.resolvingRequest.keyCards)
    ) {
      const player = state.players[playerKey];
      const zoneIds = new Set<string>([
        ...(player.life || []).map((c: any) => c.id),
        ...(player.hand || []).map((c: any) => c.id),
        ...(player.pack?.cards || []).map((c: any) => c.id),
        ...(player.rareCards || []).map((c: any) => c.id),
        ...getGraveFlatCards(player).map((c: any) => c.id),
        ...(player.field || []).flatMap((u: any) => (u.cards || []).map((c: any) => c.id)),
        ...(player.fog || []).flatMap((f: any) => (f.cards || (f.card ? [f.card] : [])).map((c: any) => c.id)),
      ]);
      for (const kc of session.resolvingRequest.keyCards) {
        if (!additionalCards.some((c) => c.id === kc.id) && !zoneIds.has(kc.id)) {
          additionalCards.push(kc);
        }
      }
    }
    OfficialRegulationMatchSetup.verifyCardConservation(
      playerKey,
      state.players[playerKey],
      expectedDeck,
      additionalCards
    );
  }

  // ============================================================================
  // 1. 公式 YAML アクション（Master & Tactical）の共通キーカード同時墓地移動 E2E
  // ============================================================================
  describe("1. 実 YAML アクションにおける同時墓地移動と墓地TOP選択", () => {
    it("action.surprise (奇襲): 2枚キーカードの同時墓地移動・任意TOP選択・登場ターン継承・召喚酔いを検証", () => {
      const state = createBaseMasterState(3);
      state.players.p1.field = [
        createBulwark("bw-cost-1", "c-bw-c1", "D", "2", 2, 1, "charge"),
        createBulwark("bw-cost-2", "c-bw-c2", "D", "3", 3, 1, "charge"),
        createBulwark("old-bw", "c-old-bw", "S", "5", 5, 1, "drive"),
        createBulwark("new-bw", "c-new-bw", "H", "6", 6, 3, "drive"),
      ];
      state.players.p1.hand = [
        { id: "c-club-3", suit: "C", rank: "3", value: 3 },
        { id: "c-club-5", suit: "C", rank: "5", value: 5 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const surpriseRef = findActionPatternRef(step.request, "action.surprise");
      expect(surpriseRef).toBeGreaterThanOrEqual(0);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: surpriseRef,
      });

      const paused = passUntil(session, step, {
        stopWhen: (s) => s.request.source?.type === "ZONE_TOP_SELECTION",
      });
      expect(paused.step.type).toBe("WAITING_FOR_DECISION");
      expect(paused.step.request.playerId).toBe("p1");
      expect(paused.step.request.source).toMatchObject({
        type: "ZONE_TOP_SELECTION",
        zone: "grave",
        playerId: "p1",
        reason: "MULTI_CARD_GRAVE_MOVE",
      });

      const candidates = getZoneTopCandidates(paused.step.request).map((c) => c.cardId);
      expect(new Set(candidates)).toEqual(new Set(["c-club-3", "c-club-5"]));
      expect(candidates).toHaveLength(2);

      // 既定(index 0)ではない方のカードも任意指定でき、graveTopCardId に厳密反映される
      const nonFirstCardId = candidates[1];
      step = session.submitDecision({
        decisionId: paused.step.request.decisionId,
        stateVersion: paused.step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(paused.step.request, nonFirstCardId),
      });

      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(session.state.players.p1.graveTopCardId).toBe(nonFirstCardId);
      expect(getGraveFlatCards(session.state.players.p1).map((c) => c.id).sort()).toEqual([
        "c-club-3",
        "c-club-5",
      ]);

      // 変形後も登場ターンを継承し、old-bw のみアタック可能・new-bw は召喚酔いで除外
      const attackRef = findActionPatternRef(step.request, "action.attack");
      expect(attackRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: attackRef,
      });

      const attackEff = passUntil(session, step, {
        stopWhen: (s) => s.request.source?.type === "EFFECT_RESOLUTION",
      });
      const attackerIds = new Set<string>();
      for (const p of attackEff.step.request.patterns) {
        if (p.effectSelectionRef === undefined) continue;
        const sel = attackEff.step.request.catalog.effectSelections?.[p.effectSelectionRef];
        for (const v of sel?.selectedValues ?? []) attackerIds.add(v);
      }
      expect(attackerIds.has("old-bw")).toBe(true);
      expect(attackerIds.has("new-bw")).toBe(false);
    });

    it("action.swordRain (剣の雨): 効果による複数兵士墓地移動とキーカード2枚墓地移動が別バッチ・非混在で解決される", () => {
      const state = createBaseMasterState(1);
      state.players.p1.field = [
        createBulwark("bw-1", "c-bw-1", "D", "5", 5),
        createBulwark("bw-2", "c-bw-2", "D", "6", 6),
        createSoldier("p1-s1", "c-p1-s1", "C", "3", 3),
        createSoldier("p1-s2", "c-p1-s2", "C", "4", 4),
      ];
      state.players.p2.field = [
        createSoldier("p2-s1", "c-p2-s1", "H", "2", 2),
        createSoldier("p2-s2", "c-p2-s2", "H", "5", 5),
      ];
      state.players.p1.hand = [
        { id: "c-key-s3", suit: "S", rank: "3", value: 3 },
        { id: "c-key-s4", suit: "S", rank: "4", value: 4 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const ref = findActionPatternRef(step.request, "action.swordRain");
      expect(ref).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: ref,
      });

      const resolved = passUntil(session, step, {
        chooseZoneTop: (req) => {
          const ids = getZoneTopCandidates(req).map((c) => c.cardId);
          // バッチ毎に決め打ちし、選択したカードが最終状態へ反映されるか確認
          if (ids.includes("c-p1-s2")) return "c-p1-s2";
          if (ids.includes("c-p2-s2")) return "c-p2-s2";
          if (ids.includes("c-key-s4")) return "c-key-s4";
          return ids[0];
        },
      });

      expect(resolved.step.type).toBe("WAITING_FOR_DECISION");
      // 破壊された兵士バッチとキーカードバッチが厳密分離して発生している
      expect(resolved.zoneTopPrompts.length).toBe(3);

      const p1SoldierBatch = resolved.zoneTopPrompts.find((p) =>
        p.candidateCardIds.includes("c-p1-s1")
      );
      const p2SoldierBatch = resolved.zoneTopPrompts.find((p) =>
        p.candidateCardIds.includes("c-p2-s1")
      );
      const p1KeyBatch = resolved.zoneTopPrompts.find((p) =>
        p.candidateCardIds.includes("c-key-s3")
      );
      expect(p1SoldierBatch).toBeDefined();
      expect(new Set(p1SoldierBatch!.candidateCardIds)).toEqual(new Set(["c-p1-s1", "c-p1-s2"]));
      expect(p1SoldierBatch!.playerId).toBe("p1");

      expect(p2SoldierBatch).toBeDefined();
      expect(new Set(p2SoldierBatch!.candidateCardIds)).toEqual(new Set(["c-p2-s1", "c-p2-s2"]));
      expect(p2SoldierBatch!.playerId).toBe("p2");

      expect(p1KeyBatch).toBeDefined();
      expect(new Set(p1KeyBatch!.candidateCardIds)).toEqual(new Set(["c-key-s3", "c-key-s4"]));
      expect(p1KeyBatch!.playerId).toBe("p1");

      // キーカード最終バッチが破壊兵士バッチ群の後で解決され、最終 TOP は c-key-s4
      expect(resolved.zoneTopPrompts.indexOf(p1KeyBatch!)).toBeGreaterThan(
        resolved.zoneTopPrompts.indexOf(p1SoldierBatch!)
      );
      expect(resolved.zoneTopPrompts.indexOf(p1KeyBatch!)).toBeGreaterThan(
        resolved.zoneTopPrompts.indexOf(p2SoldierBatch!)
      );
      expect(session.state.players.p1.graveTopCardId).toBe("c-key-s4");
      expect(session.state.players.p2.graveTopCardId).toBe("c-p2-s2");
    });

    it("action.bj (B・J): バースト経路では公開カード群→キーカード群が別バッチで、スタンド経路ではキーカード群のみ墓地TOP選択される", () => {
      // 1) バースト経路: 10 + 10 + 5 = 25 でバースト -> 公開3枚 + キー2枚の2バッチ
      const burstState = createBaseMasterState(1);
      burstState.players.p1.hand = [
        { id: "c-bj-sa", suit: "S", rank: "A", value: 1 },
        { id: "c-bj-hj", suit: "H", rank: "J", value: 11 },
      ];
      burstState.players.p1.life = [
        { id: "c-l-s10", suit: "S", rank: "10", value: 10 },
        { id: "c-l-hq", suit: "H", rank: "Q", value: 12 },
        { id: "c-l-d5", suit: "D", rank: "5", value: 5 },
        { id: "c-l-d2", suit: "D", rank: "2", value: 2 },
      ];

      const burstSession = new GameSession(burstState, masterRulePackage);
      let bStep: any = burstSession.advance();
      const bjBurstRef = findActionPatternRef(bStep.request, "action.bj");
      bStep = burstSession.submitDecision({
        decisionId: bStep.request.decisionId,
        stateVersion: bStep.request.stateVersion,
        selectedPatternRef: bjBurstRef,
      });

      const burstPrompts: RecordedZoneTopPrompt[] = [];
      let safety = 0;
      while (bStep.type === "WAITING_FOR_DECISION" && safety < 30) {
        safety++;
        const req = bStep.request;
        if (req.source?.type === "ACTION_REQUEST" && burstSession.state.stage.requests.length === 0 && !burstSession.resolvingRequest) {
          break;
        }
        if (req.source?.type === "ZONE_TOP_SELECTION") {
          const candidates = getZoneTopCandidates(req);
          const chosen = candidates.find((c) => c.cardId === "c-bj-hj")?.cardId ?? candidates[candidates.length - 1].cardId;
          burstPrompts.push({
            playerId: req.playerId,
            reason: req.source.reason,
            effectStepId: (req.source as any).effectStepId,
            candidateCardIds: candidates.map((c) => c.cardId),
            selectedCardId: chosen,
          });
          bStep = burstSession.submitDecision({
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: selectZoneTopRefByCardId(req, chosen),
          });
          continue;
        }
        if (req.source?.effectStepId === "playBlackjack") {
          const hitRef = req.patterns.findIndex((p: any) => {
            const eff = req.catalog.effectSelections?.[p.effectSelectionRef];
            return eff?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
          });
          expect(hitRef).toBeGreaterThanOrEqual(0);
          bStep = burstSession.submitDecision({
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: hitRef,
          });
          continue;
        }
        const passRef = req.patterns.findIndex((p: any) => p.kind === "PASS");
        bStep = burstSession.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      expect(burstPrompts).toHaveLength(2);
      expect(new Set(burstPrompts[0].candidateCardIds)).toEqual(new Set(["c-l-s10", "c-l-hq", "c-l-d5"]));
      expect(new Set(burstPrompts[1].candidateCardIds)).toEqual(new Set(["c-bj-sa", "c-bj-hj"]));
      expect(burstSession.state.players.p1.graveTopCardId).toBe("c-bj-hj");

      // 2) スタンド経路: 公開カードは手札へ移動し、キーカード2枚のみ墓地TOP選択
      const standState = createBaseMasterState(1);
      standState.players.p1.hand = [
        { id: "c-st-sa", suit: "S", rank: "A", value: 1 },
        { id: "c-st-hj", suit: "H", rank: "J", value: 11 },
      ];
      standState.players.p1.life = [
        { id: "c-st-l-s8", suit: "S", rank: "8", value: 8 },
        { id: "c-st-l-hk", suit: "H", rank: "K", value: 13 },
      ];

      const standSession = new GameSession(standState, masterRulePackage);
      let sStep: any = standSession.advance();
      const bjStandRef = findActionPatternRef(sStep.request, "action.bj");
      sStep = standSession.submitDecision({
        decisionId: sStep.request.decisionId,
        stateVersion: sStep.request.stateVersion,
        selectedPatternRef: bjStandRef,
      });

      const standPrompts: RecordedZoneTopPrompt[] = [];
      let standSafety = 0;
      while (sStep.type === "WAITING_FOR_DECISION" && standSafety < 20) {
        standSafety++;
        const req = sStep.request;
        if (req.source?.type === "ACTION_REQUEST" && standSession.state.stage.requests.length === 0 && !standSession.resolvingRequest) {
          break;
        }
        if (req.source?.type === "ZONE_TOP_SELECTION") {
          const candidates = getZoneTopCandidates(req);
          const chosen = "c-st-sa";
          standPrompts.push({
            playerId: req.playerId,
            reason: req.source.reason,
            effectStepId: (req.source as any).effectStepId,
            candidateCardIds: candidates.map((c) => c.cardId),
            selectedCardId: chosen,
          });
          sStep = standSession.submitDecision({
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: selectZoneTopRefByCardId(req, chosen),
          });
          continue;
        }
        if (req.source?.effectStepId === "playBlackjack") {
          const standRef = req.patterns.findIndex((p: any) => {
            const eff = req.catalog.effectSelections?.[p.effectSelectionRef];
            return eff?.selectedValues?.[0] === "stand" || p.patternId?.includes("stand");
          });
          sStep = standSession.submitDecision({
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: standRef,
          });
          continue;
        }
        const passRef = req.patterns.findIndex((p: any) => p.kind === "PASS");
        sStep = standSession.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      expect(standPrompts).toHaveLength(1);
      expect(new Set(standPrompts[0].candidateCardIds)).toEqual(new Set(["c-st-sa", "c-st-hj"]));
      expect(standSession.state.players.p1.hand.map((c: any) => c.id)).toEqual(["c-st-l-s8"]);
      expect(standSession.state.players.p1.graveTopCardId).toBe("c-st-sa");
    });

    it("action.force (フォース): 解決時は Fog 移動により墓地TOP選択なし、cleanupFogs で複数Fogカードが墓地へ移動", () => {
      const state = createBaseMasterState(1);
      state.players.p1.field = [
        createBulwark("bw-1", "c-bw-1", "D", "2", 2),
        createBulwark("bw-2", "c-bw-2", "D", "3", 3),
        createSoldier("p1-s1", "c-p1-s1", "C", "5", 5),
      ];
      state.players.p1.hand = [
        { id: "c-force-h6", suit: "H", rank: "6", value: 6 },
        { id: "c-force-h8", suit: "H", rank: "8", value: 8 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const forceRef = findActionPatternRef(step.request, "action.force");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: forceRef,
      });

      const resolved = passUntil(session, step);
      expect(resolved.zoneTopPrompts).toHaveLength(0);
      expect(session.state.players.p1.grave).toHaveLength(0);
      expect(session.state.players.p1.fog).toHaveLength(1);
      expect(session.state.players.p1.fog[0].cards.map((c: any) => c.id)).toEqual([
        "c-force-h6",
        "c-force-h8",
      ]);

      // ターン終了時 cleanupFogs で2枚のFogカードが墓地へ移動
      const interpreter = session.registry.getEffectInterpreter();
      cleanupFogsHandler(interpreter)({}, {
        state: session.state,
        playerKey: "p1",
        components: masterRulePackage.components,
        actions: masterRulePackage.actions,
      });
      expect(session.state.players.p1.fog).toHaveLength(0);
      expect(getGraveFlatCards(session.state.players.p1).map((c) => c.id).sort()).toEqual([
        "c-force-h6",
        "c-force-h8",
      ]);
    });

    it("action.recruit (徴募): 効果中の順序選択後にキーカード2枚墓地TOP選択が実行され、効果が二重実行されないこと", () => {
      const state = createBaseMasterState(1);
      state.players.p1.field = [
        createBulwark("bw-1", "c-bw-1", "D", "2", 2),
        createBulwark("bw-2", "c-bw-2", "D", "3", 3),
      ];
      state.players.p1.hand = [
        { id: "c-rec-d2", suit: "D", rank: "2", value: 2 },
        { id: "c-rec-d3", suit: "D", rank: "3", value: 3 },
      ];
      state.players.p1.life = [
        { id: "c-l-s3", suit: "S", rank: "3", value: 3 },
        { id: "c-l-c6", suit: "C", rank: "6", value: 6 },
        { id: "c-l-h8", suit: "H", rank: "8", value: 8 },
        { id: "c-l-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-l-dk", suit: "D", rank: "K", value: 13 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const recruitRef = findActionPatternRef(step.request, "action.recruit");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      const orderStep = passUntil(session, step, {
        stopWhen: (s) => s.request.source?.effectStepId === "recruitUnitsFromLife",
      });
      expect(orderStep.step.type).toBe("WAITING_FOR_DECISION");
      expect(orderStep.zoneTopPrompts).toHaveLength(0);

      // 順序選択を提出
      step = session.submitDecision({
        decisionId: orderStep.step.request.decisionId,
        stateVersion: orderStep.step.request.stateVersion,
        selectedPatternRef: 0,
      });

      // 直後にキーカード2枚の ZONE_TOP_SELECTION が提示される（効果再開で二重実行されない）
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(step.request.source?.reason).toBe("MULTI_CARD_GRAVE_MOVE");
      const candidates = getZoneTopCandidates(step.request).map((c) => c.cardId);
      expect(new Set(candidates)).toEqual(new Set(["c-rec-d2", "c-rec-d3"]));

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(step.request, "c-rec-d3"),
      });

      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("ACTION_REQUEST");
      expect(session.state.players.p1.graveTopCardId).toBe("c-rec-d3");
      // 兵士は正確に 2 体 (s3, s2) のみ場に出ており、二重召募されていない
      const soldiers = session.state.players.p1.field.filter((u: any) => u.componentId === "character.soldier");
      expect(soldiers).toHaveLength(2);
      expect(session.state.players.p1.life).toHaveLength(3);
    });

    it("action.rsf (R・S・F): 5枚同時移動と、相手ライフ0到達時でも墓地TOP選択完了まで勝敗確定を遅延すること", () => {
      const state = createBaseMasterState(1);
      state.players.p1.field = [
        createBulwark("bw-1", "c-bw-1", "D", "2", 2),
        createBulwark("bw-2", "c-bw-2", "D", "3", 3),
      ];
      state.players.p1.hand = [
        { id: "c-rsf-sa", suit: "S", rank: "A", value: 1 },
        { id: "c-rsf-sk", suit: "S", rank: "K", value: 13 },
        { id: "c-rsf-sq", suit: "S", rank: "Q", value: 12 },
        { id: "c-rsf-sj", suit: "S", rank: "J", value: 11 },
        { id: "c-rsf-s10", suit: "S", rank: "10", value: 10 },
      ];
      // RSF ダメージで即ライフ0になるように相手ライフを1枚のみ配置
      state.players.p2.life = [{ id: "c-p2-last-life", suit: "H", rank: "4", value: 4 }];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const rsfRef = findActionPatternRef(
        step.request,
        "action.rsf",
        (p, cat) => cat.targetSelections?.[p.targetSelectionRef!]?.targetPlayerKey === "p2"
      );
      expect(rsfRef).toBeGreaterThanOrEqual(0);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: rsfRef,
      });

      const paused = passUntil(session, step, {
        stopWhen: (s) => s.request.source?.type === "ZONE_TOP_SELECTION",
      });

      // 相手ライフは既に 0 だが、5枚キーカードの墓地TOP選択が完了するまでは FINISHED に遷移しない
      expect(session.state.players.p2.life).toHaveLength(0);
      expect(paused.step.type).toBe("WAITING_FOR_DECISION");
      expect(paused.step.request.playerId).toBe("p1");
      expect(paused.step.request.source).toMatchObject({
        type: "ZONE_TOP_SELECTION",
        reason: "MULTI_CARD_GRAVE_MOVE",
      });
      const candidates = getZoneTopCandidates(paused.step.request).map((c) => c.cardId);
      expect(new Set(candidates)).toEqual(
        new Set(["c-rsf-sa", "c-rsf-sk", "c-rsf-sq", "c-rsf-sj", "c-rsf-s10"])
      );
      expect(candidates).toHaveLength(5);
      expect(session.resolvingRequest?.actionId).toBe("action.rsf");
      expect((session.state as any).winner).toBeUndefined();

      const finalStep: any = session.submitDecision({
        decisionId: paused.step.request.decisionId,
        stateVersion: paused.step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(paused.step.request, "c-rsf-sq"),
      });

      expect(session.state.players.p1.graveTopCardId).toBe("c-rsf-sq");
      expect(finalStep.type).toBe("FINISHED");
      expect(finalStep.result.winner).toBe("p1");
    });
  });

  // ============================================================================
  // 2. カウンター・即時割込による複数キーカードアクション打ち消し E2E
  // ============================================================================
  describe("2. カウンター・トラップカウンターによる打ち消し E2E", () => {
    it("通常カウンター (action.counter) が2枚キー action.kill を打ち消す際の 8段階順序と非混在を検証", () => {
      const state = createBaseMasterState(1);
      state.players.p1.hand = [
        { id: "c-p1-s4", suit: "S", rank: "4", value: 4 },
        { id: "c-p1-s5", suit: "S", rank: "5", value: 5 },
      ];
      state.players.p2.field = [createSoldier("u-p2-s", "c-p2-s", "D", "5", 5)];
      state.players.p2.hand = [
        { id: "c-p2-c7", suit: "C", rank: "7", value: 7 }, // counter key (Club)
        { id: "c-p2-h9", suit: "H", rank: "9", value: 9 }, // counter cost D (1 discard)
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      // p1 が 2枚キー action.kill を積む
      const killRef = findActionPatternRef(step.request, "action.kill");
      expect(killRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: killRef,
      });
      const killReqId = (session.state as any).stage.requests[0].id;
      expect((session.state as any).stage.requests).toHaveLength(1);

      // p1 が PASS -> p2 が action.counter (target: action.kill) を積む
      const p1Pass = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: p1Pass,
      });

      const counterRef = findActionPatternRef(step.request, "action.counter");
      expect(counterRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: counterRef,
      });
      const counterReqId = (session.state as any).stage.requests[1].id;

      // 全員パスで LIFO TOP (action.counter) の解決へ
      const paused = passUntil(session, step, {
        stopWhen: (s) => s.request.source?.type === "ZONE_TOP_SELECTION",
      });

      // [検証 1〜3] kill は stage.requests から除去済み、解決中カウンターは規則 5.4.5〜5.4.7 に従い Stage に残存、
      // kill の2枚のみが p1 墓地へ移動し、p2 の counter 完了前に p1 の 2枚墓地TOP選択が発生する
      expect((session.state as any).stage.requests.some((r: any) => r.id === killReqId)).toBe(false);
      expect((session.state as any).stage.requests.map((r: any) => r.id)).toEqual([counterReqId]);
      expect(session.resolvingRequest?.id).toBe(counterReqId);
      expect(paused.step.type).toBe("WAITING_FOR_DECISION");
      expect(paused.step.request.playerId).toBe("p1");
      expect(paused.step.request.source).toMatchObject({
        type: "ZONE_TOP_SELECTION",
        reason: "MULTI_CARD_GRAVE_MOVE",
        playerId: "p1",
      });
      const topCandidates = getZoneTopCandidates(paused.step.request).map((c) => c.cardId);
      expect(new Set(topCandidates)).toEqual(new Set(["c-p1-s4", "c-p1-s5"]));
      expect(topCandidates).toHaveLength(2);

      // counter のキーカード (c-p2-c7) はこの時点ではまだ p2 の墓地へ移動していない（混在・先送りなし）
      expect(getGraveFlatCards(session.state.players.p2).some((c) => c.id === "c-p2-c7")).toBe(false);

      // p1 が墓地TOP選択 (c-p1-s5)
      step = session.submitDecision({
        decisionId: paused.step.request.decisionId,
        stateVersion: paused.step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(paused.step.request, "c-p1-s5"),
      });

      // [検証 4〜8] p1 の TOP が c-p1-s5 確定後、counter の 1枚キー (c-p2-c7) が自動TOP移動、
      // counter 自身も Stage から除去されて解決完了し、kill は cancelled で history 1件のみ
      expect((session.state as any).stage.requests).toHaveLength(0);
      expect(session.resolvingRequest).toBeUndefined();
      expect(session.state.players.p1.graveTopCardId).toBe("c-p1-s5");
      expect(session.state.players.p2.graveTopCardId).toBe("c-p2-c7");
      expect(session.state.players.p2.field.some((u: any) => u.unitId === "u-p2-s")).toBe(true);

      const historyKill = (session.state as any).stage.history.filter((h: any) => h.id === killReqId);
      const historyCounter = (session.state as any).stage.history.filter((h: any) => h.id === counterReqId);
      expect(historyKill).toHaveLength(1);
      expect(historyKill[0].status).toBe("cancelled");
      expect(historyCounter).toHaveLength(1);
      expect(historyCounter[0].status).toBe("resolved");

      const events = session.getMatchLog().events;
      expect(events.some((e: any) => e.type === "request.cancelled" && e.requestId === killReqId)).toBe(true);
      expect(events.some((e: any) => e.type === "request.resolved" && e.requestId === killReqId)).toBe(false);
      expect(events.some((e: any) => e.type === "request.resolved" && e.requestId === counterReqId)).toBe(true);
    });

    it("即時トラップカウンター (action.trapCounter) が2枚キー action.reverse を打ち消し、Stage未積載・相手墓地TOP選択・自身レアキー後処理が成立すること", () => {
      const state = createBaseMasterState(1);
      state.players.p1.hand = [
        { id: "c-p1-h7", suit: "H", rank: "7", value: 7 },
        { id: "c-p1-d7", suit: "D", rank: "7", value: 7 },
      ];
      state.players.p2.field = [createSoldier("u-p2-s", "c-p2-s", "C", "6", 6)];
      // trapCounter は対象リクエストのキーカードとの同一 printed card 一致を要求するため H7 を配置
      state.players.p2.rareCards = [{ id: "c-p2-rare-h7", suit: "H", rank: "7", value: 7 }];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      const revRef = findActionPatternRef(step.request, "action.reverse");
      expect(revRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: revRef,
      });
      const revReqId = (session.state as any).stage.requests[0].id;

      // p1 パス -> p2 に action.trapCounter が提示される
      const p1Pass = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: p1Pass,
      });

      const trapRef = findActionPatternRef(step.request, "action.trapCounter");
      expect(trapRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: trapRef,
      });

      // Immediate なため Stage に積まれず即解決に入り、打ち消された reverse 所有者 (p1) へ ZONE_TOP_SELECTION が提示される
      expect((session.state as any).stage.requests).toHaveLength(0);
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p1");
      expect(step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(new Set(getZoneTopCandidates(step.request).map((c) => c.cardId))).toEqual(
        new Set(["c-p1-h7", "c-p1-d7"])
      );
      expect(getGraveFlatCards(session.state.players.p2).some((c) => c.id === "c-p2-rare-h7")).toBe(false);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(step.request, "c-p1-d7"),
      });

      expect(session.state.players.p1.graveTopCardId).toBe("c-p1-d7");
      expect(session.state.players.p2.graveTopCardId).toBe("c-p2-rare-h7");
      const unitAfter = session.state.players.p2.field.find((u: any) => u.unitId === "u-p2-s");
      expect(unitAfter.componentId).toBe("character.soldier");

      const events = session.getMatchLog().events;
      expect(
        events.some((e: any) => e.type === "stage.pushed" && e.actionRef === "action.trapCounter")
      ).toBe(false);
      expect(
        events.some((e: any) => e.type === "request.resolved" && e.requestId === revReqId)
      ).toBe(false);
      expect(
        events.some((e: any) => e.type === "request.cancelled" && e.requestId === revReqId)
      ).toBe(true);
    });

    it("打ち消し不可のマスター4アクション (swordRain / force / surprise / recruit) はカウンター対象外となること", () => {
      const setups: Array<{ actionId: string; hand: any[]; needBulwarks: boolean }> = [
        {
          actionId: "action.swordRain",
          hand: [
            { id: "c-u1", suit: "S", rank: "3", value: 3 },
            { id: "c-u2", suit: "S", rank: "4", value: 4 },
          ],
          needBulwarks: true,
        },
        {
          actionId: "action.surprise",
          hand: [
            { id: "c-u1", suit: "C", rank: "2", value: 2 },
            { id: "c-u2", suit: "C", rank: "3", value: 3 },
          ],
          needBulwarks: true,
        },
        {
          actionId: "action.force",
          hand: [
            { id: "c-u1", suit: "H", rank: "4", value: 4 },
            { id: "c-u2", suit: "H", rank: "5", value: 5 },
          ],
          needBulwarks: true,
        },
        {
          actionId: "action.recruit",
          hand: [
            { id: "c-u1", suit: "D", rank: "4", value: 4 },
            { id: "c-u2", suit: "D", rank: "5", value: 5 },
          ],
          needBulwarks: true,
        },
      ];

      for (const sCfg of setups) {
        const state = createBaseMasterState(1);
        if (sCfg.needBulwarks) {
          state.players.p1.field = [
            createBulwark("bw-1", "c-bw-1", "D", "2", 2),
            createBulwark("bw-2", "c-bw-2", "D", "3", 3),
            createBulwark("bw-target", "c-bw-t", "H", "2", 2),
          ];
        }
        state.players.p1.hand = sCfg.hand;
        state.players.p2.hand = [
          { id: "c-p2-c7", suit: "C", rank: "7", value: 7 },
          { id: "c-p2-h9", suit: "H", rank: "9", value: 9 },
        ];
        state.players.p2.rareCards = [{ id: "c-p2-rare", suit: "J", rank: "Joker", value: 0 }];

        const session = new GameSession(state, masterRulePackage);
        let step: any = session.advance();
        const actRef = findActionPatternRef(step.request, sCfg.actionId);
        expect(actRef).toBeGreaterThanOrEqual(0);
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: actRef,
        });
        const p1Pass = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: p1Pass,
        });
        expect(step.request.playerId).toBe("p2");
        expect(findActionPatternRef(step.request, "action.counter")).toBe(-1);
      }
    });
  });

  // ============================================================================
  // 3. 不発フィズル・手札返還・即時2枚キー境界
  // ============================================================================
  describe("3. 対象喪失フィズル・手札返還・即時2枚アクション境界", () => {
    it("対象喪失不発 (action.kill LIFO対象喪失): effectSkipped=true でも2枚キー同時墓地移動とTOP選択後に完了すること", () => {
      const state = createBaseMasterState(1);
      state.players.p1.hand = [
        { id: "c-p1-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-p1-s3", suit: "S", rank: "3", value: 3 },
      ];
      state.players.p2.hand = [
        { id: "c-p2-s4", suit: "S", rank: "4", value: 4 },
        { id: "c-p2-s5", suit: "S", rank: "5", value: 5 },
      ];
      state.players.p2.field = [createSoldier("u-shared-target", "c-shared-s", "D", "4", 4)];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      // p1 が u-shared-target を対象に action.kill を積む
      const p1Kill = findActionPatternRef(step.request, "action.kill");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: p1Kill,
      });
      const p1KillReqId = (session.state as any).stage.requests[0].id;

      const p1Pass = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: p1Pass,
      });

      // p2 も同じ u-shared-target を対象に action.kill を積む (LIFOで先に解決し対象を消滅させる)
      const p2Kill = findActionPatternRef(step.request, "action.kill");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: p2Kill,
      });
      const p2KillReqId = (session.state as any).stage.requests[1].id;

      // パスを進めて p2.kill を解決 (p2の2枚TOP選択まで進む)
      const firstPaused = passUntil(session, step, {
        stopWhen: (s) => s.request.source?.type === "ZONE_TOP_SELECTION",
      });
      expect(firstPaused.step.request.playerId).toBe("p2");
      step = session.submitDecision({
        decisionId: firstPaused.step.request.decisionId,
        stateVersion: firstPaused.step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(firstPaused.step.request, "c-p2-s5"),
      });

      // p2 のパス後、対象喪失した p1.kill の解決へ -> 不発でも p1 の2枚キー TOP 選択が提示される
      const secondPaused = passUntil(session, step, {
        stopWhen: (s) => s.request.source?.type === "ZONE_TOP_SELECTION",
      });
      expect(secondPaused.step.request.playerId).toBe("p1");
      expect(new Set(getZoneTopCandidates(secondPaused.step.request).map((c) => c.cardId))).toEqual(
        new Set(["c-p1-s2", "c-p1-s3"])
      );
      expect(session.resolvingRequest?.id).toBe(p1KillReqId);
      // 選択前はまだ request.resolved が記録されていない
      expect(
        session
          .getMatchLog()
          .events.some((e: any) => e.type === "request.resolved" && e.requestId === p1KillReqId)
      ).toBe(false);

      step = session.submitDecision({
        decisionId: secondPaused.step.request.decisionId,
        stateVersion: secondPaused.step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(secondPaused.step.request, "c-p1-s3"),
      });

      expect(session.state.players.p1.graveTopCardId).toBe("c-p1-s3");
      const fizzledEntry = (session.state as any).stage.history.find((h: any) => h.id === p1KillReqId);
      expect(fizzledEntry?.status).toBe("resolved");
      const p1ResolvedEvent = session
        .getMatchLog()
        .events.find((e: any) => e.type === "request.resolved" && e.requestId === p1KillReqId) as any;
      expect(p1ResolvedEvent).toBeDefined();
      expect(p1ResolvedEvent.effectSkipped).toBe(true);
      expect(
        session
          .getMatchLog()
          .events.some((e: any) => e.type === "request.resolved" && e.requestId === p2KillReqId)
      ).toBe(true);
    });

    it("action.unsummons (帰還): 2枚キーカードが手札へ戻る場合、解決時墓地移動0枚・TOP選択なしとなること", () => {
      const state = createBaseMasterState(1);
      state.players.p1.field = [
        createBulwark("bw-1", "c-bw-1", "D", "2", 2, 1, "charge"),
        createSoldier("p1-sol", "c-p1-sol", "C", "5", 5, 1, "charge"),
      ];
      state.players.p1.hand = [
        { id: "c-ret-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-ret-s9", suit: "S", rank: "9", value: 9 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const unsummonsRef = findActionPatternRef(step.request, "action.unsummons");
      expect(unsummonsRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: unsummonsRef,
      });

      const resolved = passUntil(session, step);
      expect(resolved.zoneTopPrompts).toHaveLength(0);
      expect(session.state.players.p1.grave).toHaveLength(0);
      expect(session.state.players.p1.hand.map((c: any) => c.id).sort()).toEqual([
        "c-p1-sol",
        "c-ret-s2",
        "c-ret-s9",
      ]);
    });

    it("即時(immediate) 2枚キーアクション: Stage未経由で resolvingRequest 上に停止し、墓地TOP選択後に完了すること", () => {
      const customImmediateAction: ActionDefinition = {
        id: "action.testImmediateTwoKeys",
        name: "テスト即時2キー",
        type: "magic",
        request: {
          trigger: "direct",
          speed: "immediate",
          timing: "quick",
        },
        key: {
          id: "keys",
          count: 2,
          sameSuit: true,
          condition: {
            card: { suit: "spade", rank: "A..10", zone: "hand" },
          },
        },
        text: { effect: "ライフから1枚引く" },
        effect: [{ drawFromLife: { amount: 1 } }],
      } as any;

      const customRulePackage: RulePackage = {
        ...masterRulePackage,
        actions: [...masterRulePackage.actions, customImmediateAction],
      };

      const state = createBaseMasterState(1);
      state.players.p1.hand = [
        { id: "c-imm-s3", suit: "S", rank: "3", value: 3 },
        { id: "c-imm-s6", suit: "S", rank: "6", value: 6 },
      ];

      const session = new GameSession(state, customRulePackage);
      let step: any = session.advance();
      const immRef = findActionPatternRef(step.request, "action.testImmediateTwoKeys");
      expect(immRef).toBeGreaterThanOrEqual(0);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: immRef,
      });

      // Stageには積まれず、即時に resolvingRequest 内で 2枚キー TOP 選択停止する
      expect((session.state as any).stage.requests).toHaveLength(0);
      expect(session.resolvingRequest?.actionId).toBe("action.testImmediateTwoKeys");
      expect(session.resolvingRequest?.status).toBe("resolving");
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(session.continuation?.effectStepId).toBe(REQUEST_KEY_CARD_FINALIZATION_STEP_ID);
      expect(new Set(getZoneTopCandidates(step.request).map((c) => c.cardId))).toEqual(
        new Set(["c-imm-s3", "c-imm-s6"])
      );

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(step.request, "c-imm-s6"),
      });

      expect(session.resolvingRequest).toBeUndefined();
      expect(session.state.players.p1.graveTopCardId).toBe("c-imm-s6");
      const events = session.getMatchLog().events;
      expect(
        events.some((e: any) => e.type === "stage.pushed" && e.actionRef === "action.testImmediateTwoKeys")
      ).toBe(false);
      expect(
        events.some((e: any) => e.type === "request.resolved" && e.actionRef === "action.testImmediateTwoKeys")
      ).toBe(true);
    });
  });

  // ============================================================================
  // 4. 解決完了境界・Snapshot V2・Replay / Undo・保存則・全公式レギュレーション Smoke
  // ============================================================================
  describe("4. 境界不変条件・Snapshot V2・Replay・Undo・保存則・全レギュレーション Smoke", () => {
    it("停止境界不変条件 & Snapshot V2 中断/復元で同一ハッシュ・同一イベント列へ合流すること", () => {
      const state = createBaseMasterState(1);
      state.players.p1.field = [
        createBulwark("bw-1", "c-bw-1", "D", "2", 2),
        createBulwark("bw-2", "c-bw-2", "D", "3", 3),
        createBulwark("bw-target", "c-bw-t", "D", "5", 5),
      ];
      state.players.p1.hand = [
        { id: "c-snap-c4", suit: "C", rank: "4", value: 4 },
        { id: "c-snap-c9", suit: "C", rank: "9", value: 9 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const surpriseRef = findActionPatternRef(step.request, "action.surprise");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: surpriseRef,
      });

      // p1 パス -> p2 パスで ZONE_TOP_SELECTION (REQUEST_KEY_CARD_FINALIZATION_STEP_ID) に到達
      const paused = passUntil(session, step, {
        stopWhen: (s) => s.request.source?.type === "ZONE_TOP_SELECTION",
      });
      expect(paused.step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(session.continuation?.effectStepId).toBe(REQUEST_KEY_CARD_FINALIZATION_STEP_ID);

      // 境界不変条件の検証
      const resolving = session.resolvingRequest;
      expect(resolving).toBeDefined();
      expect(resolving.status).toBe("resolving");
      expect((session.state as any).stage.requests).toHaveLength(0);
      expect((session.state as any).stage.history.some((h: any) => h.id === resolving.id)).toBe(false);

      const midEvents = session.getMatchLog().events;
      const keyCardMovedToGrave = midEvents.filter(
        (e: any) =>
          e.type === "card.moved" &&
          e.to?.kind === "zone" &&
          e.to?.zone === "grave" &&
          (e.cardId === "c-snap-c4" || e.cardId === "c-snap-c9")
      );
      expect(keyCardMovedToGrave).toHaveLength(2);
      expect(midEvents.some((e: any) => e.type === "decision.requested" && e.source === "ZONE_TOP_SELECTION")).toBe(true);
      expect(midEvents.some((e: any) => e.type === "request.resolved" && e.requestId === resolving.id)).toBe(false);
      expect(
        midEvents.some(
          (e: any) =>
            e.type === "zone.top.changed" && (e.cardId === "c-snap-c4" || e.cardId === "c-snap-c9")
        )
      ).toBe(false);

      // Snapshot V2 capture -> serialize -> deserialize -> restore
      const captured = GameSessionSnapshotCodec.capture(session);
      const serialized = GameSessionSnapshotCodec.serialize(captured);
      const deserialized = GameSessionSnapshotCodec.deserialize(serialized);
      const restoredSession = GameSessionSnapshotCodec.restore(deserialized, masterRulePackage);
      const restoredStep: any = restoredSession.advance();

      expect(restoredStep.type).toBe("WAITING_FOR_DECISION");
      expect(restoredStep.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(restoredSession.continuation?.effectStepId).toBe(REQUEST_KEY_CARD_FINALIZATION_STEP_ID);
      expect(restoredSession.resolvingRequest?.id).toBe(resolving.id);

      const chosenId = "c-snap-c9";
      const origAfter: any = session.submitDecision({
        decisionId: paused.step.request.decisionId,
        stateVersion: paused.step.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(paused.step.request, chosenId),
      });
      const restAfter: any = restoredSession.submitDecision({
        decisionId: restoredStep.request.decisionId,
        stateVersion: restoredStep.request.stateVersion,
        selectedPatternRef: selectZoneTopRefByCardId(restoredStep.request, chosenId),
      });

      expect(origAfter.type).toBe("WAITING_FOR_DECISION");
      expect(restAfter.type).toBe("WAITING_FOR_DECISION");
      expect(StateHasher.hash(session.state)).toBe(StateHasher.hash(restoredSession.state));
      expect(session.resolvingRequest).toBeUndefined();
      expect(restoredSession.resolvingRequest).toBeUndefined();

      const afterEvents = session.getMatchLog().events;
      const topEvent = afterEvents.find(
        (e: any) => e.type === "zone.top.changed" && e.cardId === chosenId
      )!;
      const reqResolvedEvent = afterEvents.find(
        (e: any) => e.type === "request.resolved" && e.requestId === resolving.id
      )!;
      expect(topEvent).toBeDefined();
      expect(reqResolvedEvent).toBeDefined();
      expect(topEvent.seq).toBeLessThan(reqResolvedEvent.seq);
      expect(
        (session.state as any).stage.history.find((h: any) => h.id === resolving.id)?.status
      ).toBe("resolved");
    });

    it("公式 mast-strategy 対戦での全チェックポイント保存則・Replay(reconstructMatch)・Undo分岐・selectAutoGraveTopCandidate 決定論性を検証", () => {
      const rareCardSelections = {
        p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
        p2: [{ suit: "J", rank: "Joker", occurrence: 1 }],
      };
      const scenarioHandSelections = {
        p1: [
          { suit: "S", rank: "2", occurrence: 0 },
          { suit: "S", rank: "3", occurrence: 0 },
          { suit: "H", rank: "4", occurrence: 0 },
        ],
        p2: [
          { suit: "C", rank: "4", occurrence: 0 },
          { suit: "C", rank: "5", occurrence: 0 },
          { suit: "D", rank: "4", occurrence: 0 },
        ],
      };

      const startOut = startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:mast-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: rareCardSelections as any,
        scenarioHandSelections: scenarioHandSelections as any,
        allowUnimplemented: true,
      });
      if (startOut.type !== "READY" || !startOut.session) {
        throw new Error(`Expected READY, got ${startOut.type}`);
      }

      const session = startOut.session;
      const mastReg = catalog.regulations.get("mast-strategy")!;
      const mastFrame = catalog.frames.get("strategy")!;
      const deckProfile = SimulatorDeckProfileResolver.resolveDeckProfile(mastFrame, mastReg.id);
      const expectedDeck = deckProfile.cards;

      // Checkpoint 1: 初期盤面保存則
      verifyPlayerConservationWithStage(session, "p1", expectedDeck);
      verifyPlayerConservationWithStage(session, "p2", expectedDeck);

      const transcript: ReplayDecisionEntryV1[] = [];
      let step: any = startOut.initialStep;
      let seq = 0;

      // Decision 1: action.kill 提出 (2枚スペードキー)
      const killRef = findActionPatternRef(step.request, "action.kill");
      expect(killRef).toBeGreaterThanOrEqual(0);
      seq++;
      transcript.push({
        seq,
        actor: "human",
        playerId: step.request.playerId,
        response: {
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: killRef,
        },
      });
      step = session.submitDecision(transcript[transcript.length - 1].response);

      // Checkpoint 2: Stage 積載直後保存則
      verifyPlayerConservationWithStage(session, "p1", expectedDeck);
      verifyPlayerConservationWithStage(session, "p2", expectedDeck);

      // パスを進めて ZONE_TOP_SELECTION まで進む
      let zoneTopSeq = -1;
      let zoneTopCandidates: string[] = [];
      let zoneTopRequest: any = null;
      while (step.type === "WAITING_FOR_DECISION" && seq < 20) {
        const req = step.request;
        if (req.source?.type === "ZONE_TOP_SELECTION") {
          // Checkpoint 3: 解決中断中の保存則
          verifyPlayerConservationWithStage(session, "p1", expectedDeck);
          verifyPlayerConservationWithStage(session, "p2", expectedDeck);

          zoneTopRequest = req;
          const auto1 = selectAutoGraveTopCandidate({
            request: req,
            matchSeed: 42,
            stateVersion: req.stateVersion,
          });
          const auto2 = selectAutoGraveTopCandidate({
            request: req,
            matchSeed: 42,
            stateVersion: req.stateVersion,
          });
          // 決定論性検証
          expect(auto1).toEqual(auto2);
          zoneTopCandidates = [...auto1.candidateCardIds];
          expect(zoneTopCandidates).toHaveLength(2);

          seq++;
          zoneTopSeq = seq;
          transcript.push({
            seq,
            actor: "autoGraveTop",
            playerId: req.playerId,
            response: {
              decisionId: req.decisionId,
              stateVersion: req.stateVersion,
              selectedPatternRef: selectZoneTopRefByCardId(req, zoneTopCandidates[0]),
            },
          });
          step = session.submitDecision(transcript[transcript.length - 1].response);
          break;
        }
        const passRef = req.patterns.findIndex((p: any) => p.kind === "PASS");
        expect(passRef).toBeGreaterThanOrEqual(0);
        seq++;
        transcript.push({
          seq,
          actor: "autoPass",
          playerId: req.playerId,
          response: {
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: passRef,
          },
        });
        step = session.submitDecision(transcript[transcript.length - 1].response);
      }

      expect(zoneTopSeq).toBeGreaterThan(0);
      expect(session.state.players.p1.graveTopCardId).toBe(zoneTopCandidates[0]);

      // Checkpoint 4: 墓地TOP選択確定後の保存則
      verifyPlayerConservationWithStage(session, "p1", expectedDeck);
      verifyPlayerConservationWithStage(session, "p2", expectedDeck);

      // Replay 再現検証 (candidate[0])
      const replay0 = reconstructMatch({
        environmentId: "official:mast-strategy",
        seed: 42,
        rareCardSelections: rareCardSelections as any,
        scenarioHandSelections: scenarioHandSelections as any,
        transcript,
        decisionCount: transcript.length,
        catalog,
        fullRulePackage,
      });
      expect(replay0.status).toBe("SUCCESS");
      if (replay0.status !== "SUCCESS" || !replay0.session) {
        throw new Error(`Expected replay0 SUCCESS, got ${replay0.status}`);
      }
      expect(replay0.executedDecisions).toBe(transcript.length);
      expect(StateHasher.hash(replay0.session.state)).toBe(StateHasher.hash(session.state));
      expect(replay0.session.state.players.p1.graveTopCardId).toBe(zoneTopCandidates[0]);

      // Undo 分岐検証: ZONE_TOP_SELECTION のみを candidate[1] へ切り替えて再構成
      const altTranscript = transcript.map((entry) =>
        entry.seq === zoneTopSeq
          ? {
              ...entry,
              actor: "human" as const,
              response: {
                ...entry.response,
                selectedPatternRef: selectZoneTopRefByCardId(zoneTopRequest, zoneTopCandidates[1]),
              },
            }
          : entry
      );

      const replayAlt = reconstructMatch({
        environmentId: "official:mast-strategy",
        seed: 42,
        rareCardSelections: rareCardSelections as any,
        scenarioHandSelections: scenarioHandSelections as any,
        transcript: altTranscript,
        decisionCount: altTranscript.length,
        catalog,
        fullRulePackage,
      });
      expect(replayAlt.status).toBe("SUCCESS");
      if (replayAlt.status !== "SUCCESS" || !replayAlt.session) {
        throw new Error(`Expected replayAlt SUCCESS, got ${replayAlt.status}`);
      }
      expect(replayAlt.session.state.players.p1.graveTopCardId).toBe(zoneTopCandidates[1]);
      verifyPlayerConservationWithStage(replayAlt.session, "p1", expectedDeck);
      verifyPlayerConservationWithStage(replayAlt.session, "p2", expectedDeck);
    });

    it("全公式レギュレーションおよび Core Battle での起動・進行・保存則スモークがエラーなく動作すること", () => {
      const envIds = [
        CORE_BATTLE_ENV_ID,
        "official:light-entry16",
        "official:light-pack",
        "official:standard-pack",
        "official:standard-rarePack",
        "official:pro-rarePack",
        "official:pro-strategy",
        "official:mast-strategy",
      ];

      for (const envId of envIds) {
        const regId = envId.startsWith("official:") ? envId.replace("official:", "") : undefined;
        const reg = regId ? catalog.regulations.get(regId) : undefined;
        const frame = reg ? catalog.frames.get(reg.frameId) : undefined;
        const rareCount = frame?.setup?.rareCardCount ?? 0;
        const scenarioHandCount = frame?.setup?.scenarioHandCount ?? 0;
        let rareCardSelections: any = undefined;
        let scenarioHandSelections: any = undefined;
        if (reg && frame) {
          const deckProfile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, reg.id);
          if (rareCount > 0) {
            const defaultRare = RareCardSelectionService.resolveDefaultRareCardSelections(
              deckProfile,
              rareCount
            );
            rareCardSelections = { p1: defaultRare, p2: defaultRare };
          }
          if (scenarioHandCount > 0) {
            scenarioHandSelections = {
              p1: ScenarioHandSelectionService.resolveAutoSelections({
                deckProfile,
                scenarioHandCount,
                excludedSelections: rareCardSelections?.p1,
                matchSeed: 101,
                playerKey: "p1",
              }),
              p2: ScenarioHandSelectionService.resolveAutoSelections({
                deckProfile,
                scenarioHandCount,
                excludedSelections: rareCardSelections?.p2,
                matchSeed: 101,
                playerKey: "p2",
              }),
            };
          }
        }

        const out = startMatchAttempt({
          catalog,
          fullRulePackage,
          environmentId: envId,
          matchMode: "humanVsHuman",
          seedInput: "101",
          rareCardSelections,
          scenarioHandSelections,
          allowUnimplemented: true,
        });

        expect(out.type).toBe("READY");
        if (out.type !== "READY" || !out.session) continue;

        const session = out.session;
        let step: any = out.initialStep;
        let safety = 0;

        while (step.type === "WAITING_FOR_DECISION" && safety < 25) {
          safety++;
          const req = step.request;
          let selectedPatternRef = 0;
          if (req.source?.type === "ZONE_TOP_SELECTION") {
            selectedPatternRef = selectAutoGraveTopCandidate({
              request: req,
              matchSeed: 101,
              stateVersion: req.stateVersion,
            }).selectedPatternRef;
          } else {
            const actionIdx = req.patterns.findIndex((p: any) => p.kind === "ACTION");
            const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
            selectedPatternRef = actionIdx >= 0 ? actionIdx : passIdx >= 0 ? passIdx : 0;
          }
          step = session.submitDecision({
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef,
          });
        }

        if (reg && frame) {
          const expectedDeck = SimulatorDeckProfileResolver.resolveDeckProfile(frame, reg.id).cards;
          verifyPlayerConservationWithStage(session, "p1", expectedDeck);
          verifyPlayerConservationWithStage(session, "p2", expectedDeck);
        }
      }
    });
  });
});
