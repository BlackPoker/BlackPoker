/**
 * SemanticFingerprintCalculator.ts
 *
 * BlackPoker Simulator - AI Semantic Stall / Cycle Diagnostic V1
 *
 * 5大フィンガープリント (sgf1, sgf1-ti, pof1, drsf1, gpif1) の計算器。
 * 設計仕様: BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R8
 * レジストリ: BP-SIM-AI-SEMANTIC-FINGERPRINT-FIELD-REGISTRY-V1-R8
 */

import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionSource } from "../../domain/decision/DecisionSource";
import { PlayerObservation, CardView, UnitView, FogView, RequestView, GameEventView } from "../../domain/decision/PlayerObservation";
import { DecisionCatalog } from "../../domain/decision/DecisionCatalog";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder";
import { FEATURE_SCHEMA_VERSION, CONTEXT_FEATURE_DIMENSION, PATTERN_FEATURE_DIMENSION } from "../../domain/ai/DecisionFeatureTypes";
import {
  GameSessionSideState,
  GenomePolicyScoringInputProjection,
  SemanticFingerprints,
} from "../../domain/ai/SemanticDiagnosticTypes";
import { SemanticCanonicalSerializer } from "./SemanticCanonicalSerializer";
import { SemanticSHA256 } from "./SemanticSHA256";
import { SemanticDynamicIdCanonicalizer } from "./SemanticDynamicIdCanonicalizer";

export class SemanticFingerprintCalculator {
  /**
   * 単一の PRE_DECISION 境界において、全5つのフィンガープリントを一括算出
   */
  public static computeAll(
    state: any,
    sideState: GameSessionSideState | undefined,
    request: Readonly<DecisionRequest>
  ): SemanticFingerprints {
    const structural = this.computeSgf1(state, sideState);
    const structuralTurnInvariant = this.computeSgf1Ti(state, sideState);
    const observation = this.computePof1(request.observation);
    const decisionRequest = this.computeDrsf1(request);
    const policyInput = this.computeGpif1(request);

    return {
      structural,
      structuralTurnInvariant,
      observation,
      decisionRequest,
      policyInput,
    };
  }

  /**
   * 1. Structural Gameplay Fingerprint (Variant S1, Turn-Aware)
   * プレフィックス: "sgf1-"
   * 対象: GameState + GameSession サイドステート (turnCount を含む)
   * 除外: stateVersion, nextRequestSeq, decisionId, timestamps, matchLog, player.name
   */
  public static computeSgf1(state: any, sideState?: GameSessionSideState): string {
    const projection = this.extractStructuralProjection(state, sideState, true);
    const canonicalJson = SemanticCanonicalSerializer.serialize(projection);
    const hash = SemanticSHA256.hash(canonicalJson);
    return `sgf1-${hash}`;
  }

  /**
   * 2. Structural Gameplay Fingerprint (Variant S2, Turn-Invariant)
   * プレフィックス: "sgf1-ti-"
   * 対象: GameState + GameSession サイドステート (turnCount を意図的に除外)
   */
  public static computeSgf1Ti(state: any, sideState?: GameSessionSideState): string {
    const projection = this.extractStructuralProjection(state, sideState, false);
    const canonicalJson = SemanticCanonicalSerializer.serialize(projection);
    const hash = SemanticSHA256.hash(canonicalJson);
    return `sgf1-ti-${hash}`;
  }

  /**
   * 3. Player Observation Fingerprint
   * プレフィックス: "pof1-"
   * 対象: Readonly<PlayerObservation> (秘密情報を排除した合法的観測)
   */
  public static computePof1(observation: Readonly<PlayerObservation>): string {
    const projection = this.extractObservationProjection(observation);
    const canonicalJson = SemanticCanonicalSerializer.serialize(projection);
    const hash = SemanticSHA256.hash(canonicalJson);
    return `pof1-${hash}`;
  }

  /**
   * 4. Decision Request Semantic Fingerprint
   * プレフィックス: "drsf1-"
   * 対象: Readonly<DecisionRequest> (プロトコル、判断プレイヤー、Source、観測、合法パターン、カタログ解決実体)
   * 除外: matchId, decisionId, stateVersion, patternId, 表示用文字列
   */
  public static computeDrsf1(request: Readonly<DecisionRequest>): string {
    const projection = this.extractDecisionRequestProjection(request);
    const canonicalJson = SemanticCanonicalSerializer.serialize(projection);
    const hash = SemanticSHA256.hash(canonicalJson);
    return `drsf1-${hash}`;
  }

