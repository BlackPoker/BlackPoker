import { PlayerKey } from "../../domain/decision/DecisionSource";
import { PlayerObservation } from "../../domain/decision/PlayerObservation";

export interface PlayerBoardViewModel {
  readonly playerKey: string;
  readonly name: string;
  readonly isViewer: boolean;
  readonly isTurnPlayer: boolean;
  readonly isChancePlayer: boolean;
  // Life 表示（自分: "15", 相手: 10以上なら "10以上", 9以下なら "9"）
  readonly lifeDisplay: string;
  readonly lifeCount: number;
  // Hand
  readonly handCount: number;
  readonly handCards: readonly any[];
  // Field
  readonly fieldUnits: readonly any[];
  // Fog
  readonly fog: readonly any[];
  // Grave
  readonly graveCount: number;
  readonly graveTopCard?: any;
  readonly graveCards: readonly any[];
  readonly canViewFullGrave: boolean;
}

export class PlayerObservationPresenter {
  /**
   * GameState と Observation（または viewerPlayerId）から PlayerBoard 表示用 ViewModel を構築します。
   */
  static buildPlayerViewModel(
    playerKey: string,
    state: any,
    observation: PlayerObservation | undefined,
    viewerPlayerId: PlayerKey,
    showDebug: boolean = false
  ): PlayerBoardViewModel {
    const rawPlayer = state?.players?.[playerKey] || {};
    const isViewer = playerKey === viewerPlayerId;
    const isTurnPlayer = state?.turnPlayer === playerKey;
    const isChancePlayer = state?.chancePlayer === playerKey;

    // Observation からプレイヤー視点ビューを検索
    const obsPlayer = observation?.players?.find((p) => p.playerId === playerKey);

    // 1. Life 表示の計算
    // ルール: 自分のLifeは正確な枚数。相手のLifeは9以下なら正確な枚数、10以上なら「10以上」
    const lifeCount = Array.isArray(rawPlayer.life)
      ? rawPlayer.life.length
      : typeof rawPlayer.life === "number"
      ? rawPlayer.life
      : 0;

    let lifeDisplay: string;
    if (showDebug || isViewer) {
      lifeDisplay = String(lifeCount);
    } else {
      lifeDisplay = lifeCount >= 10 ? "10以上" : String(lifeCount);
    }

    // 2. Hand の計算
    // ルール: 自分は KNOWN（実カード）、相手は HIDDEN（枚数のみ・カード内容は非公開）
    const rawHand = Array.isArray(rawPlayer.hand) ? rawPlayer.hand : [];
    const handCount = rawHand.length;
    let handCards: readonly any[];

    if (showDebug || isViewer) {
      handCards = rawHand;
    } else {
      // 相手の手札は裏向きカードとして表示（HIDDEN）
      handCards = rawHand.map((c: any, idx: number) => ({
        id: `hidden-hand-${idx}`,
        faceDown: true,
        visibility: "HIDDEN",
      }));
    }

    // 3. Field の計算
    // ルール: 自分の裏向き防壁は詳細確認可能、相手の裏向き防壁は伏せられたまま
    const rawField = Array.isArray(rawPlayer.field) ? rawPlayer.field : [];
    const fieldUnits = rawField.map((u: any) => {
      const isFaceDown = u.face === "down";
      const isBulwark = u.componentId === "character.bulwark" || u.kind === "防壁";

      if (isFaceDown && isBulwark && !isViewer && !showDebug) {
        // 相手の伏せ防壁はカード情報を伏せる
        return {
          ...u,
          cards: (u.cards || []).map(() => ({ faceDown: true, visibility: "HIDDEN" })),
          currentSize: undefined,
        };
      }
      return u;
    });

    // 4. Fog の計算 (公開情報)
    const fog = Array.isArray(rawPlayer.fog) ? rawPlayer.fog : [];

    // 5. 墓地 (Grave) の計算
    // ルール: 墓地枚数と墓地トップカードは誰でも確認可能。墓地全カード一覧はオーナー本人のみ確認可能
    const rawGrave = Array.isArray(rawPlayer.grave) ? rawPlayer.grave : [];
    const graveCount = rawGrave.length;
    const graveTopCard = graveCount > 0 ? rawGrave[rawGrave.length - 1] : undefined;

    const canViewFullGrave = showDebug || isViewer;
    const graveCards = canViewFullGrave
      ? rawGrave
      : (graveTopCard ? [graveTopCard] : []);

    return {
      playerKey,
      name: rawPlayer.name || (playerKey === "p1" ? "Player A" : "Player B"),
      isViewer,
      isTurnPlayer,
      isChancePlayer,
      lifeDisplay,
      lifeCount,
      handCount,
      handCards,
      fieldUnits,
      fog,
      graveCount,
      graveTopCard,
      graveCards,
      canViewFullGrave,
    };
  }
}
