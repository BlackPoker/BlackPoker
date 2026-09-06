import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession, GameSessionStep } from "../session/GameSession";
import { validatePlaytestPreset } from "../session/playtest/validatePlaytestPreset";
import { RegulationValidator } from "../regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchSetup } from "../regulation/OfficialRegulationMatchSetup";
import { createCoreBattlePresetState, CORE_BATTLE_PRESET_ID } from "../session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../session/setup/MatchSetupCoordinator";
import { getPlaytestRulePackage } from "../rules/RulePackageSelector";

/**
 * 現在成立して進行中の対戦コンテキスト。
 * GameSession が成立した対戦のみを表し、未成立時は null となる。
 */
export interface ActiveMatchContext {
  readonly environmentId: string;
  readonly environmentName: string;
  readonly regulationId?: string;
  readonly seed?: number;
  readonly rulePackage: RulePackage;
}

/**
 * セットアップ結果やエラーを通知する 4 種の Discriminated Union。
 */
export type SetupNotice =
  | {
      readonly type: "VALIDATION_ERROR";
      readonly title: string;
      readonly message: string;
      readonly details?: string;
    }
  | {
      readonly type: "RULE_UNSPECIFIED";
      readonly title: string;
      readonly message: string;
      readonly details?: string;
      readonly reasonCode: string;
      readonly seed: number;
    }
  | {
      readonly type: "TERMINAL";
      readonly title: string;
      readonly message: string;
      readonly details?: string;
      readonly winner?: string;
      readonly loser?: string;
      readonly reason: string;
      readonly seed: number;
      readonly environmentName: string;
    }
  | {
      readonly type: "TECHNICAL_ERROR";
      readonly title: string;
      readonly message: string;
      readonly details?: string;
      readonly errorName?: string;
      readonly seed?: number;
      readonly environmentName: string;
    };

/**
 * UI の環境セレクターに表示するオプション項目。
 */
export interface EnvironmentOption {
  readonly id: string;
  readonly name: string;
  readonly isOfficial: boolean;
  readonly regulationId?: string;
}

/**
 * Playtest UI の状態モデル。
 * Pending Settings と Active Match は完全に分離される。
 */
export interface PlaytestUIState {
  readonly pendingEnvironmentId: string;
  readonly pendingSeedInput: string;
  readonly activeMatch: ActiveMatchContext | null;
  readonly setupNotice: SetupNotice | null;
  readonly presetValidationErrors: readonly string[];
}

export const CORE_BATTLE_ENV_ID = "core-battle";
export const OFFICIAL_ENV_PREFIX = "official:";

/**
 * 指定された環境 ID が公式レギュレーション環境かどうかを判定します。
 */
export function isOfficialEnvironment(envId: string): boolean {
  return envId.startsWith(OFFICIAL_ENV_PREFIX);
}

/**
 * 公式環境 ID から regulationId を抽出します。公式環境でない場合は null を返します。
 */
export function extractRegulationId(envId: string): string | null {
  if (!isOfficialEnvironment(envId)) return null;
  return envId.slice(OFFICIAL_ENV_PREFIX.length);
}

export type SeedValidationResult =
  | { readonly valid: true; readonly seed: number; readonly error?: undefined }
  | { readonly valid: false; readonly error: string; readonly seed?: undefined };

/**
 * 公式対戦用の Seed 文字列を厳格に検証します。
 *
 * 【検証ルール】
 * - 文字列型かつトリム後が空でないこと
 * - 正負記号を含まない純粋な数字のみ（/^\d+$/）で構成されていること
 * - 小数点、指数表記、英字混入、NaN、Infinity を完全拒否
 * - Number.isSafeInteger かつ 0 以上であること
 * - 42 などの暗黙のフォールバックは一切行わない
 */
