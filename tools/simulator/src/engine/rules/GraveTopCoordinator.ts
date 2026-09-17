import { PlayerKey } from "../../domain/decision/DecisionSource";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import { DecisionCatalog } from "../../domain/decision/DecisionCatalog";
import { ObservationFactory } from "../decision/ObservationFactory";
import {
  enumeratePhysicalCardsInGrave,
  findPhysicalCardInGrave,
  removePhysicalCardFromGrave,
  isCardLike,
} from "./graveCardUtils";

export interface PendingGraveTopSelection {
  readonly playerId: PlayerKey;
  readonly candidateCardIds: readonly string[];
  readonly previousTopCardId?: string;
  readonly reason: "MULTI_CARD_GRAVE_MOVE" | "TOP_REMOVED";
}

function formatCardDisplay(card: any): string {
  if (!card) return "??";
  const suitSymbols: Record<string, string> = {
    spade: "♠",
    heart: "♡",
    diamond: "♢",
    club: "♣",
    S: "♠",
    H: "♡",
    D: "♢",
    C: "♣",
  };
  const suit = suitSymbols[card.suit] || card.suit || "";
  const rank = card.rank || "";
  return `${suit}${rank}`;
}

function recordZoneTopChanged(
  logRecorder: any,
  stateVersion: number,
  playerId: string,
  previousCardId?: string,
  cardId?: string
): void {
  if (logRecorder && typeof logRecorder.record === "function") {
    logRecorder.record({
      type: "zone.top.changed",
      stateVersion: stateVersion ?? 1,
      playerId,
      zone: "grave",
      previousCardId,
      cardId,
    });
  }
}

/**
 * 墓地TOP（Grave TOP）の決定、状態遷移、所有者選択Decisionの生成を一元管理する汎用コーディネーター。
 */
export class GraveTopCoordinator {
  /**
   * 単一の通常カードを墓地に追加し、自動的に新しい墓地TOPとして設定します (Rule 1-E: Decision不要)。
   */
  static addCardToGrave(
    player: any,
    card: any,
    state: any,
    playerKey: string,
    logRecorder?: any
  ): void {
    if (!Array.isArray(player.grave)) {
      player.grave = [];
    }
    const previousTop = player.graveTopCardId;
    player.grave.push(card);
    player.graveTopCardId = card.id;

    recordZoneTopChanged(
      logRecorder,
      state?.stateVersion ?? 1,
      playerKey,
      previousTop,
      card.id
    );
  }

  /**
   * ユニットを墓地に追加します。
   * - 構成カード1枚: 自動的に新しい墓地TOPとして設定 (Decision不要)。
   * - 構成カード2枚以上: 墓地TOPを一旦クリアし、所有者にTOP選択Decisionを要求するPendingを登録。
   */
  static addUnitToGrave(
    player: any,
    unit: any,
    state: any,
    playerKey: string,
    logRecorder?: any
  ): { requiresDecision: boolean; candidateCardIds: string[] } {
    if (!Array.isArray(player.grave)) {
      player.grave = [];
    }
    const previousTop = player.graveTopCardId;
    player.grave.push(unit);

    const unitCards = Array.isArray(unit.cards)
      ? unit.cards.filter((c: any) => isCardLike(c))
      : [];

    if (unitCards.length === 0) {
      return { requiresDecision: false, candidateCardIds: [] };
    }

    if (unitCards.length === 1) {
      const topCardId = unitCards[0].id;
      player.graveTopCardId = topCardId;
      recordZoneTopChanged(
        logRecorder,
        state?.stateVersion ?? 1,
        playerKey,
        previousTop,
        topCardId
      );
      return { requiresDecision: false, candidateCardIds: [] };
    }

    // 複数カード同時移動バッチ
    player.graveTopCardId = undefined;
    const candidateCardIds = unitCards.map((c: any) => c.id);

    if (!state.pendingGraveTopSelections) {
      state.pendingGraveTopSelections = [];
    }
    state.pendingGraveTopSelections.push({
      playerId: playerKey,
      candidateCardIds,
      previousTopCardId: previousTop,
      reason: "MULTI_CARD_GRAVE_MOVE",
    });

    return { requiresDecision: true, candidateCardIds };
  }

