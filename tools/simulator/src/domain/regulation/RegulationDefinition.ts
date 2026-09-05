import { PlayerKey } from "../decision/DecisionSource";

/**
 * フォーマット定義 (Format Definition)
 * 例: "light" (ライト)
 * 利用可能な Action ID および Component ID の集合を定義します。
 */
export interface FormatDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly actions: readonly string[];
  readonly components: readonly string[];
}

/**
 * カード定義 (Card Definition)
 */
export interface CardDefinition {
  readonly suit: "S" | "H" | "D" | "C" | "J";
  readonly rank: string;
  readonly value: number;
}

/**
 * フレームデッキ定義 (Frame Deck Definition)
 */
export interface FrameDeckDefinition {
  readonly cardCount: number;
  readonly cards: readonly CardDefinition[];
}

/**
 * フレームセットアップ定義 (Frame Setup Definition)
 */
export interface FrameSetupDefinition {
  readonly initialHandCount: number;
  readonly preset: {
    readonly bulwarkCount: number;
    readonly soldierCount: number;
  };
}

/**
 * フレーム定義 (Frame Definition)
 * 例: "entry16" (エントリー16)
 *
 * 【公式ルール第9.1.2版 2.3 & 8.3.1】
 * ルール上はどのフォーマットとも組み合わせ可能ですが、公式に推奨されるフォーマット一覧を
 * recommendedFormatIds に保持します。
 */
export interface FrameDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** 公式に推奨されるフォーマットID一覧 (エントリー16は ["light"]) */
  readonly recommendedFormatIds: readonly string[];
  readonly deck: FrameDeckDefinition;
  readonly setup: FrameSetupDefinition;
}

/**
 * 公式対戦レギュレーション定義 (Regulation Definition)
 * 例: "light-entry16" (ライト + エントリー16)
 * フォーマットとフレームの公式な組み合わせを定義します。
 */
export interface RegulationDefinition {
  readonly id: string;
  readonly name: string;
  readonly formatId: string;
  readonly frameId: string;
  readonly sourceRulesVersion: string;
}

/**
 * フォーマット、フレーム、レギュレーション定義を統合したカタログ
 */
export interface RegulationCatalog {
  readonly formats: ReadonlyMap<string, FormatDefinition>;
  readonly frames: ReadonlyMap<string, FrameDefinition>;
  readonly regulations: ReadonlyMap<string, RegulationDefinition>;
}

/**
 * レギュレーション検証結果
 */
export interface RegulationValidationResult {
  /** ルール上合法か (公式2.3原則: 常に true) */
  readonly ruleLegal: boolean;
  /** 公式推奨レギュレーションか (Table 2.1) */
  readonly recommended: boolean;
  /** 現行 Simulator で E2E 実装済みか */
  readonly simulatorImplemented: boolean;
  readonly regulation?: RegulationDefinition;
  readonly format?: FormatDefinition;
  readonly frame?: FrameDefinition;
}

/**
 * 公式ルール第9.1.2版において結果が未定義であるセットアップ結果 (RULE_UNSPECIFIED)
 * reasonCode ごとの Discriminated Union として厳格に型付けします。
 */
export type SetupRuleUnspecifiedOutcome =
  | {
      readonly type: "RULE_UNSPECIFIED";
      readonly reasonCode: "FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED";
      readonly reason: string;
      readonly exhaustedPlayers: readonly PlayerKey[];
      readonly winner?: undefined;
      readonly loser?: undefined;
    }
  | {
      readonly type: "RULE_UNSPECIFIED";
      readonly reasonCode: "GAME_START_DRAW_LIFE_EXHAUSTED";
      readonly reason: string;
      readonly exhaustedPlayers: readonly PlayerKey[];
      readonly affectedPlayer: PlayerKey;
      readonly winner?: undefined;
      readonly loser?: undefined;
    };

/**
 * ゲーム準備結果 (Setup Outcome)
 * - READY: 公式Setup完了、GameSession生成可能
 * - TERMINAL: 3.9.1 のプリセット再試行で Life が枯渇した場合など、公式ルール上の明示的「敗北」
 * - RULE_UNSPECIFIED: 公式ルール第9.1.2版に結果が定義されていないため、シミュレータが勝敗を補完しない状態
 */
export type SetupOutcome =
  | {
      readonly type: "READY";
      readonly state: any;
      readonly firstPlayer: PlayerKey;
    }
  | {
      readonly type: "TERMINAL";
      readonly winner: PlayerKey;
      readonly loser: PlayerKey;
      readonly reason: string;
    }
  | SetupRuleUnspecifiedOutcome;

/**
 * レギュレーション関連エラー基底クラス
 */
export class RegulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegulationError";
    Object.setPrototypeOf(this, RegulationError.prototype);
  }
}

/**
 * 公式ルールにおいて勝敗や処理が未定義（RULE_UNSPECIFIED）であるため、
 * GameSession を生成できない場合のエラー。
 */
export class OfficialSetupRuleUnspecifiedError extends RegulationError {
  public readonly setupOutcome: SetupRuleUnspecifiedOutcome;
  public readonly errorCode = "RULE_UNSPECIFIED" as const;
  public readonly reasonCode: SetupRuleUnspecifiedOutcome["reasonCode"];

  constructor(outcome: SetupRuleUnspecifiedOutcome) {
    super(
      `公式ルール第9.1.2版において勝敗・処理が未定義です (${outcome.reasonCode}: ${outcome.reason})`
    );
    this.name = "OfficialSetupRuleUnspecifiedError";
    this.setupOutcome = outcome;
    this.reasonCode = outcome.reasonCode;
    Object.setPrototypeOf(this, OfficialSetupRuleUnspecifiedError.prototype);
  }
}

export class UnknownRegulationError extends RegulationError {
  public readonly regulationId: string;
  constructor(regulationId: string) {
    super(`未知のレギュレーションIDです: "${regulationId}"`);
    this.name = "UnknownRegulationError";
    this.regulationId = regulationId;
    Object.setPrototypeOf(this, UnknownRegulationError.prototype);
  }
}

export class UnknownFormatError extends RegulationError {
  public readonly formatId: string;
  constructor(formatId: string) {
    super(`未知のフォーマットIDです: "${formatId}"`);
    this.name = "UnknownFormatError";
    this.formatId = formatId;
    Object.setPrototypeOf(this, UnknownFormatError.prototype);
  }
}

export class UnknownFrameError extends RegulationError {
  public readonly frameId: string;
  constructor(frameId: string) {
    super(`未知のフレームIDです: "${frameId}"`);
    this.name = "UnknownFrameError";
    this.frameId = frameId;
    Object.setPrototypeOf(this, UnknownFrameError.prototype);
  }
}

/**
 * ルール上は合法であるが、Simulator で未実装の組み合わせが要求された場合のエラー
 * (NOT_RECOMMENDED や RULE_INVALID と区別)
 */
export class SimulatorNotImplementedError extends RegulationError {
  public readonly formatId: string;
  public readonly frameId: string;
  public readonly errorCode = "SIMULATOR_NOT_IMPLEMENTED" as const;

  constructor(formatId: string, frameId: string) {
    super(
      `レギュレーション "${formatId} + ${frameId}" はルール上合法ですが、現行Simulatorバージョンでは未実装です。`
    );
    this.name = "SimulatorNotImplementedError";
    this.formatId = formatId;
    this.frameId = frameId;
    Object.setPrototypeOf(this, SimulatorNotImplementedError.prototype);
  }
}