  /**
   * 5. Genome Policy Input Fingerprint
   * プレフィックス: "gpif1-"
   * 対象: DecisionFeatureEncoder.encode(request) から抽出した GenomePolicyScoringInputProjection
   * 厳格な非丸め IEEE 754 浮動小数点シリアライズ
   */
  public static computeGpif1(request: Readonly<DecisionRequest>): string {
    const encoded = DecisionFeatureEncoder.encode(request);

    if (encoded.featureSchemaVersion !== FEATURE_SCHEMA_VERSION) {
      throw new Error(
        `Feature schema version mismatch: expected ${FEATURE_SCHEMA_VERSION}, got ${encoded.featureSchemaVersion}`
      );
    }

    if (encoded.context.values.length !== CONTEXT_FEATURE_DIMENSION) {
      throw new Error(
        `Context feature dimension mismatch: expected ${CONTEXT_FEATURE_DIMENSION}, got ${encoded.context.values.length}`
      );
    }

    for (const p of encoded.patterns) {
      if (p.values.length !== PATTERN_FEATURE_DIMENSION) {
        throw new Error(
          `Pattern feature dimension mismatch for patternRef ${p.patternRef}: expected ${PATTERN_FEATURE_DIMENSION}, got ${p.values.length}`
        );
      }
    }

    const projection: GenomePolicyScoringInputProjection = {
      featureSchemaVersion: 5,
      contextValues: encoded.context.values,
      patterns: encoded.patterns.map((p) => ({
        patternRef: p.patternRef,
        values: p.values,
      })),
    };

    const canonicalJson = SemanticCanonicalSerializer.serialize(projection);
    const hash = SemanticSHA256.hash(canonicalJson);
    return `gpif1-${hash}`;
  }

  // =========================================================================
  // Private Projection Extractors
  // =========================================================================

