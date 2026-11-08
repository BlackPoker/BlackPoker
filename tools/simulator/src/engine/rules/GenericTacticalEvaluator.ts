/**
 * GenericTacticalEvaluator.ts
 *
 * BlackPoker Simulator - 汎用戦術評価基盤 (Work 5-1 R3)
 *
 * 【設計原則】
 * 1. アーキテクチャ境界の厳格遵守:
 *    - このモジュールは engine/rules レイヤーに属し、公式 RulePackage / YAML DSL 定義を解釈する。
 *    - DecisionPolicy (engine/ai) が直接 RulePackage を参照する境界違反を解消し、
 *      domain/decision/TacticalEvaluationTypes の抽象インターフェース (TacticalEvaluator) を実装する。
 * 2. 複製定義 (BUILTIN_FALLBACK_ACTIONS) の完全撤廃:
 *    - 公式 YAML からロードされた RulePackage を唯一の正本 (SSOT) とする。
 *    - ルール定義が存在しない場合は、偽の数値を捏造せず UNKNOWN (評価不能) として安全にフォールバック。
 * 3. 非公開情報の不確実性モデリング (Uncertainty Modeling):
 *    - 非公開カード (HIDDEN) の数値を固定値 (13 や 1) で捏造して確定扱いすることを完全禁止。
 *    - 確定 (CERTAIN)、推定・最悪想定 (ESTIMATED)、評価不能 (UNKNOWN) を厳格に区別。
 *    - ガード条件の未確定性、損害の最小〜最大〜期待値範囲 (TacticalValueRange) を算出し、誤った致死判定を防ぐ。
 * 4. Core DSL 意味論との完全整合:
 *    - guardCondition, dealDamage, moveUnitCardsToZoneTop (複数カード兵士のライフ乗せ含む),
 *      cancelRequest, moveToGraveyard, if の処理順序およびセマンティクスを Core と一致させる。
 */

import { ActionDefinition, EffectCommand, RulePackage } from "../../domain/rules/RulePackage.js";
import { loadRulePackageForBrowser } from "./BrowserRuleLoader.js";
import {
  PlayerObservation,
  RequestView,
  UnitView,
  CardView,
  KnownCardView,
  PlayerObservationView,
} from "../../domain/decision/PlayerObservation.js";
import { DecisionCatalog } from "../../domain/decision/DecisionCatalog.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import {
  TacticalEvaluator,
  TacticalRequestOutcome,
  TacticalCounterOutcome,
  TacticalValueRange,
  TacticalConditionStatus,
} from "../../domain/decision/TacticalEvaluationTypes.js";

/**
 * 確定的な単一値の TacticalValueRange を生成
 */
export function createCertainRange(val: number): TacticalValueRange {
  return {
    min: val,
    max: val,
    expected: val,
    isCertain: true,
  };
}

/**
 * 推定範囲の TacticalValueRange を生成
 */
export function createEstimatedRange(min: number, max: number, expected: number): TacticalValueRange {
  return {
    min,
    max,
    expected,
    isCertain: min === max,
  };
}

/**
 * 式評価コンテキスト
 */
export interface TacticalExprContext {
  readonly viewerPlayerId: string;
  readonly request?: Readonly<RequestView>;
  readonly pattern?: Readonly<LegalPattern>;
  readonly catalog?: Readonly<DecisionCatalog>;
  readonly observation: Readonly<PlayerObservation>;
  readonly selfView?: Readonly<PlayerObservationView>;
  readonly oppView?: Readonly<PlayerObservationView>;
  readonly targetUnit?: Readonly<UnitView>;
  readonly targetPlayerKey?: string;
  readonly targetRequest?: Readonly<RequestView>;
  readonly keyCards?: readonly CardView[];
  readonly myKeyCardValue?: number;
}

/**
 * 観測情報ベースの式評価器（不確実性を考慮）
 */
