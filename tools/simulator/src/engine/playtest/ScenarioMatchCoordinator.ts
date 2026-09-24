import {
  ScenarioDefinitionV1,
  normalizeScenarioDefinitionV1,
} from "../../domain/scenario/ScenarioTypes";
import { ScenarioCompiler } from "../scenario/ScenarioCompiler";
import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import {
  ActiveMatchContext,
  extractRegulationId,
} from "./PlaytestEnvironmentController";
import {
  PlaytestMatchMode,
  PlaytestPolicyId,
  PlaytestSeatControllers,
  normalizeHumanSeatForMode,
  createSeatControllers,
} from "./PlaytestSeatController";
import { PlaytestPolicyFactory } from "./PlaytestPolicyFactory";
import { GameSession, GameSessionStep } from "../session/GameSession";
import { DecisionPolicy } from "../simulation/DecisionPolicy";

/**
 * 確定コミット待ちの準備済み対戦コンテキスト
 */
export interface PreparedMatch {
  readonly session: GameSession;
  readonly activeMatch: ActiveMatchContext;
  readonly mode: PlaytestMatchMode;
  readonly humanSeat: "p1" | "p2";
  readonly policyId: PlaytestPolicyId;
  readonly seatControllers: PlaytestSeatControllers;
  readonly policies: Record<string, DecisionPolicy>;
  readonly initialStep: GameSessionStep;
  readonly initialLogs?: readonly { readonly message: string; readonly level: "info" | "action" | "system"; readonly state?: any }[];
  readonly initialTraces?: readonly { readonly category: string; readonly message: string; readonly state?: any }[];
  readonly isAutoSeedRotate?: boolean;
}

export interface PrepareScenarioMatchParams {
  readonly definition: ScenarioDefinitionV1;
  readonly catalog: RegulationCatalog;
  readonly fullRulePackage: RulePackage;
  readonly mode: PlaytestMatchMode;
  readonly humanSeat: "p1" | "p2";
  readonly policyId: PlaytestPolicyId;
}

export type PrepareScenarioMatchResult =
  | {
      readonly status: "READY";
      readonly prepared: PreparedMatch;
    }
  | {
      readonly status: "PREPARE_ERROR";
      readonly title: string;
      readonly error: string;
    };

/**
 * ScenarioDefinitionV1 から新しい対戦の準備 (Prepare) を実行する Production Coordinator。
 * 失敗し得る処理 (コンパイル、セッション生成、AIポリシー初期化等) をすべて事前検証・生成し、
 * 既存の Active Match や React state に一切アクセス・変更を加えず安全に返却します。
 */
export function prepareScenarioMatchAttempt(
  params: PrepareScenarioMatchParams
): PrepareScenarioMatchResult {
  const { definition, catalog, fullRulePackage, mode, humanSeat: rawHumanSeat, policyId } = params;

  // 1. Prepare: Scenario コンパイル
  const outcome = ScenarioCompiler.compile(definition, catalog, fullRulePackage);
  if (outcome.type !== "READY") {
    const errorMsg = outcome.errors
      .map((e) => `[${e.code}] ${e.path ? `${e.path}: ` : ""}${e.message}`)
      .join("\n");
    return {
      status: "PREPARE_ERROR",
      title: "Scenario コンパイルエラー",
      error: errorMsg,
    };
  }

  // 2. Prepare: 初期ステップの前進
  let initialStep: GameSessionStep;
  try {
    initialStep = outcome.session.advance();
  } catch (err: any) {
    return {
      status: "PREPARE_ERROR",
      title: "Scenario 初期ステップ実行エラー",
      error: err.message,
    };
  }

  // 3. Prepare: SeatController および AI Policy の初期化
  const humanSeat = normalizeHumanSeatForMode(mode, rawHumanSeat);
  const seatControllers = createSeatControllers(mode, humanSeat, policyId);
  let policies: Record<string, DecisionPolicy>;
  try {
    policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, definition.seed);
  } catch (err: any) {
    return {
      status: "PREPARE_ERROR",
      title: "AI Policy 初期化エラー",
      error: err.message,
    };
  }

  // 4. ActiveMatchContext および PreparedMatch の構築
  const regId = extractRegulationId(definition.environmentId);
  const regDef = regId ? catalog.regulations.get(regId) : undefined;
  const regName = regDef?.name || definition.environmentId;

  const canonicalDefinition = normalizeScenarioDefinitionV1(definition);

  const activeMatchCtx: ActiveMatchContext = {
    environmentId: canonicalDefinition.environmentId,
    environmentName: `${regName} (Scenario)`,
    regulationId: regId ?? undefined,
    seed: canonicalDefinition.seed,
    rulePackage: outcome.rulePackage,
    isScenario: true,
    scenarioDefinition: canonicalDefinition,
  };

  const prepared: PreparedMatch = {
    session: outcome.session,
    activeMatch: activeMatchCtx,
    mode,
    humanSeat,
    policyId,
    seatControllers,
    policies,
    initialStep,
    initialLogs: [
      {
        message: `[START] Scenarioを開始しました (Match ID: ${outcome.matchId})`,
        level: "info",
        state: outcome.state,
      },
      {
        message: `[SCENARIO] Turn Player: ${definition.turnPlayer}, Chance Player: ${definition.chancePlayer}, Seed: ${definition.seed}`,
        level: "info",
        state: outcome.state,
      },
    ],
    initialTraces: [
      {
        category: "SCENARIO_START",
        message: `Scenario開始 (Seed: ${definition.seed})`,
        state: outcome.state,
      },
    ],
    isAutoSeedRotate: false,
  };

  return {
    status: "READY",
    prepared,
  };
}