export function validateSeed(seedInput: string): SeedValidationResult {
  if (typeof seedInput !== "string") {
    return { valid: false, error: "Seedは文字列で指定してください。" };
  }
  const trimmed = seedInput.trim();
  if (trimmed === "") {
    return { valid: false, error: "Seedが入力されていません。非負整数を指定してください。" };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, error: `無効なSeedです ("${seedInput}")。非負の整数のみ指定可能です。` };
  }
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num < 0) {
    return { valid: false, error: `無効なSeedです ("${seedInput}")。安全な非負の整数範囲で指定してください。` };
  }
  return { valid: true, seed: num };
}

/**
 * レギュレーションカタログから、実装済み（simulatorImplemented === true）の公式環境を動的に列挙します。
 * Core Battle（擬似環境）を常に先頭に含みます。
 */
export function getAvailableEnvironments(catalog: RegulationCatalog): EnvironmentOption[] {
  const options: EnvironmentOption[] = [
    {
      id: CORE_BATTLE_ENV_ID,
      name: "Core Battle（開発・検証）",
      isOfficial: false,
    },
  ];

  for (const reg of catalog.regulations.values()) {
    const validation = RegulationValidator.validateRegulation(catalog, reg.id);
    if (validation.simulatorImplemented) {
      options.push({
        id: `${OFFICIAL_ENV_PREFIX}${reg.id}`,
        name: `${reg.name} (公式)`,
        isOfficial: true,
        regulationId: reg.id,
      });
    }
  }

  return options;
}

/**
 * 初期 PlaytestUIState を生成します。
 */
export function createInitialPlaytestState(
  defaultEnv: string = CORE_BATTLE_ENV_ID,
  defaultSeed: string = "42"
): PlaytestUIState {
  return {
    pendingEnvironmentId: defaultEnv,
    pendingSeedInput: defaultSeed,
    activeMatch: null,
    setupNotice: null,
    presetValidationErrors: [],
  };
}

/**
 * Pending Environment を選択します（Active Match には影響しません）。
 */
export function selectPendingEnvironment(state: PlaytestUIState, envId: string): PlaytestUIState {
  if (state.pendingEnvironmentId === envId) return state;
  return {
    ...state,
    pendingEnvironmentId: envId,
  };
}

/**
 * Pending Seed を入力します（Active Match には影響しません）。
 */
export function setPendingSeedInput(state: PlaytestUIState, seedInput: string): PlaytestUIState {
  if (state.pendingSeedInput === seedInput) return state;
  return {
    ...state,
    pendingSeedInput: seedInput,
  };
}

export interface MatchStartRequest {
  readonly environmentId: string;
  readonly seedInput: string;
  readonly catalog: RegulationCatalog;
  readonly fullRulePackage: RulePackage;
  readonly playerNames?: { readonly p1: string; readonly p2: string };
}

export type MatchStartOutcome =
  | {
      readonly type: "READY";
      readonly session: GameSession;
      readonly activeMatch: ActiveMatchContext;
      readonly initialStep: GameSessionStep;
      readonly setupNotice: null;
      readonly presetValidationErrors: readonly string[];
      readonly firstPlayer?: string;
      readonly logs: readonly { readonly message: string; readonly level: "info" | "action" | "system"; readonly state?: any }[];
      readonly traces: readonly { readonly category: string; readonly message: string; readonly state?: any }[];
    }
  | {
      readonly type: "VALIDATION_ERROR";
      readonly activeMatch: null;
      readonly setupNotice: SetupNotice;
      readonly presetValidationErrors: readonly string[];
      readonly logs: readonly { readonly message: string; readonly level: "info" | "action" | "system"; readonly state?: any }[];
      readonly traces: readonly { readonly category: string; readonly message: string; readonly state?: any }[];
    }
  | {
      readonly type: "RULE_UNSPECIFIED";
      readonly activeMatch: null;
      readonly setupNotice: SetupNotice;
      readonly presetValidationErrors: readonly string[];
      readonly logs: readonly { readonly message: string; readonly level: "info" | "action" | "system"; readonly state?: any }[];
      readonly traces: readonly { readonly category: string; readonly message: string; readonly state?: any }[];
    }
  | {
      readonly type: "TERMINAL";
      readonly activeMatch: null;
      readonly setupNotice: SetupNotice;
      readonly presetValidationErrors: readonly string[];
      readonly logs: readonly { readonly message: string; readonly level: "info" | "action" | "system"; readonly state?: any }[];
      readonly traces: readonly { readonly category: string; readonly message: string; readonly state?: any }[];
    }
  | {
      readonly type: "TECHNICAL_ERROR";
      readonly activeMatch: null;
      readonly setupNotice: SetupNotice;
      readonly presetValidationErrors: readonly string[];
      readonly logs: readonly { readonly message: string; readonly level: "info" | "action" | "system"; readonly state?: any }[];
      readonly traces: readonly { readonly category: string; readonly message: string; readonly state?: any }[];
    };

