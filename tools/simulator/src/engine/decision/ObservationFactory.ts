import {
  PlayerObservation,
  PlayerObservationView,
  CardView,
  KnownCardView,
  HiddenCardView,
  UnitView,
  FogView,
  RequestView,
  TargetView,
  PackView,
  RareCardView,
} from "../../domain/decision/PlayerObservation";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { AbilityEvaluator } from "../rules/AbilityEvaluator";
import { findPhysicalCardInGrave } from "../rules/graveCardUtils";
import { resolveKeyCardVisibilityOnRequest } from "../rules/keyCardUtils";
import { rankToValue } from "../rules/cardUtils";

const abilityEvaluator = new AbilityEvaluator();


/**
 * GameState から指定プレイヤー視点の PlayerObservation を生成するファクトリ。
 * 非公開情報（対戦相手の手札カード詳細、対戦相手の裏向き防壁、対戦相手のLife 10以上時の正確な枚数、
 * 対戦相手の非トップ墓地、全プレイヤーのLifeカード中身等）は
 * ルールに準拠して完全に排除/HIDDEN 化されます。
 */
export class ObservationFactory {
  /**
   * 観戦プレイヤー視点の PlayerObservation を生成
   */
  static createObservation(
    state: any,
    viewerPlayerId: PlayerKey,
    options?: { currentRequest?: any }
  ): PlayerObservation {
    const playersView: PlayerObservationView[] = [];

    if (state && state.players) {
      for (const [pKey, p] of Object.entries<any>(state.players)) {
        const isViewer = pKey === viewerPlayerId;

        // 1. ライフ表示 & 観測可能枚数の処理
        // ルール: 自分のライフは正確な枚数（lifeCount, lifeDisplay）。
        // 相手のライフは9枚以下なら正確な数値（lifeCount, lifeDisplay）、10枚以上なら exact count は秘匿 (lifeCount: undefined, lifeDisplay: "10以上")
        const rawLifeCount = Array.isArray(p.life) ? p.life.length : (typeof p.life === "number" ? p.life : 0);
        const lifeDisplay = isViewer
          ? String(rawLifeCount)
          : rawLifeCount >= 10
          ? "10以上"
          : String(rawLifeCount);

        const lifeCount = isViewer || rawLifeCount < 10 ? rawLifeCount : undefined;

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
        let graveTopCard: CardView | undefined = undefined;

        if (p.graveTopCardId) {
          const loc = findPhysicalCardInGrave(rawGrave, p.graveTopCardId);
          if (loc) {
            graveTopCard = this.mapCard(loc.card, true);
          } else {
            throw new Error(`ObservationFactory: graveTopCardId (${p.graveTopCardId}) が墓地に存在しません (fail-closed)`);
          }
        } else {
          // graveTopCardId が未設定の場合:
          // pendingDecision (Transient) の場合は undefined を厳格維持
          const hasPending = Array.isArray(state?.pendingGraveTopSelections) &&
            state.pendingGraveTopSelections.some((pending: any) => pending.playerId === pKey);
          if (!hasPending && rawGrave.length > 0) {
            // legacy / unmigrated fixture fallback
            const rawGraveTop = rawGrave[rawGrave.length - 1];
            graveTopCard = this.resolveGraveTopCard(rawGraveTop);
          } else {
            graveTopCard = undefined;
          }
        }


        // 物理カード単位に展開
        const visibleGraveCards = rawGrave.flatMap((g: any) => this.resolveGraveEntryCards(g));
        const graveCount = visibleGraveCards.length;

        // 墓地一覧: オーナー本人は全カード確認可能、相手はトップカードのみ（または空）
        const grave: CardView[] = isViewer
          ? visibleGraveCards
          : graveTopCard
          ? [graveTopCard]
          : [];

        // 7. パックの処理（未開封時は両者非公開、開封済時はオーナーのみKNOWN、相手はHIDDEN）
        let pack: PackView | undefined = undefined;
        if (p.pack) {
          const rawPack = p.pack;
          const opened = rawPack.opened === true;
          const rawCards = Array.isArray(rawPack.cards) ? rawPack.cards : [];
          const count = typeof rawPack.count === "number" ? rawPack.count : rawCards.length;

          if (!opened) {
            pack = {
              count,
              opened: false,
              cards: [],
              canViewCards: false,
            };
          } else {
            pack = {
              count,
              opened: true,
              cards: isViewer ? rawCards.map((c: any) => this.mapCard(c, true)) : [],
              canViewCards: isViewer,
            };
          }
        }

        // 8. レアカードの処理（枚数は完全公開、内容はオーナー本人のみKNOWN、対戦相手は非公開）
        let rareCards: RareCardView | undefined = undefined;
        if (p.rareCards && Array.isArray(p.rareCards)) {
          const rawRareCards = p.rareCards;
          rareCards = {
            count: rawRareCards.length,
            cards: isViewer ? rawRareCards.map((c: any) => this.mapCard(c, false)) : [],
            canViewCards: isViewer,
          };
        }

        playersView.push({
          playerId: pKey as PlayerKey,
          name: p.name || pKey,
          isViewer,
          lifeCount,
          lifeDisplay,
          handCount,
          handCards,
          field,
          fog,
          trumps,
          graveCount,
          graveTopCard,
          grave,
          canViewFullGrave: isViewer,
          pack,
          rareCards,
        });
      }
    }

    // ステージリクエストの処理（実際に state.stage.requests に存在するリクエストのみ）
    const stageRequests: RequestView[] = [];
    const stageRequestRefs: string[] = [];

    if (state && state.stage?.requests && Array.isArray(state.stage.requests)) {
      for (const req of state.stage.requests) {
        stageRequestRefs.push(req.id);
        stageRequests.push(this.mapRequestToView(req, viewerPlayerId));
      }
    }

    // Stage 外（即時解決等）の現在解決中リクエストを分離して設定（Stage に既に存在する場合は重複させない）
    let effectSourceRequest: RequestView | undefined = undefined;
    if (options?.currentRequest && options.currentRequest.id) {
      const curReq = options.currentRequest;
      const isAlreadyInStage = stageRequests.some((r) => r.requestId === curReq.id);
      if (!isAlreadyInStage) {
        effectSourceRequest = this.mapRequestToView(curReq, viewerPlayerId);
      }
    }

    return {
      viewerPlayerId,
      turnPlayerId: state?.turnPlayer,
      chancePlayerId: state?.chancePlayer,
      focusPlayerId: state?.focusPlayer,
      turnCount: typeof state?.turnCount === "number" ? state.turnCount : 0,
      players: playersView,
      stageRequestRefs,
      stageRequests,
      effectSourceRequest,
      recentEvents: [],
    };
  }