  private static extractStructuralProjection(
    state: any,
    sideState: GameSessionSideState | undefined,
    includeTurnCount: boolean
  ): any {
    if (!state || typeof state !== "object") return state;

    const ctx = SemanticDynamicIdCanonicalizer.createMappingContext();
    const { registerId, registerRecursively, resolveId } = ctx;

    // Pass 1: 走査順序で動的 ID を登録
    if (state.players && typeof state.players === "object") {
      for (const pKey of Object.keys(state.players).sort()) {
        const p = state.players[pKey];
        if (!p) continue;
        if (Array.isArray(p.hand)) p.hand.forEach((c: any) => registerId(c?.id, "card"));
        if (Array.isArray(p.life)) p.life.forEach((c: any) => registerId(c?.id, "card"));
        if (Array.isArray(p.field)) {
          p.field.forEach((u: any) => {
            registerId(u?.unitId, "unit");
            if (Array.isArray(u?.cards)) u.cards.forEach((c: any) => registerId(c?.id, "card"));
          });
        }
        if (Array.isArray(p.fog)) {
          p.fog.forEach((f: any) => {
            registerId(f?.fogId, "fog");
            registerId(f?.card?.id, "card");
            if (f?.bindings) registerRecursively(f.bindings);
          });
        }
        if (p.graveTopCardId) registerId(p.graveTopCardId, "card");
        if (Array.isArray(p.grave)) {
          p.grave.forEach((item: any) => {
            if (item?.unitId) {
              registerId(item.unitId, "unit");
              if (Array.isArray(item.cards)) item.cards.forEach((c: any) => registerId(c?.id, "card"));
            } else {
              registerId(item?.id, "card");
            }
          });
        }
        const trumps = p.trumps || p.trump;
        if (Array.isArray(trumps)) {
          trumps.forEach((t: any) => {
            registerId(t?.unitId, "unit");
            if (Array.isArray(t?.cards)) t.cards.forEach((c: any) => registerId(c?.id, "card"));
          });
        }
        if (p.pack?.cards && Array.isArray(p.pack.cards)) {
          p.pack.cards.forEach((c: any) => registerId(c?.id, "card"));
        }
        if (Array.isArray(p.rareCards)) {
          p.rareCards.forEach((c: any) => registerId(c?.id, "card"));
        }
      }
    }

    if (state.stage?.requests && Array.isArray(state.stage.requests)) {
      state.stage.requests.forEach((r: any) => {
        registerId(r?.id, "req");
        if (Array.isArray(r?.keyCards)) r.keyCards.forEach((c: any) => registerId(c?.id, "card"));
        else if (r?.keyCard) registerId(r.keyCard.id, "card");
        if (r?.selectedCostPayment) {
          if (Array.isArray(r.selectedCostPayment.discardedCardIds)) {
            r.selectedCostPayment.discardedCardIds.forEach((id: string) => registerId(id, "card"));
          }
          if (Array.isArray(r.selectedCostPayment.drivenBulwarkUnitIds)) {
            r.selectedCostPayment.drivenBulwarkUnitIds.forEach((id: string) => registerId(id, "unit"));
          }
          if (Array.isArray(r.selectedCostPayment.sacrificedUnitIds)) {
            r.selectedCostPayment.sacrificedUnitIds.forEach((id: string) => registerId(id, "unit"));
          }
        }
      });
    }

    if (state.requestBuffer?.requests && Array.isArray(state.requestBuffer.requests)) {
      state.requestBuffer.requests.forEach((r: any) => {
        registerId(r?.id, "buf-req");
        if (Array.isArray(r?.keyCards)) r.keyCards.forEach((c: any) => registerId(c?.id, "card"));
        else if (r?.keyCard) registerId(r.keyCard.id, "card");
        if (r?.triggerBindings) registerRecursively(r.triggerBindings);
        if (r?.sourceEvent?.payload) registerRecursively(r.sourceEvent.payload);
      });
    }

    if (Array.isArray(state.pendingGraveTopSelections)) {
      state.pendingGraveTopSelections.forEach((p: any) => {
        if (Array.isArray(p?.candidateCardIds)) {
          p.candidateCardIds.forEach((cId: string) => registerId(cId, "card"));
        }
        if (p?.previousTopCardId) registerId(p.previousTopCardId, "card");
      });
    }

    // Side-state IDs
    if (sideState?.resolvingRequest) {
      registerRecursively(sideState.resolvingRequest);
    }
    if (sideState?.resolvingContext) {
      registerRecursively(sideState.resolvingContext);
    }
    if (sideState?.continuation) {
      registerRecursively(sideState.continuation);
    }

    // Pass 2: 正規化抽出
    const normalizeCard = (card: any): any => {
      if (!card) return undefined;
      if (typeof card === "string" || typeof card === "number") return card;
      return {
        id: resolveId(card.id),
        suit: card.suit,
        rank: card.rank,
        value: card.value ?? 0,
        code: card.code,
      };
    };

    const normalizeUnit = (unit: any): any => {
      if (!unit) return undefined;
      return {
        unitId: resolveId(unit.unitId),
        componentId: unit.componentId,
        kind: unit.kind,
        state: unit.state,
        face: unit.face,
        cards: Array.isArray(unit.cards) ? unit.cards.map((c: any) => normalizeCard(c)) : [],
        labels: Array.isArray(unit.labels) ? [...unit.labels].sort() : [],
        battle: unit.battle
          ? {
              role: unit.battle.role,
              targetPlayerKey: unit.battle.targetPlayerKey,
              blocksUnitId: resolveId(unit.battle.blocksUnitId),
            }
          : undefined,
      };
    };

    const normalizeCostPayment = (cp: any): any => {
      if (!cp || typeof cp !== "object") return undefined;
      return {
        lifeCount: cp.lifeCount ?? 0,
        discardedCardIds: Array.isArray(cp.discardedCardIds)
          ? cp.discardedCardIds.map((id: string) => resolveId(id)).sort()
          : [],
        drivenBulwarkUnitIds: Array.isArray(cp.drivenBulwarkUnitIds)
          ? cp.drivenBulwarkUnitIds.map((id: string) => resolveId(id)).sort()
          : [],
        sacrificedUnitIds: Array.isArray(cp.sacrificedUnitIds)
          ? cp.sacrificedUnitIds.map((id: string) => resolveId(id)).sort()
          : [],
      };
    };

    const normalizeTarget = (target: any): any => {
      if (!target || typeof target !== "object") return target;
      if (target.type === "player") {
        return { type: "player", targetPlayerKey: target.targetPlayerKey };
      }
      if (target.type === "request") {
        return { type: "request", requestId: resolveId(target.requestId), actionId: target.actionId };
      }
      if (target.type === "unit" || target.unitId) {
        return {
          type: "unit",
          unitId: resolveId(target.unitId),
          kind: target.kind,
          componentId: target.componentId,
        };
      }
      return ctx.canonicalizeValue(target);
    };

    const normalizeTurnUsage = (turnUsage: any): any => {
      if (!turnUsage || typeof turnUsage !== "object") return undefined;
      const normalized: Record<string, any> = {};
      for (const pKey of Object.keys(turnUsage).sort()) {
        const userUsage = turnUsage[pKey];
        if (userUsage && typeof userUsage === "object") {
          const actionUsage: Record<string, number> = {};
          for (const actId of Object.keys(userUsage).sort()) {
            if (typeof userUsage[actId] === "number") {
              actionUsage[actId] = userUsage[actId];
            }
          }
          normalized[pKey] = actionUsage;
        }
      }
      return normalized;
    };

    const logical: Record<string, any> = {
      presetId: state.presetId,
      turnPlayer: state.turnPlayer,
      chancePlayer: state.chancePlayer,
      turnUsage: normalizeTurnUsage(state.turnUsage),
    };

    // S1 Turn-Aware のみ turnCount を含める
    if (includeTurnCount) {
      logical.turnCount = state.turnCount ?? 1;
    }

    // Players
    if (state.players && typeof state.players === "object") {
      const players: Record<string, any> = {};
      for (const pKey of Object.keys(state.players).sort()) {
        const p = state.players[pKey];
        if (!p) continue;
        players[pKey] = {
          life: Array.isArray(p.life) ? p.life.map((c: any) => normalizeCard(c)) : [],
          hand: Array.isArray(p.hand) ? p.hand.map((c: any) => normalizeCard(c)) : [],
          field: Array.isArray(p.field) ? p.field.map((u: any) => normalizeUnit(u)) : [],
          fog: Array.isArray(p.fog)
            ? p.fog.map((f: any) => ({
                fogId: resolveId(f.fogId),
                componentId: f.componentId,
                card: normalizeCard(f.card),
                bindings: f.bindings ? ctx.canonicalizeValue(f.bindings) : undefined,
              }))
            : [],
          grave: Array.isArray(p.grave)
            ? p.grave.map((item: any) => (item?.unitId ? normalizeUnit(item) : normalizeCard(item)))
            : [],
          graveTopCardId: p.graveTopCardId ? resolveId(p.graveTopCardId) : undefined,
          trumps: Array.isArray(p.trumps || p.trump)
            ? (p.trumps || p.trump).map((t: any) => normalizeUnit(t))
            : [],
          pack: p.pack
            ? {
                count: p.pack.count ?? (Array.isArray(p.pack.cards) ? p.pack.cards.length : 0),
                opened: Boolean(p.pack.opened),
                cards: Array.isArray(p.pack.cards) ? p.pack.cards.map((c: any) => normalizeCard(c)) : [],
              }
            : undefined,
          rareCards: Array.isArray(p.rareCards)
            ? p.rareCards.map((c: any) => normalizeCard(c))
            : undefined,
        };
      }
      logical.players = players;
    }

    // Stage Requests (LIFO 順序厳格保持, sequence は array-local relative index へ正規化)
    if (state.stage?.requests && Array.isArray(state.stage.requests)) {
      logical.stageRequests = state.stage.requests.map((r: any, idx: number) => {
        const keyCards = Array.isArray(r.keyCards)
          ? r.keyCards.map((c: any) => normalizeCard(c))
          : r.keyCard
          ? [normalizeCard(r.keyCard)]
          : [];

        const targets = Array.isArray(r.targets)
          ? r.targets.map((t: any) => normalizeTarget(t))
          : r.targetComponent
          ? [
              normalizeTarget({
                type: "unit",
                unitId: r.targetComponent.unitId,
                kind: r.targetComponent.kind,
                componentId: r.targetComponent.componentId,
              }),
            ]
          : r.targetRequest
          ? [normalizeTarget({ type: "request", requestId: r.targetRequest.id, actionId: r.targetRequest.actionId })]
          : undefined;

        return {
          id: resolveId(r.id),
          actionId: r.actionId,
          controller: r.controller,
          status: r.status,
          sequence: idx,
          definitionOwner: r.definitionOwner,
          keyCards,
          targets,
          cost: r.cost,
          selectedCostPayment: normalizeCostPayment(r.selectedCostPayment),
        };
      });
    }

    // Request Buffer Requests (FIFO 順序厳格保持, sequence は array-local relative index へ正規化)
    if (state.requestBuffer?.requests && Array.isArray(state.requestBuffer.requests)) {
      logical.bufferRequests = state.requestBuffer.requests.map((r: any, idx: number) => {
        const keyCards = Array.isArray(r.keyCards)
          ? r.keyCards.map((c: any) => normalizeCard(c))
          : r.keyCard
          ? [normalizeCard(r.keyCard)]
          : [];

        return {
          id: resolveId(r.id),
          actionId: r.actionId,
          controller: r.controller,
          sequence: idx,
          definitionOwner: r.definitionOwner,
          keyCards,
          triggerBindings: r.triggerBindings ? ctx.canonicalizeValue(r.triggerBindings) : undefined,
          sourceEvent: r.sourceEvent
            ? {
                type: r.sourceEvent.type,
                name: r.sourceEvent.name,
                payload: r.sourceEvent.payload ? ctx.canonicalizeValue(r.sourceEvent.payload) : undefined,
              }
            : undefined,
        };
      });
    }

    // Pending Grave TOP Selections
    if (Array.isArray(state.pendingGraveTopSelections) && state.pendingGraveTopSelections.length > 0) {
      logical.pendingGraveTopSelections = state.pendingGraveTopSelections.map((p: any) => ({
        playerId: p.playerId,
        candidateCardIds: Array.isArray(p.candidateCardIds)
          ? p.candidateCardIds.map((cId: string) => resolveId(cId) || cId)
          : [],
        previousTopCardId: p.previousTopCardId ? resolveId(p.previousTopCardId) || p.previousTopCardId : undefined,
        reason: p.reason,
      }));
    }

    // Side-state ResolvingRequest 正規化 (Bookkeeping の sequence/stateVersion/decisionId/timestamp 等を除外)
    const normalizeResolvingRequest = (r: any): any => {
      if (!r || typeof r !== "object") return r;
      const keyCards = Array.isArray(r.keyCards)
        ? r.keyCards.map((c: any) => normalizeCard(c))
        : r.keyCard
        ? [normalizeCard(r.keyCard)]
        : undefined;

      const targets = Array.isArray(r.targets)
        ? r.targets.map((t: any) => normalizeTarget(t))
        : r.target
        ? [normalizeTarget(r.target)]
        : r.targetComponent
        ? [
            normalizeTarget({
              type: "unit",
              unitId: r.targetComponent.unitId,
              kind: r.targetComponent.kind,
              componentId: r.targetComponent.componentId,
            }),
          ]
        : undefined;

      return {
        id: resolveId(r.id),
        actionId: r.actionId,
        controller: r.controller,
        status: r.status,
        definitionOwner: r.definitionOwner,
        keyCards,
        targets,
        cost: r.cost,
        selectedCostPayment: normalizeCostPayment(r.selectedCostPayment),
        effectStepId: r.effectStepId,
        params: r.params ? ctx.canonicalizeValue(r.params) : undefined,
        triggerBindings: r.triggerBindings ? ctx.canonicalizeValue(r.triggerBindings) : undefined,
      };
    };

    // Side-state
    if (sideState) {
      logical.sideState = {
        consecutivePassCount: sideState.consecutivePassCount ?? 0,
        continuation: sideState.continuation ? ctx.canonicalizeValue(sideState.continuation) : undefined,
        resolvingRequest: sideState.resolvingRequest ? normalizeResolvingRequest(sideState.resolvingRequest) : undefined,
        resolvingContext: sideState.resolvingContext ? ctx.canonicalizeValue(sideState.resolvingContext) : undefined,
      };
    }

    return logical;
  }