export class CoreAlignedExpressionEvaluator {
  /**
   * 条件式 (target.size != 0 && target.size % keyCards.diamond.rankValue == 0 等) を評価
   */
  public static evaluateCondition(expr: string, context: TacticalExprContext): TacticalConditionStatus {
    if (!expr || typeof expr !== "string") return "CERTAIN_UNSATISFIED";
    expr = expr.trim();

    // 1. 論理 OR (||)
    const orParts = expr.split("||").map((s) => s.trim());
    if (orParts.length > 1) {
      let hasUncertain = false;
      for (const part of orParts) {
        const res = this.evaluateCondition(part, context);
        if (res === "CERTAIN_SATISFIED") return "CERTAIN_SATISFIED";
        if (res === "UNCERTAIN") hasUncertain = true;
      }
      return hasUncertain ? "UNCERTAIN" : "CERTAIN_UNSATISFIED";
    }

    // 2. 論理 AND (&&)
    const andParts = expr.split("&&").map((s) => s.trim());
    if (andParts.length > 1) {
      let hasUncertain = false;
      for (const part of andParts) {
        const res = this.evaluateCondition(part, context);
        if (res === "CERTAIN_UNSATISFIED") return "CERTAIN_UNSATISFIED";
        if (res === "UNCERTAIN") hasUncertain = true;
      }
      return hasUncertain ? "UNCERTAIN" : "CERTAIN_SATISFIED";
    }

    // 3. 比較演算子 (>=, <=, ==, !=, >, <)
    const opMatch = expr.match(/(>=|<=|==|!=|>|<)/);
    if (!opMatch) {
      const val = this.resolveNumeric(expr, context);
      if (!val.isCertain) return "UNCERTAIN";
      return val.expected !== 0 ? "CERTAIN_SATISFIED" : "CERTAIN_UNSATISFIED";
    }

    const op = opMatch[1];
    const leftStr = expr.substring(0, opMatch.index!).trim();
    const rightStr = expr.substring(opMatch.index! + op.length).trim();

    // 特殊ケース: target.size != 0 で target.size === 0 の場合は確実に偽
    if (leftStr === "target.size" && op === "!=" && rightStr === "0") {
      const size = context.targetUnit?.currentSize ?? 0;
      return size !== 0 ? "CERTAIN_SATISFIED" : "CERTAIN_UNSATISFIED";
    }

    const leftVal = this.evaluateArithmetic(leftStr, context);
    const rightVal = this.evaluateArithmetic(rightStr, context);

    // 両方確定値の場合
    if (leftVal.isCertain && rightVal.isCertain) {
      const l = leftVal.expected;
      const r = rightVal.expected;
      let satisfied = false;
      switch (op) {
        case "==": satisfied = l === r; break;
        case "!=": satisfied = l !== r; break;
        case ">=": satisfied = l >= r; break;
        case "<=": satisfied = l <= r; break;
        case ">": satisfied = l > r; break;
        case "<": satisfied = l < r; break;
      }
      return satisfied ? "CERTAIN_SATISFIED" : "CERTAIN_UNSATISFIED";
    }

    // 非公開カードに依存する場合 (例: target.size % keyCards.diamond.rankValue == 0)
    // 相手が対象を指定して発動した合法的背景から、成立可能性が存在するが未確定
    return "UNCERTAIN";
  }

  /**
   * 算術式 (+, -, %) を評価し、数値範囲を算出
   */
  public static evaluateArithmetic(expr: string, context: TacticalExprContext): TacticalValueRange {
    expr = expr.trim();
    const tokens = expr.split(/\s*([+\-%])\s*/).filter(Boolean);
    if (tokens.length <= 1) {
      return this.resolveNumeric(tokens[0] || expr, context);
    }

    let result = this.resolveNumeric(tokens[0], context);
    for (let i = 1; i < tokens.length; i += 2) {
      const op = tokens[i];
      const nextVal = this.resolveNumeric(tokens[i + 1], context);

      if (op === "+") {
        result = {
          min: result.min + nextVal.min,
          max: result.max + nextVal.max,
          expected: result.expected + nextVal.expected,
          isCertain: result.isCertain && nextVal.isCertain,
        };
      } else if (op === "-") {
        result = {
          min: result.min - nextVal.max,
          max: result.max - nextVal.min,
          expected: result.expected - nextVal.expected,
          isCertain: result.isCertain && nextVal.isCertain,
        };
      } else if (op === "%") {
        if (result.isCertain && nextVal.isCertain) {
          if (nextVal.expected <= 0) return createCertainRange(0);
          return createCertainRange(result.expected % nextVal.expected);
        }
        // 未確定剰余
        return createEstimatedRange(0, Math.max(0, nextVal.max - 1), 0);
      }
    }
    return result;
  }