  /**
   * 対象オブジェクトが KnownCardView として成立する通常Cardの条件を満たすか判定する。
   * suit と rank の双方が定義されていることを必須とする。
   */
  private static isCardLike(entry: any): boolean {
    return (
      entry != null &&
      entry.suit !== undefined &&
      entry.rank !== undefined
    );
  }

  /**
   * 墓地エントリ（通常Card または Unit wrapper）を展開し、含まれる全CardViewを返す。
   * - 通常Card -> [mapCard(entry, true)]
   * - Unit wrapper -> entry.cards 配列内の isCardLike な全要素を mapCard 化
   * - 不明形式 / 不正要素 -> []
   */
  private static resolveGraveEntryCards(entry: any): CardView[] {
    if (!entry) return [];

    if (this.isCardLike(entry)) {
      return [this.mapCard(entry, true)];
    }

    if (Array.isArray(entry.cards)) {
      return entry.cards
        .filter((c: any) => this.isCardLike(c))
        .map((c: any) => this.mapCard(c, true));
    }

    return [];
  }

  /**
   * 墓地最上位エントリから公開可能な墓地トップCardViewを安全に解決する。
   * A. 通常Card (isCardLike) -> mapCard(entry, true)
   * B. Unit wrapper かつ cards.length === 1 (かつ cards[0] が isCardLike) -> mapCard(entry.cards[0], true)
   * C. Unit wrapper かつ cards.length > 1 -> 未解決 (undefined)
   * その他 -> undefined
   */
  private static resolveGraveTopCard(entry: any): CardView | undefined {
    if (!entry) return undefined;

    // A. 通常Card
    if (this.isCardLike(entry)) {
      return this.mapCard(entry, true);
    }

    // B & C. Unit wrapper
    if (Array.isArray(entry.cards)) {
      if (entry.cards.length === 1 && this.isCardLike(entry.cards[0])) {
        // B. 単一カードUnit wrapper
        return this.mapCard(entry.cards[0], true);
      }
      // C. cards.length > 1 (または0枚、あるいは不正カード) の場合、推測せず undefined
      return undefined;
    }

    return undefined;
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

    // 防壁、および相手の裏向きユニットは秘密情報保護のため currentSize を公開しない (undefined)
    // （相手の伏せ切札や伏せユニットの秘密カード数値漏洩を防止する generic なプライバシー境界保護）
    const shouldHideSize = isBulwark || (!isViewerOwner && isFaceDown);
    const currentSize = !shouldHideSize && state
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

  private static mapRequestToView(req: any, viewerPlayerId: PlayerKey): RequestView {
    let requestKeyCards: CardView[] | undefined = undefined;
    if (req.keyCards && Array.isArray(req.keyCards) && req.keyCards.length > 0) {
      const visibilityOnRequest = req.action
        ? resolveKeyCardVisibilityOnRequest(req.action)
        : "hidden";
      const isPublic = visibilityOnRequest === "public";
      const isController = req.controller === viewerPlayerId;

      requestKeyCards = req.keyCards.map((card: any) => {
        if (isPublic || isController) {
          return {
            visibility: "KNOWN",
            cardInstanceId: card.id,
            suit: card.suit,
            rank: card.rank,
            value: card.value ?? rankToValue(card.rank),
            faceUp: true,
            code: card.code,
          } as KnownCardView;
        } else {
          return {
            visibility: "HIDDEN",
            faceUp: false,
          } as HiddenCardView;
        }
      });
    }

    let requestTarget: TargetView | undefined = undefined;
    const rawTarget = (req.targets && Array.isArray(req.targets) && req.targets.length > 0)
      ? req.targets[0]
      : (req.target || undefined);

    if (rawTarget) {
      const tType = rawTarget.type || rawTarget.targetType || "other";
      requestTarget = {
        targetType: tType,
        targetPlayerKey: rawTarget.targetPlayerKey || (tType === "player" ? rawTarget.id || rawTarget.playerId : undefined),
        targetUnitId: rawTarget.unitId || rawTarget.targetUnitId,
        targetRequestId: rawTarget.requestId || rawTarget.targetRequestId,
        displayName: rawTarget.displayName || rawTarget.name,
      };
    }

    return {
      requestId: req.id,
      actionId: req.actionId,
      actionName: req.action?.name || req.actionId,
      actionSpeed: req.action?.request?.speed || (req.action as any)?.speed || (req as any)?.speed,
      actionTiming: req.action?.request?.timing || (req.action as any)?.timing || (req as any)?.timing,
      controller: req.controller,
      status: req.status,
      sequence: req.sequence,
      definitionOwner: req.definitionOwner,
      keyCards: requestKeyCards,
      target: requestTarget,
    };
  }
}