  private static registerObservationIds(
    obs: Readonly<PlayerObservation>,
    ctx: ReturnType<typeof SemanticDynamicIdCanonicalizer.createMappingContext>
  ): void {
    const { registerId, registerRecursively } = ctx;
    if (Array.isArray(obs.players)) {
      obs.players.forEach((p) => {
        if (Array.isArray(p.handCards)) {
          p.handCards.forEach((c) => {
            if (c.visibility === "KNOWN") registerId(c.cardInstanceId, "card");
            else if (c.opaqueCardId) registerId(c.opaqueCardId, "card");
          });
        }
        if (Array.isArray(p.field)) {
          p.field.forEach((u) => {
            registerId(u.unitId, "unit");
            if (Array.isArray(u.cards)) {
              u.cards.forEach((c) => {
                if (c.visibility === "KNOWN") registerId(c.cardInstanceId, "card");
                else if (c.opaqueCardId) registerId(c.opaqueCardId, "card");
              });
            }
          });
        }
        if (Array.isArray(p.fog)) {
          p.fog.forEach((f) => {
            registerId(f.fogId, "fog");
            if (f.card?.visibility === "KNOWN") registerId(f.card.cardInstanceId, "card");
            if (f.bindings) registerRecursively(f.bindings);
          });
        }
        if (Array.isArray(p.trumps)) {
          p.trumps.forEach((t) => {
            registerId(t.unitId, "unit");
            if (Array.isArray(t.cards)) {
              t.cards.forEach((c) => {
                if (c.visibility === "KNOWN") registerId(c.cardInstanceId, "card");
              });
            }
          });
        }
        if (p.graveTopCard?.visibility === "KNOWN") {
          registerId(p.graveTopCard.cardInstanceId, "card");
        }
        if (p.pack?.cards && Array.isArray(p.pack.cards)) {
          p.pack.cards.forEach((c) => {
            if (c.visibility === "KNOWN") registerId(c.cardInstanceId, "card");
            else if (c.opaqueCardId) registerId(c.opaqueCardId, "card");
          });
        }
        if (p.rareCards?.cards && Array.isArray(p.rareCards.cards)) {
          p.rareCards.cards.forEach((c) => {
            if (c.visibility === "KNOWN") registerId(c.cardInstanceId, "card");
          });
        }
      });
    }

    if (Array.isArray(obs.stageRequestRefs)) {
      obs.stageRequestRefs.forEach((ref) => {
        registerId(ref, "req");
      });
    }
    if (Array.isArray(obs.stageRequests)) {
      obs.stageRequests.forEach((r) => {
        registerId(r.requestId, "req");
      });
    }
    if (obs.effectSourceRequest) {
      registerId(obs.effectSourceRequest.requestId, "req");
    }
    if (Array.isArray(obs.recentEvents)) {
      obs.recentEvents.forEach((e) => {
        registerId(e.eventId, "event");
        if (e.payload) registerRecursively(e.payload);
      });
    }
  }