  /**
   * 単一トークンの数値範囲を解決（非公開カードを固定数値で捏造しない）
   */
  public static resolveNumeric(token: string, context: TacticalExprContext): TacticalValueRange {
    token = token.trim();
    const num = Number(token);
    if (!isNaN(num)) return createCertainRange(num);

    // target.size: 公開盤面の現在サイズ
    if (token === "target.size") {
      return createCertainRange(context.targetUnit?.currentSize ?? 0);
    }

    // key.rankValue (単一キーカードのランク数値)
    if (token === "key.rankValue") {
      if (context.myKeyCardValue !== undefined) {
        return createCertainRange(context.myKeyCardValue);
      }
      const firstKey = context.keyCards?.[0];
      if (firstKey && firstKey.visibility === "KNOWN" && typeof (firstKey as any).value === "number") {
        return createCertainRange((firstKey as any).value);
      }
      if (firstKey && firstKey.visibility === "HIDDEN") {
        // 非公開キーカード: 1〜13の範囲（期待値 7 または 8）
        return createEstimatedRange(1, 13, 7);
      }
      return createCertainRange(0);
    }

    // keyCards.spade.rankValue
    if (token === "keyCards.spade.rankValue") {
      const spd = context.keyCards?.find(
        (k): k is KnownCardView => k.visibility === "KNOWN" && (k as any).suit === "spade"
      );
      if (spd && typeof spd.value === "number") {
        return createCertainRange(spd.value);
      }
      // ♠が非公開の場合: A..K (1〜13), 期待値 8 (最大想定 13)
      const hasHiddenKey = context.keyCards?.some((k) => k.visibility === "HIDDEN");
      if (hasHiddenKey) {
        return createEstimatedRange(1, 13, 8);
      }
      return createCertainRange(0);
    }

    // keyCards.diamond.rankValue
    if (token === "keyCards.diamond.rankValue") {
      const dia = context.keyCards?.find(
        (k): k is KnownCardView => k.visibility === "KNOWN" && (k as any).suit === "diamond"
      );
      if (dia && typeof dia.value === "number") {
        return createCertainRange(dia.value);
      }
      // ♢が非公開の場合: A..K (1〜13), 期待値 7
      const hasHiddenKey = context.keyCards?.some((k) => k.visibility === "HIDDEN");
      if (hasHiddenKey) {
        return createEstimatedRange(1, 13, 7);
      }
      return createCertainRange(0);
    }

    // targetRequest.keyCards.count: キーカード枚数は公開情報 (公開配列長)
    if (token === "targetRequest.keyCards.count") {
      return createCertainRange(context.targetRequest?.keyCards?.length ?? 0);
    }

    // targetRequest.keyCards.first.rankValue
    if (
      token === "targetRequest.keyCards.first.rankValue" ||
      token === "targetRequest.keyCard.rankValue"
    ) {
      const firstKey = context.targetRequest?.keyCards?.[0];
      if (firstKey && firstKey.visibility === "KNOWN" && typeof (firstKey as any).value === "number") {
        return createCertainRange((firstKey as any).value);
      }
      if (firstKey && firstKey.visibility === "HIDDEN") {
        // 非公開の場合は推定範囲 1〜13
        return createEstimatedRange(1, 13, 7);
      }
      return createCertainRange(0);
    }

    return createCertainRange(0);
  }
}

/**
 * 汎用戦術評価エンジン (engine/rules レイヤー実装)
 */
export class GenericTacticalEvaluator implements TacticalEvaluator {
  private static globalRulePackage: RulePackage | null = null;
  private readonly actionsMap: Map<string, ActionDefinition>;

