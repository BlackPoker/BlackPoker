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
 * 非公開情報（対戦相手の手札カード詳細、対戦相手の裏向き防壁、対戦相手のLife 10以上、対戦相手の非トップ墓地など）は
 * ルールに準拠してマスク/HIDDEN 化されます。
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

        // 1. ライフカード & 表示の処理
        // ルール: 自分のライフは正確な枚数。相手のライフは9以下なら正確な数値、10以上なら「10以上」
        const rawLifeCount = Array.isArray(p.life) ? p.life.length : (typeof p.life === "number" ? p.life : 0);
        const lifeDisplay = isViewer
          ? String(rawLifeCount)
          : rawLifeCount >= 10
          ? "10以上"
          : String(rawLifeCount);

        const lifeCards = Array.isArray(p.life)
          ? p.life.map((c: any) => this.mapCard(c, false)) // ライフは基本裏向き
          : undefined;

        // 2. 手札カードの処理（自分は KNOWN、相手は HIDDEN）
        const handCards = Array.isArray(p.hand)
          ? p.hand.map((c: any) => (isViewer ? this.mapCard(c, true) : this.hideCard(c)))
          : [];
        const handCount = Array.isArray(p.hand) ? p.hand.length : 0;

        // 3. フィールドユニットの処理（自分の裏向き防壁は KNOWN、相手の裏向き防壁は HIDDEN）
        const field: UnitView[] = Array.isArray(p.field)
          ? p.field.map((u: any) => this.mapUnit(u, isViewer, state))
          : [];

        // 4. フォグの処理（全フォグは公開情報、ownerPlayerId を付与）
        const fog: FogView[] = Array.isArray(p.fog)
          ? p.fog.map((f: any) => ({
              fogId: f.fogId || "",
              componentId: f.componentId || "",
              card: f.card ? this.mapCard(f.card, true) : undefined,
              bindings: f.bindings || {},
              ownerPlayerId: pKey as PlayerKey,
            }))
          : [];

        // 5. 切札の処理
        const trumps: UnitView[] = Array.isArray(p.trumps || p.trump)
          ? (p.trumps || p.trump).map((t: any) => this.mapUnit(t, isViewer, state))
          : [];

        // 6. 墓地の処理
        // ルール: 墓地枚数と墓地トップカードは全員に公開。墓地全体（非トップカード）はオーナー本人のみ確認可能
        const rawGrave = Array.isArray(p.grave) ? p.grave : [];
        const graveCount = rawGrave.length;
        const rawGraveTop = graveCount > 0 ? rawGrave[graveCount - 1] : undefined;
        const graveTopCard: CardView | undefined = rawGraveTop ? this.mapCard(rawGraveTop, true) : undefined;

        // 墓地一覧: オーナー本人は全カード確認可能、相手はトップカードのみ（または空）
        const grave: CardView[] = isViewer
          ? rawGrave.map((g: any) => this.mapCard(g, true))
          : graveTopCard
          ? [graveTopCard]
          : [];

        playersView.push({
          playerId: pKey as PlayerKey,
          name: p.name || pKey,
          isViewer,
          lifeCount: rawLifeCount,
          lifeDisplay,
          lifeCards,
          handCount,
          handCards,
          field,
          fog,
          trumps,
          graveCount,
          graveTopCard,
          grave,
          canViewFullGrave: isViewer,
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