/**
 * 対戦開始リクエストを実行し、MatchStartOutcome を返します。
 *
 * 【契約】
 * - Core Battle: Seed 検証を行わず、Preset 検証と MatchSetupCoordinator を実行。
 * - Official: seedInput を厳格に検証（失敗時は VALIDATION_ERROR）。共通 Setup を実行。
 * - 非 READY（VALIDATION_ERROR, RULE_UNSPECIFIED, TERMINAL, TECHNICAL_ERROR）時は activeMatch = null とし、
 *   synthetic な GameSession や GameState は一切生成しない。
 */
export function startMatchAttempt(request: MatchStartRequest): MatchStartOutcome {
  const logs: { message: string; level: "info" | "action" | "system"; state?: any }[] = [];
  const traces: { category: string; message: string; state?: any }[] = [];

  try {
    // 1. Core Battle ルート
    if (request.environmentId === CORE_BATTLE_ENV_ID) {
      const rawState = createCoreBattlePresetState();
      const validation = validatePlaytestPreset(rawState, request.fullRulePackage);
      if (!validation.valid) {
        return {
          type: "VALIDATION_ERROR",
          activeMatch: null,
          setupNotice: {
            type: "VALIDATION_ERROR",
            title: "プリセット初期盤面検証エラー",
            message: "初期盤面プリセットの整合性チェックに失敗しました。定義を確認してください。",
            details: validation.errors.join(", "),
          },
          presetValidationErrors: validation.errors,
          logs,
          traces,
        };
      }

      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      const playtestPackage = getPlaytestRulePackage(request.fullRulePackage);
      const session = new GameSession(setupResult.state, playtestPackage);

      logs.push({ message: `[START] Core Battle Playtest を開始しました (プリセット: ${CORE_BATTLE_PRESET_ID})`, level: "info", state: setupResult.state });
      logs.push({ message: `[REGULATION] Core Battle (Preset 001)`, level: "info", state: setupResult.state });
      traces.push({ category: "MATCH_SETUP", message: `ゲーム開始 (Preset: ${CORE_BATTLE_PRESET_ID})`, state: setupResult.state });

      for (const round of setupResult.rounds) {
        const p1Code = `${round.p1Card.suit}${round.p1Card.rank}`;
        const p2Code = `${round.p2Card.suit}${round.p2Card.rank}`;
        if (round.result === "tie") {
          logs.push({ message: `[先攻決定 Round ${round.round}] Player A: ${p1Code} vs Player B: ${p2Code} -> 同値のため引き分け`, level: "action", state: setupResult.state });
        } else {
          const winnerName = round.result === "p1" ? "Player A" : "Player B";
          logs.push({ message: `[先攻決定 Round ${round.round}] Player A: ${p1Code} vs Player B: ${p2Code} -> ${winnerName} が先攻に決定`, level: "action", state: setupResult.state });
        }
      }
      logs.push({ message: `[SETUP] 公開された比較カードを両者の墓地へ移動しました`, level: "info", state: setupResult.state });
      if (setupResult.drawnCard) {
        const winnerName = setupResult.firstPlayer === "p1" ? "Player A" : "Player B";
        const drawnCode = `${setupResult.drawnCard.suit}${setupResult.drawnCard.rank}`;
        logs.push({ message: `[DRAW] 先攻の ${winnerName} がライフから1枚引きました (${drawnCode})`, level: "action", state: setupResult.state });
      }
      const winnerName = setupResult.firstPlayer === "p1" ? "Player A" : "Player B";
      logs.push({ message: `[TURN] ${winnerName} がターンとチャンスを持ってゲームを開始します`, level: "info", state: setupResult.state });

      const initialStep = session.advance();

      return {
        type: "READY",
        session,
        activeMatch: {
          environmentId: CORE_BATTLE_ENV_ID,
          environmentName: "Core Battle（開発・検証）",
          rulePackage: playtestPackage,
        },
        initialStep,
        setupNotice: null,
        presetValidationErrors: [],
        firstPlayer: setupResult.firstPlayer,
        logs,
        traces,
      };
    }

    // 2. Official Regulation ルート
    if (isOfficialEnvironment(request.environmentId)) {
      const regulationId = extractRegulationId(request.environmentId);
      if (!regulationId) {
        return {
          type: "TECHNICAL_ERROR",
          activeMatch: null,
          setupNotice: {
            type: "TECHNICAL_ERROR",
            title: "公式対戦初期化エラー",
            message: "公式対戦環境IDの形式が不正です。",
            details: `環境ID: ${request.environmentId}`,
            environmentName: request.environmentId,
          },
          presetValidationErrors: [],
          logs,
          traces,
        };
      }

      // 厳格な Seed Validation (Official のみ適用)
      const seedResult = validateSeed(request.seedInput);
      if (seedResult.valid === false) {
        const notice: SetupNotice = {
          type: "VALIDATION_ERROR",
          title: "シード値検証エラー (Seed Validation Error)",
          message: seedResult.error,
          details: `入力値: "${request.seedInput}"`,
        };
        logs.push({ message: `[VALIDATION_ERROR] ${seedResult.error}`, level: "system" });
        return {
          type: "VALIDATION_ERROR",
          activeMatch: null,
          setupNotice: notice,
          presetValidationErrors: [],
          logs,
          traces,
        };
      }

      const seed = seedResult.seed;
      const regulation = request.catalog.regulations.get(regulationId);
      if (!regulation) {
        return {
          type: "TECHNICAL_ERROR",
          activeMatch: null,
          setupNotice: {
            type: "TECHNICAL_ERROR",
            title: "公式対戦初期化エラー",
            message: `レギュレーション "${regulationId}" はカタログに存在しません。`,
            details: `regulationId: ${regulationId}`,
            environmentName: request.environmentId,
            seed,
          },
          presetValidationErrors: [],
          logs,
          traces,
        };
      }

      const validation = RegulationValidator.validateRegulation(request.catalog, regulationId, {
        assertImplemented: true,
      });

      const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
        request.fullRulePackage,
        validation.format!,
        validation.regulation!
      );

      const outcome = OfficialRegulationMatchSetup.setupMatch(
        validation.regulation!,
        validation.frame!,
        officialRulePackage,
        seed,
        {
          matchId: `match-official-${seed}`,
          playerNames: request.playerNames ?? { p1: "Player A", p2: "Player B" },
        }
      );

      if (outcome.type === "RULE_UNSPECIFIED") {
        const notice: SetupNotice = {
          type: "RULE_UNSPECIFIED",
          title: "公式セットアップ未定義 (RULE_UNSPECIFIED)",
          message: outcome.reason,
          details: `reasonCode: ${outcome.reasonCode} | seed: ${seed}`,
          reasonCode: outcome.reasonCode,
          seed,
        };
        logs.push({ message: `[RULE_UNSPECIFIED] ${outcome.reason} (reasonCode: ${outcome.reasonCode}, seed: ${seed})`, level: "system" });
        return {
          type: "RULE_UNSPECIFIED",
          activeMatch: null,
          setupNotice: notice,
          presetValidationErrors: [],
          logs,
          traces,
        };
      }

      if (outcome.type === "TERMINAL") {
        // synthetic GameSession や synthetic GameState は一切生成しない
        const notice: SetupNotice = {
          type: "TERMINAL",
          title: "公式対戦即時決着 (TERMINAL)",
          message: outcome.reason,
          details: `winner: ${outcome.winner ?? "なし"} | loser: ${outcome.loser ?? "なし"} | seed: ${seed}`,
          winner: outcome.winner,
          loser: outcome.loser,
          reason: outcome.reason,
          seed,
          environmentName: `${regulation.name} (公式)`,
        };
        logs.push({ message: `[TERMINAL] ${outcome.reason} (winner: ${outcome.winner}, loser: ${outcome.loser})`, level: "system" });
        return {
          type: "TERMINAL",
          activeMatch: null,
          setupNotice: notice,
          presetValidationErrors: [],
          logs,
          traces,
        };
      }

      // outcome.type === "READY"
      const session = new GameSession(outcome.state, officialRulePackage, {
        matchId: outcome.state.matchId,
      });

      logs.push({ message: `[START] ${regulation.name} (公式対戦) を開始しました (Seed: ${seed})`, level: "info", state: outcome.state });
      logs.push({ message: `[REGULATION] ${regulation.id} (Rules 9.1.2)`, level: "info", state: outcome.state });
      traces.push({ category: "MATCH_SETUP", message: `公式対戦開始 (Seed: ${seed})`, state: outcome.state });

      const firstPlayerName = outcome.firstPlayer === "p1" ? "Player A" : "Player B";
      logs.push({ message: `[FIRST_PLAYER] 先攻決定により ${firstPlayerName} (${outcome.firstPlayer.toUpperCase()}) が先攻に決定しました`, level: "action", state: outcome.state });
      logs.push({ message: `[GAME_START] 先攻プレイヤーがライフから1枚引いてゲームを開始します`, level: "info", state: outcome.state });

      const initialStep = session.advance();

      return {
        type: "READY",
        session,
        activeMatch: {
          environmentId: request.environmentId,
          environmentName: `${regulation.name} (公式)`,
          regulationId: regulation.id,
          seed,
          rulePackage: officialRulePackage,
        },
        initialStep,
        setupNotice: null,
        presetValidationErrors: [],
        firstPlayer: outcome.firstPlayer,
        logs,
        traces,
      };
    }

    // 未知の環境 ID
    return {
      type: "TECHNICAL_ERROR",
      activeMatch: null,
      setupNotice: {
        type: "TECHNICAL_ERROR",
        title: "対戦環境選択エラー",
        message: `未知の対戦環境 ID です: "${request.environmentId}"`,
        environmentName: request.environmentId,
      },
      presetValidationErrors: [],
      logs,
      traces,
    };
  } catch (err: any) {
    const errorName = err?.name || "Error";
    const errorMessage = err?.message || String(err);
    const seedVal = isOfficialEnvironment(request.environmentId)
      ? validateSeed(request.seedInput).valid
        ? (validateSeed(request.seedInput) as { seed: number }).seed
        : undefined
      : undefined;

    return {
      type: "TECHNICAL_ERROR",
      activeMatch: null,
      setupNotice: {
        type: "TECHNICAL_ERROR",
        title: "公式対戦初期化エラー",
        message: "公式対戦の初期化中に技術的エラーが発生しました。",
        details: `${errorName}: ${errorMessage}`,
        errorName,
        seed: seedVal,
        environmentName: request.environmentId,
      },
      presetValidationErrors: [],
      logs: [{ message: `[TECHNICAL_ERROR] ${errorName}: ${errorMessage}`, level: "system" }],
      traces: [],
    };
  }
}