  /**
   * グローバルデフォルトの RulePackage を設定
   */
  public static setDefaultRulePackage(pkg: RulePackage): void {
    GenericTacticalEvaluator.globalRulePackage = pkg;
  }

  /**
   * グローバルデフォルトの RulePackage を取得
   */
  public static getDefaultRulePackage(): RulePackage | null {
    return GenericTacticalEvaluator.globalRulePackage;
  }

  constructor(rulePackage?: Readonly<RulePackage>) {
    let pkg = rulePackage ?? GenericTacticalEvaluator.globalRulePackage;
    if (!pkg) {
      try {
        pkg = loadRulePackageForBrowser();
      } catch {
        pkg = null;
      }
    }
    this.actionsMap = new Map();
    // 複製定義 (BUILTIN_FALLBACK_ACTIONS) は完全廃止。公式 RulePackage のみを正本とする。
    if (pkg && pkg.actions) {
      for (const act of pkg.actions) {
        this.actionsMap.set(act.id, act);
      }
    }
  }

  /**
   * アクション定義を取得
   */
  public getActionDefinition(actionId: string): ActionDefinition | undefined {
    return this.actionsMap.get(actionId);
  }

  /**
   * Stage リクエストを公開観測情報および YAML DSL 定義に基づいて汎用評価
   */
  public evaluateRequestOutcome(
    req: Readonly<RequestView>,
    viewerKey: string,
    obs: Readonly<PlayerObservation>
  ): TacticalRequestOutcome {
    const selfView = obs.players.find((p) => p.playerId === viewerKey) ?? obs.players.find((p) => p.isViewer);
    const oppView = obs.players.find((p) => p.playerId !== viewerKey) ?? obs.players.find((p) => !p.isViewer);

    const reasons: string[] = [];

    // 0. 対象の特定
    let targetUnit: UnitView | undefined;
    let targetPlayerKey: string | undefined;

    if (req.target) {
      if (req.target.targetType === "player") {
        targetPlayerKey = req.target.targetPlayerKey;
      } else if (req.target.targetType === "unit" && req.target.targetUnitId) {
        const uId = req.target.targetUnitId;
        targetUnit = [...(selfView?.field ?? []), ...(selfView?.trumps ?? []), ...(oppView?.field ?? []), ...(oppView?.trumps ?? [])]
          .find((u) => u.unitId === uId);
      }
    }

    // 1. 戦闘ダメージ判定 (damageJudge)
    if (req.actionId === "action.damageJudge") {
      const oppAttackers = (oppView?.field ?? []).filter((u) => u.battle?.role === "attacker");
      const unblocked = oppAttackers.filter((u) => !u.battle?.blocksUnitId);
      const unblockedDmg = unblocked.reduce((sum, u) => sum + (u.currentSize ?? 0), 0);
      const range = createCertainRange(unblockedDmg);

      return {
        certainty: "CERTAIN",
        guardStatus: "CERTAIN_SATISFIED",
        netDamageToSelf: range,
        netDamageToOpponent: createCertainRange(0),
        directDamageToSelf: range,
        lifeGainToSelf: createCertainRange(0),
        destroyedSelfUnits: [],
        destroyedOppUnits: [],
        isGuardedOut: false,
        reasons: unblockedDmg > 0 ? [`Unblocked combat damage: ${unblockedDmg}`] : [],
      };
    }

    // 2. YAML DSL ActionDefinition の取得
    const actionDef = this.actionsMap.get(req.actionId);
    if (!actionDef || !actionDef.effect || actionDef.effect.length === 0) {
      // 公式ルール定義が存在しない場合: 偽の効果を捏造せず UNKNOWN として安全に扱う
      const zeroRange = createCertainRange(0);
      return {
        certainty: "UNKNOWN",
        guardStatus: "UNCERTAIN",
        netDamageToSelf: zeroRange,
        netDamageToOpponent: zeroRange,
        directDamageToSelf: zeroRange,
        lifeGainToSelf: zeroRange,
        destroyedSelfUnits: [],
        destroyedOppUnits: [],
        isGuardedOut: false,
        reasons: [`Action ${req.actionId} has no effect definition in RulePackage (SSOT)`],
      };
    }

    // 3. 評価コンテキストの構築
    const context: TacticalExprContext = {
      viewerPlayerId: viewerKey,
      request: req,
      observation: obs,
      selfView,
      oppView,
      targetUnit,
      targetPlayerKey,
      keyCards: req.keyCards,
    };

    let directDamageToSelf = createCertainRange(0);
    let directDamageToOpponent = createCertainRange(0);
    let lifeGainToSelf = createCertainRange(0);
    const destroyedSelfUnits: UnitView[] = [];
    const destroyedOppUnits: UnitView[] = [];
    let guardStatus: TacticalConditionStatus = "CERTAIN_SATISFIED";
    let isGuardedOut = false;
    let isCertain = true;

    // 4. DSL 効果ノードの順次評価 (Core の処理順序に準拠)
    for (const cmd of actionDef.effect) {
      const outcome = this.evaluateEffectCommand(cmd, context);

      if (outcome.guardStatus === "CERTAIN_UNSATISFIED") {
        // ガード条件確定不発: 後続効果は発動しない
        guardStatus = "CERTAIN_UNSATISFIED";
        isGuardedOut = true;
        reasons.push(`Guard condition failed: effect aborted`);
        break;
      }

      if (outcome.guardStatus === "UNCERTAIN") {
        guardStatus = "UNCERTAIN";
        isCertain = false;
      }

      directDamageToSelf = this.addRanges(directDamageToSelf, outcome.damageToSelf);
      directDamageToOpponent = this.addRanges(directDamageToOpponent, outcome.damageToOpponent);
      lifeGainToSelf = this.addRanges(lifeGainToSelf, outcome.lifeGainToSelf);

      if (outcome.destroyedUnit) {
        const isSelf = (selfView?.field ?? []).some((u) => u.unitId === outcome.destroyedUnit?.unitId);
        if (isSelf) {
          destroyedSelfUnits.push(outcome.destroyedUnit);
        } else {
          destroyedOppUnits.push(outcome.destroyedUnit);
        }
      }

      if (!outcome.isCertain) {
        isCertain = false;
      }

      if (outcome.reason) {
        reasons.push(outcome.reason);
      }
    }

    // 確定不発の場合: 全損害・効果は 0
    if (isGuardedOut) {
      const zero = createCertainRange(0);
      return {
        certainty: "CERTAIN",
        guardStatus: "CERTAIN_UNSATISFIED",
        netDamageToSelf: zero,
        netDamageToOpponent: zero,
        directDamageToSelf: zero,
        lifeGainToSelf: zero,
        destroyedSelfUnits: [],
        destroyedOppUnits: [],
        isGuardedOut: true,
        reasons,
      };
    }

    // 正味ライフ損害 = Math.max(0, directDamage - lifeGain)
    // ガードが未確定 (UNCERTAIN) の場合、不発時 (0) と成立時 (direct - lifeGain) の両方を考慮
    let netDamageToSelf: TacticalValueRange;
    if (guardStatus === "UNCERTAIN") {
      const hitMin = Math.max(0, directDamageToSelf.min - lifeGainToSelf.max);
      const hitMax = Math.max(0, directDamageToSelf.max - lifeGainToSelf.min);
      const hitExpected = Math.max(0, directDamageToSelf.expected - lifeGainToSelf.expected);
      netDamageToSelf = {
        min: 0, // 不発の可能性があるため最小値は 0
        max: hitMax,
        expected: hitExpected,
        isCertain: false,
      };
    } else {
      netDamageToSelf = {
        min: Math.max(0, directDamageToSelf.min - lifeGainToSelf.max),
        max: Math.max(0, directDamageToSelf.max - lifeGainToSelf.min),
        expected: Math.max(0, directDamageToSelf.expected - lifeGainToSelf.expected),
        isCertain: directDamageToSelf.isCertain && lifeGainToSelf.isCertain,
      };
    }

    const netDamageToOpponent = directDamageToOpponent;

    return {
      certainty: isCertain ? "CERTAIN" : "ESTIMATED",
      guardStatus,
      netDamageToSelf,
      netDamageToOpponent,
      directDamageToSelf,
      lifeGainToSelf,
      destroyedSelfUnits,
      destroyedOppUnits,
      isGuardedOut: false,
      reasons,
    };
  }