  /**
   * ダメージカードのバッチを一括して墓地に追加します。
   * - 実移動1枚: 自動的に新しい墓地TOPとして設定 (Decision不要)。
   * - 実移動2枚以上: 墓地TOPを一旦クリアし、ダメージカードの中から所有者にTOP選択Decisionを要求するPendingを登録。
   */
  static addDamageBatchToGrave(
    targetPlayer: any,
    damageCards: any[],
    state: any,
    targetPlayerKey: string,
    requestId?: string,
    logRecorder?: any,
    effectInterpreter?: any,
    damageContext?: any
  ): { requiresDecision: boolean; candidateCardIds: string[] } {
    if (!Array.isArray(targetPlayer.grave)) {
      targetPlayer.grave = [];
    }
    const previousTop = targetPlayer.graveTopCardId;

    for (let i = 0; i < damageCards.length; i++) {
      const card = damageCards[i];
      const graveUnitId = `unit-grave-${requestId || "req"}-${card.id}-${targetPlayerKey}-${i}-${state?.stateVersion ?? 1}`;
      targetPlayer.grave.push({
        unitId: graveUnitId,
        kind: "ダメージ",
        cards: [card],
        labels: [],
      });

      if (effectInterpreter) {
        effectInterpreter.dispatchEvent(
          {
            type: "cardMoved",
            payload: {
              card,
              fromZone: "life",
              toZone: "grave",
              playerKey: targetPlayerKey,
            },
          },
          damageContext
        );
      }
    }

    if (damageCards.length === 0) {
      return { requiresDecision: false, candidateCardIds: [] };
    }

    if (damageCards.length === 1) {
      const topCardId = damageCards[0].id;
      targetPlayer.graveTopCardId = topCardId;
      recordZoneTopChanged(
        logRecorder,
        state?.stateVersion ?? 1,
        targetPlayerKey,
        previousTop,
        topCardId
      );
      return { requiresDecision: false, candidateCardIds: [] };
    }

    // 複数枚ダメージバッチ
    targetPlayer.graveTopCardId = undefined;
    const candidateCardIds = damageCards.map((c: any) => c.id);

    if (!state.pendingGraveTopSelections) {
      state.pendingGraveTopSelections = [];
    }
    state.pendingGraveTopSelections.push({
      playerId: targetPlayerKey,
      candidateCardIds,
      previousTopCardId: previousTop,
      reason: "MULTI_CARD_GRAVE_MOVE",
    });

    return { requiresDecision: true, candidateCardIds };
  }

  /**
   * 墓地から物理カードを1枚取り出します（リアニメイト等）。
   * - 非TOP離脱: 墓地TOPは不変 (Decision不要)。
   * - TOP離脱かつ残存0枚: 墓地TOPは undefined (Decision不要)。
   * - TOP離脱かつ残存1枚: 残存1枚が自動的に新しいTOPに昇格 (Rule 20: Decision不要)。
   * - TOP離脱かつ残存2枚以上: 墓地TOPをクリアし、残存全カードから所有者がTOPを選択するDecisionを登録。
   */
  static removeCardFromGrave(
    player: any,
    cardId: string,
    state: any,
    playerKey: string,
    logRecorder?: any
  ): any {
    const previousTop = player.graveTopCardId;
    const card = removePhysicalCardFromGrave(player.grave, cardId);

    const remaining = enumeratePhysicalCardsInGrave(player.grave);
    if (remaining.length === 0) {
      player.graveTopCardId = undefined;
      if (Array.isArray(state?.pendingGraveTopSelections)) {
        state.pendingGraveTopSelections = state.pendingGraveTopSelections.filter(
          (p: any) => p.playerId !== playerKey
        );
      }
      recordZoneTopChanged(
        logRecorder,
        state?.stateVersion ?? 1,
        playerKey,
        previousTop,
        undefined
      );
    } else if (remaining.length === 1) {
      // 残存1枚の場合は選択肢が一意なため自動TOP昇格 (Rule 20: Decision不要)
      const newTopId = remaining[0].id;
      player.graveTopCardId = newTopId;
      if (Array.isArray(state?.pendingGraveTopSelections)) {
        state.pendingGraveTopSelections = state.pendingGraveTopSelections.filter(
          (p: any) => p.playerId !== playerKey
        );
      }
      recordZoneTopChanged(
        logRecorder,
        state?.stateVersion ?? 1,
        playerKey,
        previousTop,
        newTopId
      );
    } else if (cardId === previousTop) {
      // 残存2枚以上で TOP が離脱した場合: 全残存カードから所有者が選択
      player.graveTopCardId = undefined;
      const candidateCardIds = remaining.map((c: any) => c.id);

      if (!state.pendingGraveTopSelections) {
        state.pendingGraveTopSelections = [];
      }
      state.pendingGraveTopSelections.push({
        playerId: playerKey,
        candidateCardIds,
        previousTopCardId: previousTop,
        reason: "TOP_REMOVED",
      });
    } else if (previousTop === undefined && Array.isArray(state?.pendingGraveTopSelections)) {
      // pending が存在する場合、候補から除去されたカードを更新
      const pending = state.pendingGraveTopSelections.find((p: any) => p.playerId === playerKey);
      if (pending) {
        pending.candidateCardIds = pending.candidateCardIds.filter((id: string) => id !== cardId);
        if (pending.candidateCardIds.length === 1) {
          const autoTopId = pending.candidateCardIds[0];
          player.graveTopCardId = autoTopId;
          state.pendingGraveTopSelections = state.pendingGraveTopSelections.filter(
            (p: any) => p.playerId !== playerKey
          );
          recordZoneTopChanged(
            logRecorder,
            state?.stateVersion ?? 1,
            playerKey,
            pending.previousTopCardId,
            autoTopId
          );
        }
      }
    }

    return card;
  }

