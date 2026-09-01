import { PlayerKey } from "../../domain/decision/DecisionSource";
import { PlayerObservation, PlayerObservationView } from "../../domain/decision/PlayerObservation";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";

export interface PlayerBoardViewModel {
  readonly playerKey: string;
  readonly name: string;
  readonly isViewer: boolean;
  readonly isTurnPlayer: boolean;
  readonly isChancePlayer: boolean;
  // Life 表示（自分: "15", 相手: 10以上なら "10以上", 9以下なら "9"）
  readonly lifeDisplay: string;
  readonly lifeCount?: number;
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

/**
 * Core の PlayerObservation から PlayerBoard 表示用 ViewModel を構築する Presenter。
 * UI 側で秘密情報の公開/非公開判定を独自に再実装せず、Core の Observation を唯一の正とします。
 * Debug ON/OFF に関係なく、通常盤面は常に Observation 準拠の ViewModel を生成します。
 */
export class PlayerObservationPresenter {
  static buildPlayerViewModel(
    playerKey: string,
    observation: PlayerObservation | undefined,
    state: any,
    viewerPlayerId: PlayerKey
  ): PlayerBoardViewModel {
    // Observation がない場合は Core の ObservationFactory を用いて安全に生成 (fail-closed)
    const effectiveObservation = observation || (state ? ObservationFactory.createObservation(state, viewerPlayerId) : undefined);

    const isTurnPlayer = effectiveObservation?.turnPlayerId === playerKey;
    const isChancePlayer = effectiveObservation?.chancePlayerId === playerKey;

    // Observation 内のプレイヤー情報を取得
    const obsPlayer: PlayerObservationView | undefined = effectiveObservation?.players?.find(
      (p) => p.playerId === playerKey
    );

    if (!obsPlayer) {
      return {
        playerKey,
        name: playerKey === "p1" ? "Player A" : "Player B",
        isViewer: playerKey === viewerPlayerId,
        isTurnPlayer,
        isChancePlayer,
        lifeDisplay: "0",
        lifeCount: undefined,
        handCount: 0,
        handCards: [],
        fieldUnits: [],
        fog: [],
        graveCount: 0,
        graveCards: [],
        canViewFullGrave: playerKey === viewerPlayerId,
      };
    }

    return {
      playerKey,
      name: obsPlayer.name,
      isViewer: obsPlayer.isViewer,
      isTurnPlayer,
      isChancePlayer,
      lifeDisplay: obsPlayer.lifeDisplay,
      lifeCount: obsPlayer.lifeCount,
      handCount: obsPlayer.handCount,
      handCards: obsPlayer.handCards,
      fieldUnits: obsPlayer.field,
      fog: obsPlayer.fog,
      graveCount: obsPlayer.graveCount,
      graveTopCard: obsPlayer.graveTopCard,
      graveCards: obsPlayer.grave,
      canViewFullGrave: obsPlayer.canViewFullGrave,
    };
  }
}