  /**
   * カウンター等の打ち消し選択肢を評価
   */
  public evaluateCounterOutcome(
    pattern: Readonly<LegalPattern>,
    targetOppReq: Readonly<RequestView>,
    request: Readonly<DecisionRequest>,
    targetReqOutcome: TacticalRequestOutcome
  ): TacticalCounterOutcome {
    const act = pattern.actionSelectionRef !== undefined ? request.catalog.actions[pattern.actionSelectionRef] : undefined;
    if (!act) {
      return { cancelStatus: "CANNOT_CANCEL", preventedDamageToSelf: createCertainRange(0), isCertain: true, reasons: [] };
    }

    const actionDef = this.actionsMap.get(act.actionId);
    if (!actionDef || !actionDef.effect) {
      return { cancelStatus: "CANNOT_CANCEL", preventedDamageToSelf: createCertainRange(0), isCertain: false, reasons: [] };
    }

    // 1. 対象リクエストの照合
    if (pattern.targetSelectionRef !== undefined) {
      const targetSel = request.catalog.targetSelections[pattern.targetSelectionRef];
      if (targetSel && targetSel.targetRequestId && targetSel.targetRequestId !== targetOppReq.requestId) {
        return {
          cancelStatus: "CANNOT_CANCEL",
          preventedDamageToSelf: createCertainRange(0),
          isCertain: true,
          reasons: [`Counter targets different request: ${targetSel.targetRequestId}`],
        };
      }
    }

    // 2. 自軍キーカードのランク数値を取得
    let myKeyCardValue = 0;
    if (pattern.keyCardSelectionRef !== undefined) {
      const cardSel = request.catalog.cardSelections[pattern.keyCardSelectionRef];
      const cardId = cardSel?.cardIds?.[0];
      const selfHand = request.observation.players.find((p) => p.playerId === request.playerId)?.handCards ?? [];
      const myCard = selfHand.find((c) => c.visibility === "KNOWN" && (c as any).cardInstanceId === cardId);
      if (myCard && myCard.visibility === "KNOWN" && typeof myCard.value === "number") {
        myKeyCardValue = myCard.value;
      }
    }

    const context: TacticalExprContext = {
      viewerPlayerId: request.playerId,
      pattern,
      catalog: request.catalog,
      observation: request.observation,
      targetRequest: targetOppReq,
      myKeyCardValue,
    };

    // 3. DSL 効果ノード内の cancelRequest 到達性を検証
    const status = this.checkCancelReachable(actionDef.effect, context);

    if (status === "CERTAIN_CANCEL") {
      return {
        cancelStatus: "CERTAIN_CANCEL",
        preventedDamageToSelf: targetReqOutcome.netDamageToSelf,
        isCertain: targetReqOutcome.netDamageToSelf.isCertain,
        reasons: [`Counter definitely prevents request ${targetOppReq.actionId}`],
      };
    }

    if (status === "UNCERTAIN_CANCEL") {
      return {
        cancelStatus: "UNCERTAIN_CANCEL",
        preventedDamageToSelf: targetReqOutcome.netDamageToSelf,
        isCertain: false,
        reasons: [`Counter potentially prevents request ${targetOppReq.actionId} (depends on hidden cards)`],
      };
    }

    return {
      cancelStatus: "CANNOT_CANCEL",
      preventedDamageToSelf: createCertainRange(0),
      isCertain: true,
      reasons: [`Counter condition cannot be satisfied for ${targetOppReq.actionId}`],
    };
  }