  /**
   * 所有者による墓地TOP選択結果を適用します。
   */
  static applyGraveTopSelection(
    state: any,
    playerId: string,
    selectedCardId: string,
    logRecorder?: any,
    stateVersion?: number
  ): void {
    const player = state.players?.[playerId];
    if (!player) {
      throw new Error(`applyGraveTopSelection: プレイヤーが見つかりません: ${playerId}`);
    }

    const loc = findPhysicalCardInGrave(player.grave, selectedCardId);
    if (!loc) {
      throw new Error(
        `applyGraveTopSelection: 選択されたカード (${selectedCardId}) が墓地に存在しません (fail-closed)`
      );
    }

    let previousTop: string | undefined = undefined;
    if (Array.isArray(state.pendingGraveTopSelections)) {
      const idx = state.pendingGraveTopSelections.findIndex((p: any) => p.playerId === playerId);
      if (idx !== -1) {
        const [pending] = state.pendingGraveTopSelections.splice(idx, 1);
        previousTop = pending.previousTopCardId;
        if (!pending.candidateCardIds.includes(selectedCardId)) {
          throw new Error(
            `applyGraveTopSelection: 選択されたカード (${selectedCardId}) は候補に含まれていません (fail-closed)`
          );
        }
      }
    }

    player.graveTopCardId = selectedCardId;

    recordZoneTopChanged(
      logRecorder,
      stateVersion ?? state.stateVersion ?? 1,
      playerId,
      previousTop,
      selectedCardId
    );
  }

  /**
   * PendingGraveTopSelection から ZONE_TOP_SELECTION DecisionRequest を生成します。
   */
  static createDecisionRequest(
    state: any,
    pending: PendingGraveTopSelection,
    options?: { stateVersion?: number; matchId?: string; decisionId?: string }
  ): DecisionRequest {
    const stateVersion = options?.stateVersion ?? (state.stateVersion || 1);
    const matchId = options?.matchId ?? (state.matchId || "match-1");
    const decisionId =
      options?.decisionId ?? `dec-grave-top-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const player = state.players?.[pending.playerId];

    const effectSelections: any[] = [];
    const patterns: LegalPattern[] = [];

    pending.candidateCardIds.forEach((cardId, index) => {
      const loc = findPhysicalCardInGrave(player?.grave, cardId);
      const cardName = loc ? formatCardDisplay(loc.card) : cardId;
      const summary = `墓地TOPを選択: [${cardName}]`;

      effectSelections.push({
        selectionType: "card",
        selectedValues: [cardId],
        summary,
      });

      patterns.push({
        patternId: `grave-top-select-${index}-${cardId}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: index,
      });
    });

    const catalog: DecisionCatalog = {
      actions: [],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections,
      orderSelections: [],
    };

    const observation = ObservationFactory.createObservation(state, pending.playerId);

    return {
      protocolVersion: "1.0.0",
      decisionId,
      stateVersion,
      matchId,
      playerId: pending.playerId,
      source: {
        type: "ZONE_TOP_SELECTION",
        zone: "grave",
        playerId: pending.playerId,
        reason: pending.reason,
      },
      observation,
      catalog,
      patterns,
    };
  }

  /**
   * 墓地TOP不変条件（Invariant）を検証します。
   */
  static validateGraveTopInvariant(player: any, isPendingDecision: boolean = false): void {
    if (!player || !Array.isArray(player.grave)) return;

    const cards = enumeratePhysicalCardsInGrave(player.grave);

    if (cards.length === 0) {
      if (player.graveTopCardId !== undefined) {
        throw new Error(
          `GraveTopInvariant: 墓地枚数0ですが graveTopCardId (${player.graveTopCardId}) が設定されています (fail-closed)`
        );
      }
      return;
    }

    // cards.length > 0
    if (isPendingDecision && player.graveTopCardId === undefined) {
      // Pending Decision 待機中のみ undefined を許容
      return;
    }

    if (!player.graveTopCardId) {
      throw new Error(
        `GraveTopInvariant: 墓地枚数 ${cards.length} ですが graveTopCardId が未設定です (fail-closed)`
      );
    }

    const loc = findPhysicalCardInGrave(player.grave, player.graveTopCardId);
    if (!loc) {
      throw new Error(
        `GraveTopInvariant: graveTopCardId (${player.graveTopCardId}) が墓地に存在しません (fail-closed)`
      );
    }
  }

  /**
   * 古い Snapshot やテストフィクスチャの非明示的 TOP を境界で安全に移行（Migration）します。
   */
  static migrateLegacyGraveTop(player: any): void {
    if (!player || player.graveTopCardId !== undefined) return;
    if (!Array.isArray(player.grave) || player.grave.length === 0) {
      player.graveTopCardId = undefined;
      return;
    }

    const tail = player.grave[player.grave.length - 1];
    if (isCardLike(tail)) {
      player.graveTopCardId = tail.id;
    } else if (Array.isArray(tail.cards) && tail.cards.length === 1 && isCardLike(tail.cards[0])) {
      player.graveTopCardId = tail.cards[0].id;
    }
    // multi-card wrapper の場合は推測せず undefined のまま維持
  }
}
