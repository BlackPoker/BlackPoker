import {
  PlayerObservation,
  PlayerObservationView,
  CardView,
  UnitView,
  FogView,
  RequestView,
} from "../../domain/decision/PlayerObservation";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { AbilityEvaluator } from "../rules/AbilityEvaluator";

const abilityEvaluator = new AbilityEvaluator();

/**
 * GameState から指定プレイヤー視点の PlayerObservation を生成するファクトリ。
 * 非公開情報（対戦相手の手札カード詳細や対戦相手の裏向き防壁など）は HIDDEN に変換されます。
 */
export class ObservationFactory {
  /**
   * 観戦プレイヤー視点の PlayerObservation を生成
   */
  static createObservation(state: any, viewerPlayerId: PlayerKey): PlayerObservation {
    const playersView: PlayerObservationView[] = [];

    if (state.players) {
      for (const [pKey, p] of Object.entries<any>(state.players)) {
        const isViewer = pKey === viewerPlayerId;

        // ライフカードの処理
        const lifeCards = Array.isArray(p.life)
          ? p.life.map((c: any) => this.mapCard(c, false)) // ライフは基本非公開（または裏向き）
          : undefined;
        const lifeCount = Array.isArray(p.life) ? p.life.length : (typeof p.life === "number" ? p.life : 0);

        // 手札カードの処理（自分は KNOWN、相手は HIDDEN）
        const handCards = Array.isArray(p.hand)
          ? p.hand.map((c: any) => (isViewer ? this.mapCard(c, true) : this.hideCard(c)))
          : [];
        const handCount = Array.isArray(p.hand) ? p.hand.length : 0;

        // フィールドユニットの処理（自分の裏向き防壁は KNOWN、相手の裏向き防壁は HIDDEN）
        const field: UnitView[] = Array.isArray(p.field)
          ? p.field.map((u: any) => this.mapUnit(u, isViewer, state))
          : [];

        // フォグの処理（全フォグは公開情報、ownerPlayerId を付与）
        const fog: FogView[] = Array.isArray(p.fog)
          ? p.fog.map((f: any) => ({
              fogId: f.fogId || "",
              componentId: f.componentId || "",
              card: f.card ? this.mapCard(f.card, true) : undefined,
              bindings: f.bindings || {},
              ownerPlayerId: pKey as PlayerKey,
            }))
          : [];

        // 切札の処理
        const trumps: UnitView[] = Array.isArray(p.trumps || p.trump)
          ? (p.trumps || p.trump).map((t: any) => this.mapUnit(t, isViewer, state))
          : [];

        // 墓地の処理 (墓地は公開情報)
        const grave: UnitView[] = Array.isArray(p.grave)
          ? p.grave.map((g: any) => this.mapUnit(g, true, state))
          : [];

        playersView.push({
          playerId: pKey as PlayerKey,
          name: p.name || pKey,
          lifeCount,
          lifeCards,
          handCount,
          handCards,
          field,
          fog,
          trumps,
          grave,
        });
      }
    }

    // ステージリクエストの処理
    const stageRequests: RequestView[] = [];
    const stageRequestRefs: string[] = [];

    if (state.stage?.requests && Array.isArray(state.stage.requests)) {
      for (const req of state.stage.requests) {
        stageRequestRefs.push(req.id);
        stageRequests.push({
          requestId: req.id,
          actionId: req.actionId,
          actionName: req.action?.name || req.actionId,
          controller: req.controller,
          status: req.status,
          sequence: req.sequence,
          definitionOwner: req.definitionOwner,
        });
      }
    }

    return {
      viewerPlayerId,
      turnPlayerId: state.turnPlayer,
      chancePlayerId: state.chancePlayer,
      players: playersView,
      stageRequestRefs,
      stageRequests,
      recentEvents: [],
    };
  }

  private static mapCard(card: any, faceUp: boolean = true): CardView {
    if (!card) {
      return {
        visibility: "HIDDEN",
        faceUp: false,
      };
    }
    return {
      visibility: "KNOWN",
      cardInstanceId: card.id || `${card.suit}${card.rank}`,
      suit: card.suit,
      rank: card.rank,
      value: card.value ?? 0,
      faceUp,
      code: card.code || `${card.suit}${card.rank}`,
    };
  }

  private static hideCard(card: any): CardView {
    return {
      visibility: "HIDDEN",
      opaqueCardId: card?.id ? `hidden-${card.id}` : undefined,
      faceUp: false,
    };
  }

  private static mapUnit(unit: any, isViewerOwner: boolean = false, state?: any): UnitView {
    const isFaceDown = unit.face === "down";
    const isBulwark = unit.componentId === "character.bulwark" || unit.kind === "防壁";

    const cards: CardView[] = Array.isArray(unit.cards)
      ? unit.cards.map((c: any) => {
          if (isFaceDown) {
            // 自分の裏向き防壁: KNOWN だが faceUp: false
            // 相手の裏向き防壁: HIDDEN
            return isViewerOwner ? this.mapCard(c, false) : this.hideCard(c);
          } else {
            return this.mapCard(c, true);
          }
        })
      : [];

    // 防壁には currentSize を設定せず、兵士などのユニットには state 全体評価の現在サイズを設定
    const currentSize = !isBulwark && state
      ? abilityEvaluator.calculateUnitSize(unit, state)
      : undefined;

    return {
      unitId: unit.unitId || "",
      kind: unit.kind || unit.componentId || "ユニット",
      componentId: unit.componentId,
      state: unit.state || "charge",
      face: unit.face || "up",
      cards,
      labels: unit.labels || [],
      currentSize,
      battle: unit.battle
        ? {
            role: unit.battle.role,
            targetPlayerKey: unit.battle.targetPlayerKey,
            blocksUnitId: unit.battle.blocksUnitId,
          }
        : undefined,
    };
  }
}