  /**
   * cancelRequest コマンドへの到達性を判定
   */
  private checkCancelReachable(
    commands: readonly EffectCommand[],
    context: TacticalExprContext
  ): "CERTAIN_CANCEL" | "UNCERTAIN_CANCEL" | "CANNOT_CANCEL" {
    for (const cmd of commands) {
      const cmdKey = Object.keys(cmd)[0];
      const args = (cmd as any)[cmdKey];

      if (cmdKey === "cancelRequest") {
        return "CERTAIN_CANCEL";
      }

      if (cmdKey === "if") {
        const condition = args.condition;
        const condStatus = CoreAlignedExpressionEvaluator.evaluateCondition(condition, context);

        if (condStatus === "CERTAIN_SATISFIED" && args.then && Array.isArray(args.then)) {
          return this.checkCancelReachable(args.then, context);
        }
        if (condStatus === "CERTAIN_UNSATISFIED" && args.else && Array.isArray(args.else)) {
          return this.checkCancelReachable(args.else, context);
        }
        if (condStatus === "UNCERTAIN") {
          return "UNCERTAIN_CANCEL";
        }
      }
    }
    return "CANNOT_CANCEL";
  }

  /**
   * 単一の EffectCommand を評価
   */
  private evaluateEffectCommand(
    cmd: EffectCommand,
    context: TacticalExprContext
  ): {
    damageToSelf: TacticalValueRange;
    damageToOpponent: TacticalValueRange;
    lifeGainToSelf: TacticalValueRange;
    destroyedUnit?: UnitView;
    guardStatus: TacticalConditionStatus;
    isCertain: boolean;
    reason?: string;
  } {
    const cmdKey = Object.keys(cmd)[0];
    const args = (cmd as any)[cmdKey];
    const zeroRange = createCertainRange(0);

    // (1) guardCondition
    if (cmdKey === "guardCondition") {
      const cond = args.condition;
      const status = CoreAlignedExpressionEvaluator.evaluateCondition(cond, context);
      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: status,
        isCertain: status !== "UNCERTAIN",
        reason: `guardCondition: status=${status} (${cond})`,
      };
    }

