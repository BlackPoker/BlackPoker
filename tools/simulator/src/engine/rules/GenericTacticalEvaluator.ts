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
import { normalizeSuit, rankToValue } from "./cardUtils.js";
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
    isUnknown: false,
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
    isUnknown: false,
  };
}

/**
 * 未知・評価不能の TacticalValueRange を生成 (確定値 0 と混同しない)
 */
export function createUnknownRange(): TacticalValueRange {
  return {
    min: 0,
    max: 0,
    expected: 0,
    isCertain: false,
    isUnknown: true,
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
 * 観測情報ベースの式評価器（不確実性および未知変数の安全性を考慮）
 */
export class CoreAlignedExpressionEvaluator {
  /**
   * 条件式 (target.size != 0 && target.size % keyCards.diamond.rankValue == 0 等) を評価
   */
  public static evaluateCondition(expr: string, context: TacticalExprContext): TacticalConditionStatus {
    if (!expr || typeof expr !== "string") return "UNKNOWN";
    expr = expr.trim();
    if (expr.length === 0) return "UNKNOWN";

    // 1. 論理 OR (||)
    const orParts = expr.split("||").map((s) => s.trim());
    if (orParts.length > 1) {
      let hasUncertain = false;
      let hasUnknown = false;
      for (const part of orParts) {
        const res = this.evaluateCondition(part, context);
        if (res === "CERTAIN_SATISFIED") return "CERTAIN_SATISFIED";
        if (res === "UNKNOWN") hasUnknown = true;
        if (res === "UNCERTAIN") hasUncertain = true;
      }
      if (hasUnknown) return "UNKNOWN";
      return hasUncertain ? "UNCERTAIN" : "CERTAIN_UNSATISFIED";
    }

    // 2. 論理 AND (&&)
    const andParts = expr.split("&&").map((s) => s.trim());
    if (andParts.length > 1) {
      let hasUncertain = false;
      let hasUnknown = false;
      for (const part of andParts) {
        const res = this.evaluateCondition(part, context);
        if (res === "CERTAIN_UNSATISFIED") return "CERTAIN_UNSATISFIED";
        if (res === "UNKNOWN") hasUnknown = true;
        if (res === "UNCERTAIN") hasUncertain = true;
      }
      if (hasUnknown) return "UNKNOWN";
      return hasUncertain ? "UNCERTAIN" : "CERTAIN_SATISFIED";
    }

    // 3. 比較演算子 (>=, <=, ==, !=, >, <)
    const opMatch = expr.match(/(>=|<=|==|!=|>|<)/);
    if (!opMatch) {
      const val = this.evaluateArithmetic(expr, context);
      if (val.isUnknown) return "UNKNOWN";
      if (!val.isCertain) return "UNCERTAIN";
      return val.expected !== 0 ? "CERTAIN_SATISFIED" : "CERTAIN_UNSATISFIED";
    }

    const op = opMatch[1];
    const leftStr = expr.substring(0, opMatch.index!).trim();
    const rightStr = expr.substring(opMatch.index! + op.length).trim();

    const leftVal = this.evaluateArithmetic(leftStr, context);
    const rightVal = this.evaluateArithmetic(rightStr, context);

    // 未知変数・未対応式が含まれる場合は UNKNOWN とし、確定値や非公開推定と混同しない
    if (leftVal.isUnknown || rightVal.isUnknown) {
      return "UNKNOWN";
    }

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
    return "UNCERTAIN";
  }

  /**
   * 算術式 (+, -, %) を評価し、数値範囲を算出
   */
  public static evaluateArithmetic(expr: string, context: TacticalExprContext): TacticalValueRange {
    if (!expr || typeof expr !== "string") return createUnknownRange();
    expr = expr.trim();
    if (expr.length === 0) return createUnknownRange();

    const tokens = expr.split(/\s*([+\-%])\s*/).filter(Boolean);
    if (tokens.length <= 1) {
      return this.resolveNumeric(tokens[0] || expr, context);
    }

    let result = this.resolveNumeric(tokens[0], context);
    if (result.isUnknown) return createUnknownRange();

    for (let i = 1; i < tokens.length; i += 2) {
      const op = tokens[i];
      const nextToken = tokens[i + 1];
      if (!nextToken) return createUnknownRange();
      const nextVal = this.resolveNumeric(nextToken, context);
      if (nextVal.isUnknown) return createUnknownRange();

      if (op === "+") {
        result = {
          min: result.min + nextVal.min,
          max: result.max + nextVal.max,
          expected: result.expected + nextVal.expected,
          isCertain: result.isCertain && nextVal.isCertain,
          isUnknown: false,
        };
      } else if (op === "-") {
        result = {
          min: result.min - nextVal.max,
          max: result.max - nextVal.min,
          expected: result.expected - nextVal.expected,
          isCertain: result.isCertain && nextVal.isCertain,
          isUnknown: false,
        };
      } else if (op === "%") {
        if (result.isCertain && nextVal.isCertain) {
          if (nextVal.expected <= 0) return createUnknownRange();
          return createCertainRange(result.expected % nextVal.expected);
        }
        // 未確定剰余 (非公開カードに依存)
        return createEstimatedRange(0, Math.max(0, nextVal.max - 1), 0);
      } else {
        return createUnknownRange();
      }
    }
    return result;
  }

  /**
   * 単一トークンの数値範囲を解決（非公開カードは ESTIMATED、未知変数は UNKNOWN とし、0 の確定値で捏造しない）
   */
  public static resolveNumeric(token: string, context: TacticalExprContext): TacticalValueRange {
    if (!token || typeof token !== "string") return createUnknownRange();
    token = token.trim();
    if (token.length === 0) return createUnknownRange();

    // 1. 数値リテラルのみを確定値として解釈 (空文字等を Number("") === 0 と誤認しない)
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      return createCertainRange(Number(token));
    }

    // 2. target.size: 公開盤面の対象ユニットの現在サイズ
    if (token === "target.size") {
      if (!context.targetUnit || typeof context.targetUnit.currentSize !== "number") {
        return createUnknownRange();
      }
      return createCertainRange(context.targetUnit.currentSize);
    }

    // 3. key.rankValue / -key.rankValue (単一キーカードのランク数値)
    if (token === "key.rankValue" || token === "-key.rankValue") {
      const sign = token.startsWith("-") ? -1 : 1;
      if (context.myKeyCardValue !== undefined) {
        return createCertainRange(sign * context.myKeyCardValue);
      }
      const firstKey = context.keyCards?.[0];
      if (firstKey && firstKey.visibility === "KNOWN") {
        const val = typeof (firstKey as any).value === "number"
          ? (firstKey as any).value
          : rankToValue((firstKey as any).rank);
        if (val > 0) {
          return createCertainRange(sign * val);
        }
      }
      if (firstKey && firstKey.visibility === "HIDDEN") {
        // 非公開キーカード: 1〜13の範囲（期待値 7）
        return sign === 1
          ? createEstimatedRange(1, 13, 7)
          : createEstimatedRange(-13, -1, -7);
      }
      return createUnknownRange();
    }

    // 4. keyCards.<suit>.rankValue (spade, diamond, heart, club)
    const suitMatch = token.match(/^keyCards\.(spade|diamond|heart|club)\.rankValue$/);
    if (suitMatch) {
      const targetSuit = suitMatch[1];
      const matchedCard = context.keyCards?.find(
        (k): k is KnownCardView =>
          k.visibility === "KNOWN" && normalizeSuit((k as any).suit) === targetSuit
      );
      if (matchedCard) {
        const val = typeof matchedCard.value === "number"
          ? matchedCard.value
          : rankToValue((matchedCard as any).rank);
        if (val > 0) {
          return createCertainRange(val);
        }
      }
      // 非公開キーカードが含まれる場合: ESTIMATED 範囲 1〜13
      const hasHiddenKey = context.keyCards?.some((k) => k.visibility === "HIDDEN");
      if (hasHiddenKey) {
        return createEstimatedRange(1, 13, targetSuit === "spade" ? 8 : 7);
      }
      return createUnknownRange();
    }

    // 5. targetRequest.keyCards.count: 対象リクエストが存在する場合のみ公開配列長を確定値として返す
    if (token === "targetRequest.keyCards.count") {
      if (!context.targetRequest || !Array.isArray(context.targetRequest.keyCards)) {
        return createUnknownRange();
      }
      return createCertainRange(context.targetRequest.keyCards.length);
    }

    // 6. targetRequest.keyCards.first.rankValue
    if (
      token === "targetRequest.keyCards.first.rankValue" ||
      token === "targetRequest.keyCard.rankValue"
    ) {
      const firstKey = context.targetRequest?.keyCards?.[0];
      if (firstKey && firstKey.visibility === "KNOWN") {
        const val = typeof (firstKey as any).value === "number"
          ? (firstKey as any).value
          : rankToValue((firstKey as any).rank);
        if (val > 0) {
          return createCertainRange(val);
        }
      }
      if (firstKey && firstKey.visibility === "HIDDEN") {
        // 非公開の場合は推定範囲 1〜13
        return createEstimatedRange(1, 13, 7);
      }
      return createUnknownRange();
    }

    // 7. 未対応の変数・トークンは 0 の確定値とせず UNKNOWN を返す
    return createUnknownRange();
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
      // 公式ルール定義が存在しない場合: 偽の効果や確定0ダメージと混同せず UNKNOWN として安全に扱う
      const unknownRange = createUnknownRange();
      return {
        certainty: "UNKNOWN",
        guardStatus: "UNKNOWN",
        netDamageToSelf: unknownRange,
        netDamageToOpponent: unknownRange,
        directDamageToSelf: unknownRange,
        lifeGainToSelf: unknownRange,
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
    let hasUnknown = false;

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

      if (outcome.guardStatus === "UNKNOWN") {
        guardStatus = "UNKNOWN";
        isCertain = false;
        hasUnknown = true;
      } else if (outcome.guardStatus === "UNCERTAIN" && guardStatus !== "UNKNOWN") {
        guardStatus = "UNCERTAIN";
        isCertain = false;
      }

      if (outcome.hasUnknown) {
        hasUnknown = true;
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

    // 未知の変数・式・対象情報が含まれる場合: 確定損害や推定損害と混同せず UNKNOWN として返す
    if (hasUnknown) {
      const unknownRange = createUnknownRange();
      return {
        certainty: "UNKNOWN",
        guardStatus: guardStatus === "CERTAIN_SATISFIED" ? "UNKNOWN" : guardStatus,
        netDamageToSelf: unknownRange,
        netDamageToOpponent: unknownRange,
        directDamageToSelf: directDamageToSelf.isUnknown ? unknownRange : directDamageToSelf,
        lifeGainToSelf: lifeGainToSelf.isUnknown ? unknownRange : lifeGainToSelf,
        destroyedSelfUnits,
        destroyedOppUnits,
        isGuardedOut: false,
        reasons,
      };
    }

    // 正味ライフ損害 = Math.max(0, directDamage - lifeGain)
    // ガードが未確定 (UNCERTAIN) の場合、不発時 (0) と成立時 (direct - lifeGain) の両方を考慮
    let netDamageToSelf: TacticalValueRange;
    if (guardStatus === "UNCERTAIN") {
      const hitMax = Math.max(0, directDamageToSelf.max - lifeGainToSelf.min);
      const hitExpected = Math.max(0, directDamageToSelf.expected - lifeGainToSelf.expected);
      netDamageToSelf = {
        min: 0, // 不発の可能性があるため最小値は 0
        max: hitMax,
        expected: hitExpected,
        isCertain: false,
        isUnknown: false,
      };
    } else {
      netDamageToSelf = {
        min: Math.max(0, directDamageToSelf.min - lifeGainToSelf.max),
        max: Math.max(0, directDamageToSelf.max - lifeGainToSelf.min),
        expected: Math.max(0, directDamageToSelf.expected - lifeGainToSelf.expected),
        isCertain: directDamageToSelf.isCertain && lifeGainToSelf.isCertain,
        isUnknown: false,
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
      return { cancelStatus: "UNKNOWN_CANCEL", preventedDamageToSelf: createUnknownRange(), isCertain: false, reasons: [] };
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

    // 2. 自軍キーカードのランク数値を取得 (未解決時に 0 で捏造しないよう undefined を保持)
    let myKeyCardValue: number | undefined = undefined;
    if (pattern.keyCardSelectionRef !== undefined) {
      const cardSel = request.catalog.cardSelections[pattern.keyCardSelectionRef];
      const cardId = cardSel?.cardIds?.[0];
      const selfHand = request.observation.players.find((p) => p.playerId === request.playerId)?.handCards ?? [];
      const myCard = selfHand.find((c) => c.visibility === "KNOWN" && (c as any).cardInstanceId === cardId);
      if (myCard && myCard.visibility === "KNOWN") {
        const val = typeof myCard.value === "number" ? myCard.value : rankToValue((myCard as any).rank);
        if (val > 0) {
          myKeyCardValue = val;
        }
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

    if (status === "UNKNOWN_CANCEL") {
      return {
        cancelStatus: "UNKNOWN_CANCEL",
        preventedDamageToSelf: createUnknownRange(),
        isCertain: false,
        reasons: [`Counter condition contains unknown expression for ${targetOppReq.actionId}`],
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
  ): "CERTAIN_CANCEL" | "UNCERTAIN_CANCEL" | "CANNOT_CANCEL" | "UNKNOWN_CANCEL" {
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
        if (condStatus === "UNKNOWN") {
          return "UNKNOWN_CANCEL";
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
    hasUnknown: boolean;
    reason?: string;
  } {
    const cmdKey = Object.keys(cmd)[0];
    const args = (cmd as any)[cmdKey];
    const zeroRange = createCertainRange(0);
    const unknownRange = createUnknownRange();

    // (1) guardCondition
    if (cmdKey === "guardCondition") {
      const cond = args.condition;
      const status = CoreAlignedExpressionEvaluator.evaluateCondition(cond, context);
      const isUnknown = status === "UNKNOWN";
      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: status,
        isCertain: status === "CERTAIN_SATISFIED" || status === "CERTAIN_UNSATISFIED",
        hasUnknown: isUnknown,
        reason: `guardCondition: status=${status} (${cond})`,
      };
    }

    // (2) dealDamage
    if (cmdKey === "dealDamage") {
      const amountRange = typeof args.amount === "number"
        ? createCertainRange(args.amount)
        : CoreAlignedExpressionEvaluator.evaluateArithmetic(String(args.amount ?? ""), context);

      const targetRole = this.resolveTargetRole(args.target, context);

      if (amountRange.isUnknown || targetRole === "UNKNOWN") {
        return {
          damageToSelf: unknownRange,
          damageToOpponent: unknownRange,
          lifeGainToSelf: zeroRange,
          guardStatus: "CERTAIN_SATISFIED",
          isCertain: false,
          hasUnknown: true,
          reason: `dealDamage: unknown amount or target (amount=${args.amount}, target=${args.target})`,
        };
      }

      const isTargetSelf = targetRole === "SELF";
      const isTargetOpponent = targetRole === "OPPONENT";

      return {
        damageToSelf: isTargetSelf ? amountRange : zeroRange,
        damageToOpponent: isTargetOpponent ? amountRange : zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: amountRange.isCertain,
        hasUnknown: false,
        reason: `dealDamage: amount=[${amountRange.min}..${amountRange.max}] (toSelf=${isTargetSelf})`,
      };
    }

    // (3) moveUnitCardsToZoneTop (Core の commandHandlers.ts と一致: 複数カード兵士は全カードが移動)
    if (cmdKey === "moveUnitCardsToZoneTop") {
      const zone = args.zone ?? "life";
      if (zone !== "life") {
        return {
          damageToSelf: zeroRange,
          damageToOpponent: zeroRange,
          lifeGainToSelf: unknownRange,
          guardStatus: "CERTAIN_SATISFIED",
          isCertain: false,
          hasUnknown: true,
          reason: `moveUnitCardsToZoneTop: unsupported zone=${zone}`,
        };
      }

      const playerRole = args.player
        ? this.resolveTargetRole(args.player, context)
        : this.resolveTargetRole("targetOwner", context);

      if (!context.targetUnit || playerRole === "UNKNOWN") {
        return {
          damageToSelf: zeroRange,
          damageToOpponent: zeroRange,
          lifeGainToSelf: unknownRange,
          guardStatus: "CERTAIN_SATISFIED",
          isCertain: false,
          hasUnknown: true,
          reason: `moveUnitCardsToZoneTop: unknown targetUnit or player`,
        };
      }

      if (playerRole === "SELF") {
        // 兵士がライフに乗る場合: 兵士を構成するカード枚数分がライフに追加される (Core 意味論完全一致)
        const cardsCount = context.targetUnit.cards && context.targetUnit.cards.length > 0
          ? context.targetUnit.cards.length
          : 1;

        return {
          damageToSelf: zeroRange,
          damageToOpponent: zeroRange,
          lifeGainToSelf: createCertainRange(cardsCount),
          guardStatus: "CERTAIN_SATISFIED",
          isCertain: true,
          hasUnknown: false,
          reason: `moveUnitCardsToZoneTop: life +${cardsCount} to self`,
        };
      }

      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: true,
        hasUnknown: false,
      };
    }

    // (4) moveToGraveyard (キル等のユニット破壊)
    if (cmdKey === "moveToGraveyard") {
      if (args.target === "target" && !context.targetUnit) {
        return {
          damageToSelf: zeroRange,
          damageToOpponent: zeroRange,
          lifeGainToSelf: zeroRange,
          guardStatus: "CERTAIN_SATISFIED",
          isCertain: false,
          hasUnknown: true,
          reason: `moveToGraveyard: target unit is unknown`,
        };
      }
      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        destroyedUnit: context.targetUnit,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: true,
        hasUnknown: false,
        reason: context.targetUnit ? `moveToGraveyard: unit ${context.targetUnit.unitId}` : undefined,
      };
    }

    // (5) if 条件分岐
    if (cmdKey === "if") {
      const cond = args.condition;
      const status = CoreAlignedExpressionEvaluator.evaluateCondition(cond, context);

      if (status === "UNKNOWN") {
        return {
          damageToSelf: unknownRange,
          damageToOpponent: unknownRange,
          lifeGainToSelf: zeroRange,
          guardStatus: "UNKNOWN",
          isCertain: false,
          hasUnknown: true,
          reason: `if: condition is UNKNOWN (${cond})`,
        };
      }

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
        let subUnknown = false;

        for (const sub of subCommands) {
          const res = this.evaluateEffectCommand(sub, context);
          if (res.guardStatus === "CERTAIN_UNSATISFIED") {
            subGuard = "CERTAIN_UNSATISFIED";
            break;
          }
          if (res.guardStatus === "UNKNOWN") {
            subGuard = "UNKNOWN";
            subUnknown = true;
          } else if (res.guardStatus === "UNCERTAIN" && subGuard !== "UNKNOWN") {
            subGuard = "UNCERTAIN";
          }
          if (res.hasUnknown) {
            subUnknown = true;
          }
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
          isCertain: certain && !subUnknown,
          hasUnknown: subUnknown,
        };
      }

      return {
        damageToSelf: zeroRange,
        damageToOpponent: zeroRange,
        lifeGainToSelf: zeroRange,
        guardStatus: "CERTAIN_SATISFIED",
        isCertain: true,
        hasUnknown: false,
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
        hasUnknown: false,
      };
    }

    // (7) その他未対応コマンド: 確定損害と混同しないよう UNKNOWN とする
    return {
      damageToSelf: unknownRange,
      damageToOpponent: unknownRange,
      lifeGainToSelf: zeroRange,
      guardStatus: "UNKNOWN",
      isCertain: false,
      hasUnknown: true,
      reason: `Unhandled effect command: ${cmdKey}`,
    };
  }

  /**
   * 2つの TacticalValueRange を加算 (UNKNOWN の伝播を含む)
   */
  private addRanges(a: TacticalValueRange, b: TacticalValueRange): TacticalValueRange {
    if (a.isUnknown || b.isUnknown) {
      return createUnknownRange();
    }
    return {
      min: a.min + b.min,
      max: a.max + b.max,
      expected: a.expected + b.expected,
      isCertain: a.isCertain && b.isCertain,
      isUnknown: false,
    };
  }

  /**
   * 対象指定文字列 ("self", "opponent", "targetPlayer", "targetOwner" 等) を
   * viewer 視点での "SELF" | "OPPONENT" | "UNKNOWN" に解決する。
   * 未知・未対応の対象指定や解決不能な対象を勝手に相手側・自分側へ確定させない。
   */
  private resolveTargetRole(
    targetSpec: string | undefined,
    context: TacticalExprContext
  ): "SELF" | "OPPONENT" | "UNKNOWN" {
    if (!targetSpec || typeof targetSpec !== "string") {
      return "UNKNOWN";
    }

    // "self" / "controller": リクエストの controller 自身
    if (targetSpec === "self" || targetSpec === "controller") {
      if (!context.request?.controller) return "UNKNOWN";
      return context.request.controller === context.viewerPlayerId ? "SELF" : "OPPONENT";
    }

    // "opponent": リクエストの controller の対戦相手
    if (targetSpec === "opponent") {
      if (!context.request?.controller) return "UNKNOWN";
      return context.request.controller === context.viewerPlayerId ? "OPPONENT" : "SELF";
    }

    // "targetPlayer": 明示的にプレイヤー対象が解決できている場合のみ
    if (targetSpec === "targetPlayer") {
      if (!context.targetPlayerKey) return "UNKNOWN";
      return context.targetPlayerKey === context.viewerPlayerId ? "SELF" : "OPPONENT";
    }

    // "targetOwner": 対象ユニットの所有者、または対象プレイヤー
    if (targetSpec === "targetOwner") {
      if (context.targetUnit) {
        const inSelf =
          (context.selfView?.field ?? []).some((u) => u.unitId === context.targetUnit?.unitId) ||
          (context.selfView?.trumps ?? []).some((u) => u.unitId === context.targetUnit?.unitId);
        if (inSelf) return "SELF";

        const inOpp =
          (context.oppView?.field ?? []).some((u) => u.unitId === context.targetUnit?.unitId) ||
          (context.oppView?.trumps ?? []).some((u) => u.unitId === context.targetUnit?.unitId);
        if (inOpp) return "OPPONENT";

        return "UNKNOWN";
      }
      if (context.targetPlayerKey) {
        return context.targetPlayerKey === context.viewerPlayerId ? "SELF" : "OPPONENT";
      }
      return "UNKNOWN";
    }

    // その他の動的バインディング (例: sourceEvent.payload.combat.attackerPlayerKey 等) は UNKNOWN
    return "UNKNOWN";
  }
}
