import {
  PlaytestMatchMode,
  PlaytestPolicyId,
  PLAYTEST_POLICY_OPTIONS,
  normalizeHumanSeatForMode,
} from "../../engine/playtest/PlaytestSeatController";
import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import {
  CORE_BATTLE_ENV_ID,
  getAvailableEnvironments,
  isOfficialEnvironment,
  validateSeed,
  extractRegulationId,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import {
  decodeScenarioDefinitionV1FromUrlParam,
  encodeScenarioDefinitionV1ToUrlParam,
  SCENARIO_URL_PARAM_KEY,
} from "../scenario/ScenarioShareUrl";
import {
  ChallengeDefinitionV1,
  isChallengeDefinitionV1,
} from "../../domain/challenge/ChallengeDefinition";

export const SHARE_URL_VERSION = 1 as const;
export const CHALLENGE_URL_PARAM_KEY = "challenge";

export const SHARE_PARAM_KEYS = [
  "bpv",
  "env",
  "mode",
  "human",
  "policy",
  "seed",
  "challenge",
  "scenario",
] as const;

export const CHALLENGE_CODE_WIN_CURRENT_TURN = "c1.winCurrentTurn";
const CHALLENGE_PREFIX_PATTERN = /^c([0-9]+)\./;

export function encodeChallengeDefinitionToUrlParam(def: ChallengeDefinitionV1): string {
  if (def.version === 1 && def.kind === "WIN_CURRENT_TURN") {
    return CHALLENGE_CODE_WIN_CURRENT_TURN;
  }
  throw new Error(`未対応のチャレンジ定義です (version: ${(def as any)?.version}, kind: ${(def as any)?.kind})`);
}

export function decodeChallengeDefinitionFromUrlParam(
  param: string
):
  | { readonly success: true; readonly definition: ChallengeDefinitionV1 }
  | { readonly success: false; readonly error: string } {
  if (param === CHALLENGE_CODE_WIN_CURRENT_TURN) {
    return {
      success: true,
      definition: { version: 1, kind: "WIN_CURRENT_TURN" },
    };
  }

  const match = param.match(CHALLENGE_PREFIX_PATTERN);
  if (match) {
    return {
      success: false,
      error: `未対応のチャレンジフォーマットです (Unsupported challenge format: c${match[1]})。`,
    };
  }

  return {
    success: false,
    error: `無効なチャレンジパラメータです: "${param}"。`,
  };
}

/**
 * Playtest 共有設定 (Schema v1)
 */
export interface PlaytestShareConfigV1 {
  readonly version: 1;
  readonly environmentId: string;
  readonly mode: PlaytestMatchMode;
  readonly humanSeat: "p1" | "p2";
  readonly policyId: PlaytestPolicyId;
  readonly seedInput: string;
  readonly scenarioDefinition?: ScenarioDefinitionV1;
  readonly challengeDefinition?: ChallengeDefinitionV1;
}

/**
 * Playtest 共有 URL のパース結果
 */
export type PlaytestShareParseResult =
  | { readonly kind: "NOT_SHARE" }
  | { readonly kind: "UNSUPPORTED_VERSION"; readonly warnings: readonly string[] }
  | { readonly kind: "INVALID_SHARE"; readonly error: string; readonly warnings: readonly string[] }
  | {
      readonly kind: "READY";
      readonly config: PlaytestShareConfigV1;
      readonly warnings: readonly string[];
    };

/**
 * UI起動時の初期化アクション判定結果
 */
export type PlaytestInitialBootstrap =
  | {
      readonly kind: "RESTORE_SHARE_SETTINGS";
      readonly config: PlaytestShareConfigV1;
      readonly warnings: readonly string[];
    }
  | {
      readonly kind: "RESTORE_SCENARIO_SETTINGS";
      readonly config: PlaytestShareConfigV1;
      readonly definition: ScenarioDefinitionV1;
      readonly warnings: readonly string[];
    }
  | {
      readonly kind: "SHOW_SHARE_WARNING";
      readonly warnings: readonly string[];
    }
  | {
      readonly kind: "SHOW_SETUP";
    }
  | {
      readonly kind: "START_DEFAULT_MATCH";
    };

/**
 * URL またはクエリ文字列から Playtest 共有設定を解析します。
 * Pure Function であり、DOM / window / navigator には依存しません。
 */
export function parsePlaytestShareUrl(
  searchOrUrl: string,
  catalog: RegulationCatalog
): PlaytestShareParseResult {
  if (!searchOrUrl) {
    return { kind: "NOT_SHARE" };
  }

  // クエリ文字列の抽出（URL または ?query#hash 形式に対応）
  let queryStr = searchOrUrl;
  if (queryStr.includes("?")) {
    queryStr = queryStr.split("?")[1];
  }
  if (queryStr.includes("#")) {
    queryStr = queryStr.split("#")[0];
  }

  const params = new URLSearchParams(queryStr);
  const scenarioParam = params.get(SCENARIO_URL_PARAM_KEY);
  const challengeParam = params.get(CHALLENGE_URL_PARAM_KEY);
  const bpv = params.get("bpv");

  // MVP制約: challenge パラメータが存在するのに scenario が存在しない場合は fail-closed (INVALID_SHARE)
  if (challengeParam !== null && scenarioParam === null) {
    const err = "チャレンジパラメータ (challenge) はシナリオ共有URLでのみ利用可能です。";
    return {
      kind: "INVALID_SHARE",
      error: err,
      warnings: [err],
    };
  }

  // 1. Scenario パラメータが存在する場合 (Scenario Share URL)
  if (scenarioParam !== null) {
    // bpv が明示指定されている場合のバージョン検証
    if (bpv !== null && bpv !== String(SHARE_URL_VERSION)) {
      return {
        kind: "UNSUPPORTED_VERSION",
        warnings: [`未知のURLバージョンです (bpv=${bpv})。`],
      };
    }

    const decodeRes = decodeScenarioDefinitionV1FromUrlParam(scenarioParam);
    if (decodeRes.success === false) {
      return {
        kind: "INVALID_SHARE",
        error: decodeRes.error,
        warnings: [decodeRes.error],
      };
    }

    const def = decodeRes.definition;

    // Challenge パラメータの解析 (指定時のみ。不正/未知フォーマットは fail-closed)
    let challengeDefinition: ChallengeDefinitionV1 | undefined = undefined;
    if (challengeParam !== null) {
      const decodeChallengeRes = decodeChallengeDefinitionFromUrlParam(challengeParam);
      if (decodeChallengeRes.success === false) {
        return {
          kind: "INVALID_SHARE",
          error: decodeChallengeRes.error,
          warnings: [decodeChallengeRes.error],
        };
      }
      challengeDefinition = decodeChallengeRes.definition;
    }

    // レギュレーション検証 (Simulator 未実装 Regulation 等の排除)
    const regId = extractRegulationId(def.environmentId);
    if (!regId || !catalog.regulations.has(regId)) {
      const err = `未実装または未サポートのレギュレーションです: "${def.environmentId}"`;
      return {
        kind: "INVALID_SHARE",
        error: err,
        warnings: [err],
      };
    }

    try {
      const regVal = RegulationValidator.validateRegulation(catalog, regId);
      if (!regVal.simulatorImplemented) {
        const err = `未実装または未サポートのレギュレーションです: "${def.environmentId}"`;
        return {
          kind: "INVALID_SHARE",
          error: err,
          warnings: [err],
        };
      }
    } catch (_) {
      const err = `未実装または未サポートのレギュレーションです: "${def.environmentId}"`;
      return {
        kind: "INVALID_SHARE",
        error: err,
        warnings: [err],
      };
    }

    // URL env と scenario environmentId の不一致検証 (fail-closed)
    const rawEnv = params.get("env");
    if (rawEnv !== null && rawEnv !== def.environmentId) {
      const err = `環境IDの不一致: URLパラメータの env ("${rawEnv}") と scenario の environmentId ("${def.environmentId}") が一致しません。`;
      return {
        kind: "INVALID_SHARE",
        error: err,
        warnings: [err],
      };
    }

    // URL seed と scenario seed の不一致検証 (fail-closed)
    const rawSeed = params.get("seed");
    if (rawSeed !== null && rawSeed !== String(def.seed)) {
      const err = `Seedの不一致: URLパラメータの seed ("${rawSeed}") と scenario の seed ("${def.seed}") が一致しません。`;
      return {
        kind: "INVALID_SHARE",
        error: err,
        warnings: [err],
      };
    }

    const warnings: string[] = [];

    // 対戦モード (mode)
    const rawMode = params.get("mode");
    let mode: PlaytestMatchMode = "humanVsHuman";
    if (rawMode === "humanVsAi") {
      mode = "humanVsAi";
    } else if (rawMode === "humanVsHuman" || rawMode === null) {
      mode = "humanVsHuman";
    } else {
      warnings.push(`無効な対戦モードです: "${rawMode}"。デフォルト (Human vs Human) を設定しました。`);
      mode = "humanVsHuman";
    }

    // プレイヤー席 & AIポリシー
    const rawHuman = params.get("human");
    const rawPolicy = params.get("policy");
    let humanSeat: "p1" | "p2" = "p1";
    let policyId: PlaytestPolicyId = "firstLegal";

    if (mode === "humanVsAi") {
      if (rawHuman === "p2") {
        humanSeat = "p2";
      } else if (rawHuman === "p1" || rawHuman === null) {
        humanSeat = "p1";
      } else {
        warnings.push(`無効なプレイヤー席です: "${rawHuman}"。デフォルト (p1) を設定しました。`);
      }

      if (rawPolicy) {
        const matched = PLAYTEST_POLICY_OPTIONS.find((p) => p.id === rawPolicy);
        if (matched) {
          policyId = matched.id;
        } else {
          warnings.push(`無効なAIポリシーです: "${rawPolicy}"。デフォルト (FirstLegal) を設定しました。`);
        }
      }
    }

    return {
      kind: "READY",
      config: {
        version: 1,
        environmentId: def.environmentId,
        mode,
        humanSeat,
        policyId,
        seedInput: String(def.seed),
        scenarioDefinition: def,
        challengeDefinition,
      },
      warnings,
    };
  }

  // 2. Scenario パラメータが存在しない場合 (通常 Playtest Share URL)
  if (!bpv) {
    return { kind: "NOT_SHARE" };
  }

  if (bpv !== String(SHARE_URL_VERSION)) {
    return {
      kind: "UNSUPPORTED_VERSION",
      warnings: [`未知のURLバージョンです (bpv=${bpv})。デフォルト設定を維持します。`],
    };
  }

  const warnings: string[] = [];
  const availableEnvs = getAvailableEnvironments(catalog);

  // 1. 環境ID (env) の検証
  const rawEnv = params.get("env");
  let environmentId = CORE_BATTLE_ENV_ID;
  if (!rawEnv) {
    warnings.push("環境ID (env) が指定されていません。デフォルト (Core Battle) を設定しました。");
  } else {
    const matchedEnv = availableEnvs.find((e) => e.id === rawEnv);
    if (!matchedEnv) {
      warnings.push(`利用不可または未定義の環境です: "${rawEnv}"。デフォルト (Core Battle) を設定しました。`);
    } else {
      environmentId = matchedEnv.id;
    }
  }

  // 2. 対戦モード (mode) の検証
  const rawMode = params.get("mode");
  let mode: PlaytestMatchMode = "humanVsHuman";
  if (rawMode === "humanVsAi") {
    mode = "humanVsAi";
  } else if (rawMode === "humanVsHuman") {
    mode = "humanVsHuman";
  } else {
    if (rawMode !== null) {
      warnings.push(`無効な対戦モードです: "${rawMode}"。デフォルト (Human vs Human) を設定しました。`);
    }
    mode = "humanVsHuman";
  }

  // 3. プレイヤー席 (human) & AIポリシー (policy) の検証 & 正規化
  const rawHuman = params.get("human");
  const rawPolicy = params.get("policy");
  let humanSeat: "p1" | "p2" = "p1";
  let policyId: PlaytestPolicyId = "firstLegal";

  if (mode === "humanVsAi") {
    // humanSeat
    if (rawHuman === "p2") {
      humanSeat = "p2";
    } else if (rawHuman === "p1") {
      humanSeat = "p1";
    } else if (rawHuman !== null) {
      warnings.push(`無効なプレイヤー席です: "${rawHuman}"。デフォルト (p1) を設定しました。`);
    }

    // policyId
    if (rawPolicy) {
      const matchedPolicy = PLAYTEST_POLICY_OPTIONS.find((p) => p.id === rawPolicy);
      if (!matchedPolicy) {
        warnings.push(`無効なAIポリシーです: "${rawPolicy}"。デフォルト (FirstLegal) を設定しました。`);
      } else {
        policyId = matchedPolicy.id;
      }
    }

    // Policy / Environment の整合性チェック（非公式環境での SeededRandom など）
    const selectedPolicyOpt = PLAYTEST_POLICY_OPTIONS.find((p) => p.id === policyId);
    if (selectedPolicyOpt?.requiresSeed && !isOfficialEnvironment(environmentId)) {
      warnings.push(
        `選択された環境 (${environmentId}) では "${selectedPolicyOpt.label}" を使用できないため、FirstLegal に変更しました。`
      );
      policyId = "firstLegal";
    }
  } else {
    // mode === "humanVsHuman"
    // URLにhuman/policyが存在していても適用せず、Canonical値 (p1, firstLegal) に正規化
    if (rawHuman !== null) {
      warnings.push(`Human vs Human モードではプレイヤー席設定 ("${rawHuman}") は不要なため、デフォルト (p1) に正規化しました。`);
    }
    if (rawPolicy !== null) {
      warnings.push(`Human vs Human モードではAIポリシー設定 ("${rawPolicy}") は不要なため、デフォルト (FirstLegal) に正規化しました。`);
    }
    humanSeat = "p1";
    policyId = "firstLegal";
  }

  // 4. Seed (seed) の検証 & 正規化
  const rawSeed = params.get("seed");
  let seedInput = "42";
  if (isOfficialEnvironment(environmentId)) {
    if (rawSeed !== null) {
      const seedVal = validateSeed(rawSeed);
      if (seedVal.valid) {
        seedInput = rawSeed.trim();
      } else {
        warnings.push(`無効なSeedです: "${rawSeed}" (${seedVal.error})。デフォルト値 (42) を設定しました。`);
      }
    } else {
      seedInput = "42";
    }
  } else {
    // 非公式環境 (Core Battle 等) では match seed を使用しないため、既定値 "42" へ正規化
    if (rawSeed !== null) {
      warnings.push(`非公式環境 (${environmentId}) ではSeed設定 ("${rawSeed}") は不要なため、デフォルト値 (42) に正規化しました。`);
    }
    seedInput = "42";
  }

  return {
    kind: "READY",
    config: {
      version: 1,
      environmentId,
      mode,
      humanSeat,
      policyId,
      seedInput,
    },
    warnings,
  };
}

/**
 * URL またはクエリ文字列から、UI 初回起動時の動作を判定します。
 * Pure Function であり、DOM / window / navigator には依存しません。
 */
export function resolvePlaytestInitialBootstrap(
  searchOrUrl: string,
  catalog: RegulationCatalog
): PlaytestInitialBootstrap {
  const parseResult = parsePlaytestShareUrl(searchOrUrl, catalog);
  switch (parseResult.kind) {
    case "READY":
      if (parseResult.config.scenarioDefinition) {
        return {
          kind: "RESTORE_SCENARIO_SETTINGS",
          config: parseResult.config,
          definition: parseResult.config.scenarioDefinition,
          warnings: parseResult.warnings,
        };
      }
      return {
        kind: "RESTORE_SHARE_SETTINGS",
        config: parseResult.config,
        warnings: parseResult.warnings,
      };
    case "UNSUPPORTED_VERSION":
    case "INVALID_SHARE":
      return {
        kind: "SHOW_SHARE_WARNING",
        warnings: parseResult.warnings,
      };
    case "NOT_SHARE":
    default:
      return {
        kind: "SHOW_SETUP",
      };
  }
}

/**
 * Playtest 設定から Canonical クエリ文字列（先頭 ? 付き）を生成します。
 * パラメータ順序: bpv -> env -> mode -> human -> policy -> seed (および scenario)
 * モードに不要なパラメータ（humanVsHuman 時の human/policy、非公式環境時の seed）は除外されます。
 */
export function serializePlaytestShareUrl(
  config: {
    readonly environmentId: string;
    readonly mode: PlaytestMatchMode;
    readonly humanSeat?: "p1" | "p2";
    readonly policyId?: PlaytestPolicyId;
    readonly seedInput?: string;
    readonly scenarioDefinition?: ScenarioDefinitionV1;
    readonly challengeDefinition?: ChallengeDefinitionV1;
  },
  _catalog?: RegulationCatalog
): string {
  const params = new URLSearchParams();

  // 1. bpv
  params.set("bpv", String(SHARE_URL_VERSION));

  // シナリオ定義が存在する場合 (Scenario 共有)
  if (config.scenarioDefinition) {
    const def = config.scenarioDefinition;
    params.set("env", def.environmentId);
    params.set("mode", config.mode);
    if (config.mode === "humanVsAi") {
      params.set("human", config.humanSeat || "p1");
      params.set("policy", config.policyId || "firstLegal");
    }
    params.set("seed", String(def.seed));
    if (config.challengeDefinition) {
      params.set(
        CHALLENGE_URL_PARAM_KEY,
        encodeChallengeDefinitionToUrlParam(config.challengeDefinition)
      );
    }
    params.set("scenario", encodeScenarioDefinitionV1ToUrlParam(def));
    return `?${params.toString()}`;
  }

  // 通常 Playtest 共有
  // 2. env
  params.set("env", config.environmentId);

  // 3. mode
  params.set("mode", config.mode);

  // 4. human & 5. policy (Human vs AI のみ)
  if (config.mode === "humanVsAi") {
    params.set("human", config.humanSeat || "p1");
    params.set("policy", config.policyId || "firstLegal");
  }

  // 6. seed (Official 環境のみ)
  if (isOfficialEnvironment(config.environmentId)) {
    const seedVal = validateSeed(config.seedInput || "42");
    params.set("seed", seedVal.valid ? (config.seedInput || "42").trim() : "42");
  }

  return `?${params.toString()}`;
}

/**
 * 現在の URL (または href) を基準に、Share パラメータのみを置換した完全な共有 URL を構築します。
 * 既存の非Shareクエリパラメータ (foo=bar) および hash (#section) を安全に保持します。
 */
export function buildPlaytestShareUrl(
  currentUrlOrHref: string,
  config: {
    readonly environmentId: string;
    readonly mode: PlaytestMatchMode;
    readonly humanSeat?: "p1" | "p2";
    readonly policyId?: PlaytestPolicyId;
    readonly seedInput?: string;
    readonly scenarioDefinition?: ScenarioDefinitionV1;
    readonly challengeDefinition?: ChallengeDefinitionV1;
  },
  catalog?: RegulationCatalog
): string {
  let url: URL;
  let isRelative = false;

  try {
    url = new URL(currentUrlOrHref);
  } catch (_) {
    url = new URL(currentUrlOrHref, "http://localhost");
    isRelative = true;
  }

  // 既存クエリパラメータのうち、非Shareパラメータを抽出
  const nonShareParams: Array<[string, string]> = [];
  for (const [key, val] of url.searchParams.entries()) {
    if (!SHARE_PARAM_KEYS.includes(key as any)) {
      nonShareParams.push([key, val]);
    }
  }

  // Canonical Share パラメータを生成
  const canonicalQuery = serializePlaytestShareUrl(config, catalog);
  const canonicalParams = new URLSearchParams(canonicalQuery.slice(1));

  // 結合: Canonical Share パラメータの後に既存非Shareパラメータを追加
  const finalParams = new URLSearchParams();
  for (const [key, val] of canonicalParams.entries()) {
    finalParams.set(key, val);
  }
  for (const [key, val] of nonShareParams) {
    finalParams.append(key, val);
  }

  url.search = finalParams.toString();

  if (isRelative) {
    return `${url.pathname}${url.search}${url.hash}`;
  }

  return url.toString();
}