    // (2) dealDamage
    if (cmdKey === "dealDamage") {
      const amountRange = typeof args.amount === "number"
        ? createCertainRange(args.amount)
        : CoreAlignedExpressionEvaluator.evaluateArithmetic(String(args.amount), context);

      const target = args.target;
      const isTargetSelf =
        target === "self" ||
        (target === "targetPlayer" && context.targetPlayerKey === context.viewerPlayerId) ||
        (target === "targetOwner" && this.isTargetOwnerViewer(context));

      const isTargetOpponent =
        target === "opponent" ||
        (target === "targetPlayer" && context.targetPlayerKey && context.targetPlayerKey !== context.viewerPlayerId) ||
        (target === "targetOwner" && !this.isTargetOwnerViewer(context));

      return {
        damageToSelf: isTargetSelf ? amountRange : zeroRange,
        damageToOpponent: isTargetOpponent ? amountRange : zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: amountRange.isCertain,
        reason: `dealDamage: amount=[${amountRange.min}..${amountRange.max}] (toSelf=${isTargetSelf})`,
      };
    }

    // (3) moveUnitCardsToZoneTop (Core の commandHandlers.ts と一致: 複数カード兵士は全カードが移動)
    if (cmdKey === "moveUnitCardsToZoneTop") {
      const zone = args.zone;
      const isPlayerSelf =
        args.player === "self" ||
        (args.player === "targetOwner" && this.isTargetOwnerViewer(context));

      if (zone === "life" && isPlayerSelf) {
        // 兵士がライフに乗る場合: 兵士を構成するカード枚数分がライフに追加される (Core 意味論完全一致)
        const cardsCount = context.targetUnit?.cards && context.targetUnit.cards.length > 0
          ? context.targetUnit.cards.length
          : 1;

        return {
          damageToSelf: zeroRange,
          damageToOpponent: zeroRange,
          lifeGainToSelf: createCertainRange(cardsCount),
          guardStatus: "CERTAIN_SATISFIED",
          isCertain: true,
          reason: `moveUnitCardsToZoneTop: life +${cardsCount} to self`,
        };
      }

      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: true,
      };
    }

    // (4) moveToGraveyard (キル等のユニット破壊)
    if (cmdKey === "moveToGraveyard") {
      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        destroyedUnit: context.targetUnit,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: true,
        reason: context.targetUnit ? `moveToGraveyard: unit ${context.targetUnit.unitId}` : undefined,
      };
    }

    // (5) if 条件分岐
    if (cmdKey === "if") {
      const cond = args.condition;
      const status = CoreAlignedExpressionEvaluator.evaluateCondition(cond, context);

      let subCommands: EffectCommand[] | undefined;
      if (status === "CERTAIN_SATISFIED") {
        subCommands = args.then;
      } else if (status === "CERTAIN_UNSATISFIED") {
        subCommands = args.else;
      } else {
        // UNCERTAIN: then 側の最悪影響を推定として評価
        subCommands = args.then;
      }

      if (Array.isArray(subCommands)) {
        let dmgSelf = zeroRange;
        let dmgOpp = zeroRange;
        let lifeGain = zeroRange;
        let destroyed: UnitView | undefined;
        let subGuard: TacticalConditionStatus = "CERTAIN_SATISFIED";
        let certain = status !== "UNCERTAIN";

        for (const sub of subCommands) {
          const res = this.evaluateEffectCommand(sub, context);
          if (res.guardStatus === "CERTAIN_UNSATISFIED") {
            subGuard = "CERTAIN_UNSATISFIED";
            break;
          }
          if (res.guardStatus === "UNCERTAIN") subGuard = "UNCERTAIN";
          dmgSelf = this.addRanges(dmgSelf, res.damageToSelf);
          dmgOpp = this.addRanges(dmgOpp, res.damageToOpponent);
          lifeGain = this.addRanges(lifeGain, res.lifeGainToSelf);
          if (res.destroyedUnit) destroyed = res.destroyedUnit;
          if (!res.isCertain) certain = false;
        }

        return {
          damageToSelf: dmgSelf,
          damageToOpponent: dmgOpp,
          lifeGainToSelf: lifeGain,
          destroyedUnit: destroyed,
          guardStatus: subGuard,
          isCertain: certain,
        };
      }

      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: true,
      };
    }

    // (6) カード選択・順序決定・付随的状態変更コマンド (損害やガードには直接影響しないため安全にパススルー)
    if (
      cmdKey === "selectUnitCardOrder" ||
      cmdKey === "selectCard" ||
      cmdKey === "selectUnit" ||
      cmdKey === "selectTarget" ||
      cmdKey === "selectChoice" ||
      cmdKey === "setUnitState" ||
      cmdKey === "setAllUnitState" ||
      cmdKey === "createFog" ||
      cmdKey === "removeFog" ||
      cmdKey === "cleanupFogs" ||
      cmdKey === "shuffleZone" ||
      cmdKey === "revealCard"
    ) {
      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: true,
      };
    }

    // (7) その他未対応コマンド
    return {
      damageToSelf: zeroRange,
      damageToOpponent: zeroRange,
      lifeGainToSelf: zeroRange,
      guardStatus: "UNCERTAIN",
      isCertain: false,
      reason: `Unhandled effect command: ${cmdKey}`,
    };
  }

  /**
   * 2つの TacticalValueRange を加算
   */
  private addRanges(a: TacticalValueRange, b: TacticalValueRange): TacticalValueRange {
    return {
      min: a.min + b.min,
      max: a.max + b.max,
      expected: a.expected + b.expected,
      isCertain: a.isCertain && b.isCertain,
    };
  }

  /**
   * targetOwner が viewer（自軍）か判定
   */
  private isTargetOwnerViewer(context: TacticalExprContext): boolean {
    if (context.targetPlayerKey) {
      return context.targetPlayerKey === context.viewerPlayerId;
    }
    if (context.targetUnit) {
      return (context.selfView?.field ?? []).some((u) => u.unitId === context.targetUnit?.unitId) ||
        (context.selfView?.trumps ?? []).some((u) => u.unitId === context.targetUnit?.unitId);
    }
    return false;
  }
}
