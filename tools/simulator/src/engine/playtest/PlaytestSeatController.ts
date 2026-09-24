import { PlayerKey } from "../../domain/decision/DecisionSource";

/**
 * 対戦モード種別:
 * - "humanVsHuman": 従来の同一画面パス＆プレイ方式
 * - "humanVsAi": 人間対AIポリシー方式
 */
export type PlaytestMatchMode = "humanVsHuman" | "humanVsAi";

/**
 * Playtest UIで選択可能な既存AI Policy ID
 */
export type PlaytestPolicyId =
  | "playtestConservative"
  | "firstLegal"
  | "seededRandom"
  | "manualGenericGenome"
  | "zeroGenome";

/**
 * UI表示用メタデータ
 */
export interface PlaytestPolicyOption {
  readonly id: PlaytestPolicyId;
  readonly label: string;
  readonly description: string;
  /** 公式レギュレーションなど、決定論的 Seed が定義されている環境でのみ有効 */
  readonly requiresSeed?: boolean;
}

export const PLAYTEST_POLICY_OPTIONS: readonly PlaytestPolicyOption[] = [
  {
    id: "playtestConservative",
    label: "Conservative (Playtest推奨)",
    description: "手札を温存しながら基本行動を行う、動作確認向けの決定論的AI",
  },
  {
    id: "firstLegal",
    label: "FirstLegal (Baseline)",
    description: "最初の合法手を常に選択する決定論的ベースライン",
  },
  {
    id: "seededRandom",
    label: "SeededRandom (Baseline)",
    description: "PRNGによる擬似乱数選択（DNA不使用・Official環境専用）",
    requiresSeed: true,
  },
  {
    id: "manualGenericGenome",
    label: "ManualGenericGenome (Experimental)",
    description: "手動設計された固定重みによるベースライン（※進化・学習済みDNAではありません）",
  },
  {
    id: "zeroGenome",
    label: "ZeroGenome (Debug)",
    description: "全特徴量重み0の基準値（DNA重みなしのデバッグ用）",
  },
];

/**
 * 各席（p1, p2）のコントローラー定義
 */
export type PlaytestSeatController =
  | {
      readonly kind: "HUMAN";
    }
  | {
      readonly kind: "POLICY";
      readonly policyId: PlaytestPolicyId;
    };

/**
 * 対戦における全席のコントローラーマッピング
 */
export interface PlaytestSeatControllers {
  readonly p1: PlaytestSeatController;
  readonly p2: PlaytestSeatController;
}

/**
 * 対戦モードに応じた Human Seat の正規化
 * Human vs AI では先攻・後攻はライフトップ比較により自動決定され、
 * Human 側の席は常に "p1" に正規化されます。
 * Human vs Human では指定された席（デフォルト "p1"）をそのまま維持します。
 */
export function normalizeHumanSeatForMode(
  mode: PlaytestMatchMode,
  humanSeat: "p1" | "p2" = "p1"
): "p1" | "p2" {
  return mode === "humanVsAi" ? "p1" : humanSeat;
}

/**
 * 対戦モード・人間席・AI Policy ID から SeatControllers を構築
 */
export function createSeatControllers(
  mode: PlaytestMatchMode,
  humanSeat: PlayerKey = "p1",
  policyId: PlaytestPolicyId = "firstLegal"
): PlaytestSeatControllers {
  if (mode === "humanVsHuman") {
    return {
      p1: { kind: "HUMAN" },
      p2: { kind: "HUMAN" },
    };
  }

  // humanVsAi
  if (humanSeat === "p2") {
    return {
      p1: { kind: "POLICY", policyId },
      p2: { kind: "HUMAN" },
    };
  }

  // デフォルト: p1 = Human, p2 = AI
  return {
    p1: { kind: "HUMAN" },
    p2: { kind: "POLICY", policyId },
  };
}

/**
 * 指定プレイヤー席が人間かどうかを判定
 */
export function isHumanSeat(seatControllers: PlaytestSeatControllers, playerId: string): boolean {
  if (playerId === "p1") return seatControllers.p1.kind === "HUMAN";
  if (playerId === "p2") return seatControllers.p2.kind === "HUMAN";
  return false;
}

/**
 * 人間プレイヤーの席ID（"p1" | "p2"）を取得（Human vs AI モード用。Human vs Human の場合は null）
 */
export function getHumanPlayerId(seatControllers: PlaytestSeatControllers): PlayerKey | null {
  const p1Human = seatControllers.p1.kind === "HUMAN";
  const p2Human = seatControllers.p2.kind === "HUMAN";
  if (p1Human && !p2Human) return "p1";
  if (!p1Human && p2Human) return "p2";
  return null;
}

/**
 * 指定席に設定された Policy ID を取得（POLICY でない場合は null）
 */
export function getPolicyIdForSeat(
  seatControllers: PlaytestSeatControllers,
  playerId: string
): PlaytestPolicyId | null {
  if (playerId === "p1" && seatControllers.p1.kind === "POLICY") return seatControllers.p1.policyId;
  if (playerId === "p2" && seatControllers.p2.kind === "POLICY") return seatControllers.p2.policyId;
  return null;
}