  private static extractObservationProjection(
    obs: Readonly<PlayerObservation>,
    externalCtx?: ReturnType<typeof SemanticDynamicIdCanonicalizer.createMappingContext>
  ): any {
    if (!obs || typeof obs !== "object") return obs;

    const ctx = externalCtx || SemanticDynamicIdCanonicalizer.createMappingContext();
    const { resolveId } = ctx;

    // externalCtx が渡されていない場合は独自に Pass 1 を実行
    if (!externalCtx) {
      this.registerObservationIds(obs, ctx);
    }

    // Pass 2: 正規化
    const normalizeCardView = (c: CardView): any => {
      if (!c) return undefined;
      if (c.visibility === "KNOWN") {
        return {
          visibility: "KNOWN",
          cardInstanceId: resolveId(c.cardInstanceId),
          suit: c.suit,
          rank: c.rank,
          value: c.value,
          faceUp: c.faceUp,
          code: c.code,
        };
      }
      return {
        visibility: "HIDDEN",
        opaqueCardId: c.opaqueCardId ? resolveId(c.opaqueCardId) : undefined,
        faceUp: false,
      };
    };

    const normalizeUnitView = (u: UnitView): any => {
      if (!u) return undefined;
      return {
        unitId: resolveId(u.unitId),
        kind: u.kind,
        componentId: u.componentId,
        state: u.state,
        face: u.face,
        cards: Array.isArray(u.cards) ? u.cards.map(normalizeCardView) : [],
        labels: Array.isArray(u.labels) ? [...u.labels].sort() : [],
        currentSize: u.currentSize,
        battle: u.battle
          ? {
              role: u.battle.role,
              targetPlayerKey: u.battle.targetPlayerKey,
              blocksUnitId: resolveId(u.battle.blocksUnitId),
            }
          : undefined,
      };
    };

    const normalizeRequestView = (r: RequestView, idx?: number): any => {
      if (!r) return undefined;
      return {
        requestId: resolveId(r.requestId),
        actionId: r.actionId,
        actionSpeed: r.actionSpeed,
        actionTiming: r.actionTiming,
        controller: r.controller,
        status: r.status,
        sequence: idx !== undefined ? idx : undefined,
        definitionOwner: r.definitionOwner,
        keyCards: Array.isArray(r.keyCards) ? r.keyCards.map(normalizeCardView) : undefined,
        target: r.target
          ? {
              targetType: r.target.targetType,
              targetPlayerKey: r.target.targetPlayerKey,
              targetUnitId: resolveId(r.target.targetUnitId),
              targetRequestId: resolveId(r.target.targetRequestId),
            }
          : undefined,
      };
    };

    const normalizeGameEventView = (e: GameEventView): any => {
      if (!e) return undefined;
      return {
        eventId: resolveId(e.eventId) || e.eventId,
        type: e.type,
        payload: e.payload ? ctx.canonicalizeValue(e.payload) : {},
      };
    };

    return {
      viewerPlayerId: obs.viewerPlayerId,
      turnPlayerId: obs.turnPlayerId,
      chancePlayerId: obs.chancePlayerId,
      turnCount: obs.turnCount ?? 1,
      players: Array.isArray(obs.players)
        ? obs.players.map((p) => ({
            playerId: p.playerId,
            isViewer: p.isViewer,
            lifeCount: p.lifeCount,
            handCount: p.handCount,
            handCards: Array.isArray(p.handCards) ? p.handCards.map(normalizeCardView) : [],
            field: Array.isArray(p.field) ? p.field.map(normalizeUnitView) : [],
            fog: Array.isArray(p.fog)
              ? p.fog.map((f) => ({
                  fogId: resolveId(f.fogId),
                  componentId: f.componentId,
                  card: f.card ? normalizeCardView(f.card) : undefined,
                  bindings: f.bindings ? ctx.canonicalizeValue(f.bindings) : undefined,
                  ownerPlayerId: f.ownerPlayerId,
                }))
              : [],
            trumps: Array.isArray(p.trumps) ? p.trumps.map(normalizeUnitView) : [],
            graveCount: p.graveCount,
            graveTopCard: p.graveTopCard ? normalizeCardView(p.graveTopCard) : undefined,
            grave: Array.isArray(p.grave)
              ? p.grave.map((item: any) => (item?.unitId ? normalizeUnitView(item) : normalizeCardView(item)))
              : [],
            canViewFullGrave: p.canViewFullGrave,
            pack: p.pack
              ? {
                  count: p.pack.count,
                  opened: p.pack.opened,
                  canViewCards: p.pack.canViewCards,
                  cards: Array.isArray(p.pack.cards) ? p.pack.cards.map(normalizeCardView) : [],
                }
              : undefined,
            rareCards: p.rareCards
              ? {
                  count: p.rareCards.count,
                  canViewCards: p.rareCards.canViewCards,
                  cards: Array.isArray(p.rareCards.cards) ? p.rareCards.cards.map(normalizeCardView) : [],
                }
              : undefined,
          }))
        : [],
      stageRequestRefs: Array.isArray(obs.stageRequestRefs)
        ? obs.stageRequestRefs.map((ref) => resolveId(ref) || ref)
        : [],
      stageRequests: Array.isArray(obs.stageRequests)
        ? obs.stageRequests.map((r, idx) => normalizeRequestView(r, idx))
        : [],
      effectSourceRequest: obs.effectSourceRequest ? normalizeRequestView(obs.effectSourceRequest) : undefined,
      recentEvents: Array.isArray(obs.recentEvents)
        ? obs.recentEvents.map(normalizeGameEventView)
        : [],
    };
  }

  private static extractDecisionRequestProjection(req: Readonly<DecisionRequest>): any {
    if (!req || typeof req !== "object") return req;

    const catalog = req.catalog || ({} as DecisionCatalog);
    const ctx = SemanticDynamicIdCanonicalizer.createMappingContext();
    const { registerId, resolveId } = ctx;

    // Pass 1: DecisionRequest 全体で単一の canonical mapping context を共有
    // 1-A: Observation のエンティティ ID を登録
    if (req.observation) {
      this.registerObservationIds(req.observation, ctx);
    }

    // 1-B: DecisionSource のエンティティ ID を登録
    if (req.source?.type === "EFFECT_RESOLUTION" && req.source.sourceRequestRef) {
      registerId(req.source.sourceRequestRef, "req");
    }

    // 1-C: Catalog 内の動的エンティティ ID を登録
    if (Array.isArray(catalog.cardSelections)) {
      catalog.cardSelections.forEach((c) => {
        if (Array.isArray(c.cardIds)) c.cardIds.forEach((id) => registerId(id, "card"));
      });
    }
    if (Array.isArray(catalog.unitSelections)) {
      catalog.unitSelections.forEach((u) => {
        if (Array.isArray(u.unitIds)) u.unitIds.forEach((id) => registerId(id, "unit"));
      });
    }
    if (Array.isArray(catalog.costPayments)) {
      catalog.costPayments.forEach((cp) => {
        if (Array.isArray(cp.discardedCardIds)) cp.discardedCardIds.forEach((id) => registerId(id, "card"));
        if (Array.isArray(cp.drivenBulwarkUnitIds)) cp.drivenBulwarkUnitIds.forEach((id) => registerId(id, "unit"));
        if (Array.isArray(cp.sacrificedUnitIds)) cp.sacrificedUnitIds.forEach((id) => registerId(id, "unit"));
      });
    }
    if (Array.isArray(catalog.targetSelections)) {
      catalog.targetSelections.forEach((t) => {
        if (t.targetUnitId) registerId(t.targetUnitId, "unit");
        if (t.targetRequestId) registerId(t.targetRequestId, "req");
      });
    }
    if (Array.isArray(catalog.effectSelections)) {
      catalog.effectSelections.forEach((e) => {
        if (Array.isArray(e.selectedValues)) {
          e.selectedValues.forEach((val) => registerId(val, "entity"));
        }
        if (Array.isArray(e.assignments)) {
          e.assignments.forEach((a) => {
            if (a.sourceUnitId) registerId(a.sourceUnitId, "unit");
            if (Array.isArray(a.selectedUnitIds)) a.selectedUnitIds.forEach((id) => registerId(id, "unit"));
          });
        }
        if (e.targetSelection) {
          if (e.targetSelection.targetUnitId) registerId(e.targetSelection.targetUnitId, "unit");
          if (e.targetSelection.targetRequestId) registerId(e.targetSelection.targetRequestId, "req");
        }
        if (Array.isArray(e.cards)) {
          e.cards.forEach((c) => {
            if (c.visibility === "KNOWN") registerId(c.cardInstanceId, "card");
            else if (c.opaqueCardId) registerId(c.opaqueCardId, "card");
          });
        }
      });
    }
    if (Array.isArray(catalog.orderSelections)) {
      catalog.orderSelections.forEach((o) => {
        if (Array.isArray(o.orderedIds)) o.orderedIds.forEach((id) => registerId(id, "entity"));
      });
    }

    // Pass 2: 同一 ctx を用いた正規化射影の抽出
    const observation = this.extractObservationProjection(req.observation, ctx);

    const normalizeCardView = (c: CardView): any => {
      if (!c) return undefined;
      if (c.visibility === "KNOWN") {
        return {
          visibility: "KNOWN",
          cardInstanceId: resolveId(c.cardInstanceId),
          suit: c.suit,
          rank: c.rank,
          value: c.value,
          faceUp: c.faceUp,
          code: c.code,
        };
      }
      return {
        visibility: "HIDDEN",
        opaqueCardId: c.opaqueCardId ? resolveId(c.opaqueCardId) : undefined,
        faceUp: false,
      };
    };

    // カタログ参照を解決したパターン射影 (順序厳格保持, 表示用文字列除外, 同一 ctx で canonicalize)
    const patterns = (req.patterns || []).map((p: LegalPattern) => {
      const patObj: Record<string, any> = {
        kind: p.kind,
      };

      if (p.actionSelectionRef !== undefined && catalog.actions?.[p.actionSelectionRef]) {
        const a = catalog.actions[p.actionSelectionRef];
        patObj.action = {
          actionId: a.actionId,
          timing: a.timing,
          speed: a.speed,
          cost: a.cost,
        };
      }

      if (p.keyCardSelectionRef !== undefined && catalog.cardSelections?.[p.keyCardSelectionRef]) {
        const c = catalog.cardSelections[p.keyCardSelectionRef];
        patObj.keyCards = {
          cardIds: Array.isArray(c.cardIds) ? c.cardIds.map((id) => resolveId(id)!) : [],
        };
      }

      if (p.keyUnitSelectionRef !== undefined && catalog.unitSelections?.[p.keyUnitSelectionRef]) {
        const u = catalog.unitSelections[p.keyUnitSelectionRef];
        patObj.keyUnits = {
          unitIds: Array.isArray(u.unitIds) ? u.unitIds.map((id) => resolveId(id)!) : [],
        };
      }

      if (p.costPaymentRef !== undefined && catalog.costPayments?.[p.costPaymentRef]) {
        const cp = catalog.costPayments[p.costPaymentRef];
        patObj.costPayment = {
          discardedCardIds: Array.isArray(cp.discardedCardIds)
            ? cp.discardedCardIds.map((id) => resolveId(id)!).sort()
            : [],
          drivenBulwarkUnitIds: Array.isArray(cp.drivenBulwarkUnitIds)
            ? cp.drivenBulwarkUnitIds.map((id) => resolveId(id)!).sort()
            : [],
          sacrificedUnitIds: Array.isArray(cp.sacrificedUnitIds)
            ? cp.sacrificedUnitIds.map((id) => resolveId(id)!).sort()
            : [],
          lifeCount: cp.lifeCount ?? 0,
        };
      }

      if (p.targetSelectionRef !== undefined && catalog.targetSelections?.[p.targetSelectionRef]) {
        const t = catalog.targetSelections[p.targetSelectionRef];
        patObj.targetSelection = {
          targetType: t.targetType,
          targetPlayerKey: t.targetPlayerKey,
          targetUnitId: t.targetUnitId ? resolveId(t.targetUnitId) : undefined,
          targetRequestId: t.targetRequestId ? resolveId(t.targetRequestId) : undefined,
          targetDefinitionId: t.targetDefinitionId,
        };
      }

      if (p.effectSelectionRef !== undefined && catalog.effectSelections?.[p.effectSelectionRef]) {
        const e = catalog.effectSelections[p.effectSelectionRef];
        patObj.effectSelection = {
          selectionType: e.selectionType,
          selectedValues: Array.isArray(e.selectedValues)
            ? e.selectedValues.map((v) => resolveId(v)!)
            : undefined,
          assignments: Array.isArray(e.assignments)
            ? e.assignments.map((a) => ({
                sourceUnitId: resolveId(a.sourceUnitId)!,
                selectedUnitIds: Array.isArray(a.selectedUnitIds)
                  ? a.selectedUnitIds.map((id) => resolveId(id)!).sort()
                  : [],
              }))
            : undefined,
          targetSelection: e.targetSelection
            ? {
                targetType: e.targetSelection.targetType,
                targetPlayerKey: e.targetSelection.targetPlayerKey,
                targetUnitId: e.targetSelection.targetUnitId ? resolveId(e.targetSelection.targetUnitId) : undefined,
                targetRequestId: e.targetSelection.targetRequestId
                  ? resolveId(e.targetSelection.targetRequestId)
                  : undefined,
                targetDefinitionId: e.targetSelection.targetDefinitionId,
              }
            : undefined,
          candidateCount: e.candidateCount,
          cards: Array.isArray(e.cards) ? e.cards.map(normalizeCardView) : undefined,
        };
      }

      if (p.orderSelectionRef !== undefined && catalog.orderSelections?.[p.orderSelectionRef]) {
        const o = catalog.orderSelections[p.orderSelectionRef];
        patObj.orderSelection = {
          orderedIds: Array.isArray(o.orderedIds) ? o.orderedIds.map((id) => resolveId(id)!) : [],
        };
      }

      return patObj;
    });

    return {
      protocolVersion: req.protocolVersion,
      playerId: req.playerId,
      source: this.projectDecisionSource(req.source, resolveId),
      observation,
      patterns,
    };
  }

  private static projectDecisionSource(
    src: DecisionSource | undefined,
    resolveId: (id: any) => string | undefined = (id) => id
  ): any {
    if (!src) return undefined;
    switch (src.type) {
      case "ACTION_REQUEST":
        return {
          type: src.type,
          playerId: src.playerId,
        };
      case "EFFECT_RESOLUTION":
        return {
          type: src.type,
          sourceRequestRef: resolveId(src.sourceRequestRef),
          effectStepId: src.effectStepId,
          playerId: src.playerId,
          sourceActionId: src.sourceActionId,
        };
      case "ZONE_TOP_SELECTION":
        return {
          type: src.type,
          zone: src.zone,
          playerId: src.playerId,
          reason: src.reason,
        };
      default:
        return src;
    }
  }
}
