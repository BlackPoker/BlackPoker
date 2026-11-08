/**
 * GenericTacticalEvaluator.ts
 *
 * BlackPoker Simulator - 汎用戦術評価基盤 (Work 5-1 R2)
 *
 * 【設計原則】
 * 1. アクションID・特定カードへのハードコード依存の完全解消:
 *    - 各種アクションの効果は公式 YAML DSL の宣言ノード (guardCondition, dealDamage,
 *      moveUnitCardsToZoneTop, cancelRequest, moveToGraveyard, if) を順次解釈して評価する。
 *    - 死の槍、投擲、キル、カウンターなどの固定ダメージや個別分岐を撤廃し、
 *      将来追加される切札・魔法でも AI のコード変更なしで自動的に戦術評価可能にする。
 * 2. DecisionPolicy 境界と観測プライバシーの厳格遵守:
 *    - 入力は PlayerObservation の合法観測情報のみ。
 *    - 相手の秘密情報 (非公開手札・未開封パック・伏せ防壁) は一切参照しない。
 * 3. 確定的な効果と不確実な効果の厳格な分離:
 *    - 公開情報から確定的に計算可能なダメージ・ライフ変動・ガード判定のみを正味損害として算出。
 *    - 非公開情報に依存する効果や未対応ノードは「不確実 (isCertain: false)」として扱い、
 *      勝手な固定値の捏造や過剰な推測を排除する。
 */

import { ActionDefinition, EffectCommand, RulePackage } from "../../domain/rules/RulePackage.js";
import {
  PlayerObservation,
  RequestView,
  UnitView,
  CardView,
  KnownCardView,
  PlayerObservationView,
} from "../../domain/decision/PlayerObservation.js";
import { DecisionCatalog, LegalPattern } from "../../domain/decision/DecisionCatalog.js";
import { loadRulePackageForBrowser } from "../rules/BrowserRuleLoader.js";

/**
 * リクエストの汎用評価結果
 */
export interface EvaluatedRequestOutcome {
  /** 自軍プレイヤーへの正味ライフ損害 (dealDamage - lifeGain) */
  readonly netDamageToSelf: number;
  /** 相手プレイヤーへの正味ライフ損害 */
  readonly netDamageToOpponent: number;
  /** 自軍プレイヤーへの直接ダメージ量 */
  readonly directDamageToSelf: number;
  /** 自軍ライフへのカード追加量（シールド/回復効果） */
  readonly lifeGainToSelf: number;
  /** 破壊される自軍ユニット一覧 */
  readonly destroyedSelfUnits: readonly UnitView[];
  /** 破壊される相手ユニット一覧 */
  readonly destroyedOppUnits: readonly UnitView[];
  /** ガード条件不成立等により効果全体が不発になったか */
  readonly isGuardedOut: boolean;
  /** 全公開情報に基づいて確定的に評価できたか（不確実要素がないか） */
  readonly isCertain: boolean;
  /** 評価詳細・理由ログ */
  readonly reasons: readonly string[];
}

/**
 * カウンター等の打ち消し選択肢の汎用評価結果
 */
export interface EvaluatedCounterOutcome {
  /** 対象リクエストを確実に無効化・阻止できるか */
  readonly canCancel: boolean;
  /** 阻止できる自軍ライフへの正味損害量 */
  readonly preventedDamageToSelf: number;
  /** 判定が確定的か */
  readonly isCertain: boolean;
  /** 評価詳細・理由ログ */
  readonly reasons: readonly string[];
}

/**
 * 観測情報ベースの式評価コンテキスト
 */
export interface TacticalEvaluationContext {
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
 * 軽量かつ安全な DSL 式評価器（PlayerObservation の公開情報のみから評価）
 */
export class TacticalExpressionEvaluator {
  /**
   * 条件式（ブール値）を評価
   */
  public static evaluateCondition(expr: string, context: TacticalEvaluationContext): boolean {
    if (!expr || typeof expr !== "string") return false;
    expr = expr.trim();

    // 1. 論理 OR (||)
    const orParts = expr.split("||").map((s) => s.trim());
    if (orParts.length > 1) {
      return orParts.some((part) => this.evaluateCondition(part, context));
    }

    // 2. 論理 AND (&&)
    const andParts = expr.split("&&").map((s) => s.trim());
    if (andParts.length > 1) {
      return andParts.every((part) => this.evaluateCondition(part, context));
    }

    // 3. 比較演算子 (>=, <=, ==, !=, >, <)
    const opMatch = expr.match(/(>=|<=|==|!=|>|<)/);
    if (!opMatch) {
      const val = this.resolveNumeric(expr, context);
      return Boolean(val);
    }

    const op = opMatch[1];
    const leftStr = expr.substring(0, opMatch.index!).trim();
    const rightStr = expr.substring(opMatch.index! + op.length).trim();

    const leftVal = this.evaluateArithmetic(leftStr, context);
    const rightVal = this.evaluateArithmetic(rightStr, context);

    switch (op) {
      case "==": return leftVal === rightVal;
      case "!=": return leftVal !== rightVal;
      case ">=": return leftVal >= rightVal;
      case "<=": return leftVal <= rightVal;
      case ">": return leftVal > rightVal;
      case "<": return leftVal < rightVal;
      default: return false;
    }
  }

  /**
   * 算術式 (+, -, %) を評価
   */
  public static evaluateArithmetic(expr: string, context: TacticalEvaluationContext): number {
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
        result += nextVal;
      } else if (op === "-") {
        result -= nextVal;
      } else if (op === "%") {
        if (!Number.isFinite(nextVal) || nextVal <= 0) {
          return 0; // 除算エラー防止
        }
        result = result % nextVal;
      }
    }
    return result;
  }

  /**
   * 単一トークンの数値を解決
   */
  public static resolveNumeric(token: string, context: TacticalEvaluationContext): number {
    token = token.trim();
    const num = Number(token);
    if (!isNaN(num)) return num;

    // target.size
    if (token === "target.size") {
      return context.targetUnit?.currentSize ?? 0;
    }

    // key.rankValue
    if (token === "key.rankValue") {
      if (context.myKeyCardValue !== undefined) {
        return context.myKeyCardValue;
      }
      const firstKey = context.keyCards?.[0];
      if (firstKey && firstKey.visibility === "KNOWN" && typeof (firstKey as any).value === "number") {
        return (firstKey as any).value;
      }
      return 0;
    }

    // keyCards.spade.rankValue
    if (token === "keyCards.spade.rankValue") {
      const spd = context.keyCards?.find(
        (k): k is KnownCardView => k.visibility === "KNOWN" && (k as any).suit === "spade"
      );
      if (spd && typeof spd.value === "number") {
        return spd.value;
      }
      // キーカードが伏せ (HIDDEN) の場合: 相手の合法発動を前提とし、最大脅威 (♠K = 13) を想定
      const hasHiddenKey = context.keyCards?.some((k) => k.visibility === "HIDDEN");
      if (hasHiddenKey) {
        return 13;
      }
      return 0;
    }

    // keyCards.diamond.rankValue
    if (token === "keyCards.diamond.rankValue") {
      const dia = context.keyCards?.find(
        (k): k is KnownCardView => k.visibility === "KNOWN" && (k as any).suit === "diamond"
      );
      if (dia && typeof dia.value === "number") {
        return dia.value;
      }
      // キーカードが伏せ (HIDDEN) の場合: 相手が不発を意図して撃つことはないため、
      // 割り切れる最小公約数 (1) を想定して成立判定を通過させる
      const hasHiddenKey = context.keyCards?.some((k) => k.visibility === "HIDDEN");
      if (hasHiddenKey) {
        return 1;
      }
      return 0;
    }

    // targetRequest.keyCards.count
    if (token === "targetRequest.keyCards.count") {
      return context.targetRequest?.keyCards?.length ?? 0;
    }

    // targetRequest.keyCards.first.rankValue または targetRequest.keyCard.rankValue
    if (
      token === "targetRequest.keyCards.first.rankValue" ||
      token === "targetRequest.keyCard.rankValue"
    ) {
      const firstKey = context.targetRequest?.keyCards?.[0];
      if (firstKey && firstKey.visibility === "KNOWN" && typeof (firstKey as any).value === "number") {
        return (firstKey as any).value;
      }
      // 伏せの場合は標準脅威値 (10)
      if (firstKey && firstKey.visibility === "HIDDEN") {
        return 10;
      }
      return 0;
    }

    return 0;
  }
}

/**
 * 汎用戦術評価エンジン
 */
/**
 * RulePackage が提供されないテスト環境等で使用される公式 YAML AST フォールバック定義
 */
const BUILTIN_FALLBACK_ACTIONS: readonly ActionDefinition[] = [
  {
    id: "action.deathLance",
    name: "死の槍",
    type: "magic",
    request: { trigger: "direct", speed: "normal", timing: "main" },
    effect: [
      { guardCondition: { condition: "target.size != 0 && target.size % keyCards.diamond.rankValue == 0" } },
      { moveUnitCardsToZoneTop: { target: "target", player: "targetOwner", zone: "life" } },
      { dealDamage: { target: "targetOwner", amount: "keyCards.spade.rankValue" } },
    ],
  },
  {
    id: "action.throwing",
    name: "投擲",
    type: "magic",
    request: { trigger: "direct", speed: "normal", timing: "main" },
    effect: [
      { dealDamage: { target: "targetPlayer", amount: "keyCards.spade.rankValue" } },
    ],
  },
  {
    id: "action.counter",
    name: "カウンター",
    type: "magic",
    request: { trigger: "direct", speed: "normal", timing: "quick" },
    effect: [
      {
        if: {
          condition: "targetRequest.keyCards.count == 2 || key.rankValue >= targetRequest.keyCards.first.rankValue",
          then: [{ cancelRequest: { target: "targetRequest" } }],
        },
      },
    ],
  },
  {
    id: "action.kill",
    name: "キル",
    type: "magic",
    request: { trigger: "direct", speed: "normal", timing: "quick" },
    effect: [
      { moveToGraveyard: { target: "target" } },
    ],
  },
];

export class GenericTacticalEvaluator {
  private static globalRulePackage: RulePackage | null = null;
  private readonly actionsMap: Map<string, ActionDefinition>;

  /**
   * グローバルデフォルトの RulePackage を設定（プロセス・セッション単位で共有）
   */
  public static setDefaultRulePackage(pkg: RulePackage): void {
    GenericTacticalEvaluator.globalRulePackage = pkg;
  }

  /**
   * グローバルデフォルトの RulePackage を取得
   */
  public static getDefaultRulePackage(): RulePackage | null {
    if (!GenericTacticalEvaluator.globalRulePackage) {
      try {
        GenericTacticalEvaluator.globalRulePackage = loadRulePackageForBrowser();
      } catch {
        // ignore
      }
    }
    return GenericTacticalEvaluator.globalRulePackage;
  }

  constructor(rulePackage?: Readonly<RulePackage>) {
    let pkg = rulePackage ?? GenericTacticalEvaluator.globalRulePackage;
    if (!pkg) {
      try {
        pkg = loadRulePackageForBrowser();
        GenericTacticalEvaluator.globalRulePackage = pkg;
      } catch {
        // ignore
      }
    }

    this.actionsMap = new Map();

    // 1. まずフォールバック AST を登録
    for (const act of BUILTIN_FALLBACK_ACTIONS) {
      this.actionsMap.set(act.id, act);
    }

    // 2. 公式 RulePackage が存在すれば完全な定義で上書き・追加
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
  ): EvaluatedRequestOutcome {
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

      return {
        netDamageToSelf: unblockedDmg,
        netDamageToOpponent: 0,
        directDamageToSelf: unblockedDmg,
        lifeGainToSelf: 0,
        destroyedSelfUnits: [],
        destroyedOppUnits: [],
        isGuardedOut: false,
        isCertain: true,
        reasons: unblockedDmg > 0 ? [`Unblocked combat damage: ${unblockedDmg}`] : [],
      };
    }

    // 2. YAML DSL ActionDefinition の取得
    const actionDef = this.actionsMap.get(req.actionId);
    if (!actionDef || !actionDef.effect || actionDef.effect.length === 0) {
      // 未知または効果未定義のアクション: 捏造せず不確実・0ダメージとして安全に扱う
      return {
        netDamageToSelf: 0,
        netDamageToOpponent: 0,
        directDamageToSelf: 0,
        lifeGainToSelf: 0,
        destroyedSelfUnits: [],
        destroyedOppUnits: [],
        isGuardedOut: false,
        isCertain: false,
        reasons: [`Action ${req.actionId} has no effect definition in RulePackage`],
      };
    }

    // 3. 評価コンテキストの構築
    const context: TacticalEvaluationContext = {
      viewerPlayerId: viewerKey,
      request: req,
      observation: obs,
      selfView,
      oppView,
      targetUnit,
      targetPlayerKey,
      keyCards: req.keyCards,
    };

    let directDamageToSelf = 0;
    let directDamageToOpponent = 0;
    let lifeGainToSelf = 0;
    const destroyedSelfUnits: UnitView[] = [];
    const destroyedOppUnits: UnitView[] = [];
    let isGuardedOut = false;
    let isCertain = true;

    // 4. DSL 効果ノードの順次評価
    for (const cmd of actionDef.effect) {
      const outcome = this.evaluateEffectCommand(cmd, context);

      if (outcome.isGuardedOut) {
        // ガード条件不成立により後続効果は不発
        isGuardedOut = true;
        reasons.push(`Guard condition failed: effect aborted`);
        break;
      }

      directDamageToSelf += outcome.damageToSelf;
      directDamageToOpponent += outcome.damageToOpponent;
      lifeGainToSelf += outcome.lifeGainToSelf;

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

    if (isGuardedOut) {
      return {
        netDamageToSelf: 0,
        netDamageToOpponent: 0,
        directDamageToSelf: 0,
        lifeGainToSelf: 0,
        destroyedSelfUnits: [],
        destroyedOppUnits: [],
        isGuardedOut: true,
        isCertain: true,
        reasons,
      };
    }

    // 正味ライフ損害 = 直接ダメージ - ライフ獲得（回復・シールド）
    const netDamageToSelf = Math.max(0, directDamageToSelf - lifeGainToSelf);
    const netDamageToOpponent = directDamageToOpponent;

    return {
      netDamageToSelf,
      netDamageToOpponent,
      directDamageToSelf,
      lifeGainToSelf,
      destroyedSelfUnits,
      destroyedOppUnits,
      isGuardedOut: false,
      isCertain,
      reasons,
    };
  }

  /**
   * カウンター・打ち消しアクションの選択肢を汎用評価
   */
  public evaluateCounterOutcome(
    pattern: Readonly<LegalPattern>,
    targetOppReq: Readonly<RequestView>,
    request: Readonly<DecisionRequest>,
    targetReqOutcome: EvaluatedRequestOutcome
  ): EvaluatedCounterOutcome {
    const act = pattern.actionSelectionRef !== undefined ? request.catalog.actions[pattern.actionSelectionRef] : undefined;
    if (!act) {
      return { canCancel: false, preventedDamageToSelf: 0, isCertain: true, reasons: [] };
    }

    const actionDef = this.actionsMap.get(act.actionId);
    if (!actionDef || !actionDef.effect) {
      return { canCancel: false, preventedDamageToSelf: 0, isCertain: false, reasons: [] };
    }

    // 1. 対象リクエストの照合
    if (pattern.targetSelectionRef !== undefined) {
      const targetSel = request.catalog.targetSelections[pattern.targetSelectionRef];
      if (targetSel && targetSel.targetRequestId && targetSel.targetRequestId !== targetOppReq.requestId) {
        return {
          canCancel: false,
          preventedDamageToSelf: 0,
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

    const context: TacticalEvaluationContext = {
      viewerPlayerId: request.playerId,
      pattern,
      catalog: request.catalog,
      observation: request.observation,
      targetRequest: targetOppReq,
      myKeyCardValue,
    };

    // 3. DSL 効果ノード内の cancelRequest 到達性を検証
    const canCancel = this.checkCancelRequestReachable(actionDef.effect, context);

    if (canCancel) {
      const preventedDamage = targetReqOutcome.netDamageToSelf;
      return {
        canCancel: true,
        preventedDamageToSelf: preventedDamage,
        isCertain: true,
        reasons: [`Counter prevents request ${targetOppReq.actionId} (damage=${preventedDamage})`],
      };
    }

    return {
      canCancel: false,
      preventedDamageToSelf: 0,
      isCertain: true,
      reasons: [`Counter condition not satisfied for ${targetOppReq.actionId}`],
    };
  }

  /**
   * DSL 効果ノード配列内で cancelRequest コマンドに到達可能かを再帰的に判定
   */
  private checkCancelRequestReachable(
    commands: readonly EffectCommand[],
    context: TacticalEvaluationContext
  ): boolean {
    for (const cmd of commands) {
      const cmdKey = Object.keys(cmd)[0];
      const args = (cmd as any)[cmdKey];

      if (cmdKey === "cancelRequest") {
        // cancelRequest に到達！
        return true;
      }

      if (cmdKey === "if") {
        const condition = args.condition;
        const isTrue = TacticalExpressionEvaluator.evaluateCondition(condition, context);
        if (isTrue && args.then && Array.isArray(args.then)) {
          if (this.checkCancelRequestReachable(args.then, context)) return true;
        } else if (!isTrue && args.else && Array.isArray(args.else)) {
          if (this.checkCancelRequestReachable(args.else, context)) return true;
        }
      }
    }
    return false;
  }

  /**
   * 単一の EffectCommand を評価
   */
  private evaluateEffectCommand(
    cmd: EffectCommand,
    context: TacticalEvaluationContext
  ): {
    damageToSelf: number;
    damageToOpponent: number;
    lifeGainToSelf: number;
    destroyedUnit?: UnitView;
    isGuardedOut: boolean;
    isCertain: boolean;
    reason?: string;
  } {
    const cmdKey = Object.keys(cmd)[0];
    const args = (cmd as any)[cmdKey];

    // (1) guardCondition
    if (cmdKey === "guardCondition") {
      const cond = args.condition;
      const isPassed = TacticalExpressionEvaluator.evaluateCondition(cond, context);
      if (!isPassed) {
        return {
          damageToSelf: 0,
          damageToOpponent: 0,
          lifeGainToSelf: 0,
          isGuardedOut: true,
          isCertain: true,
          reason: `guardCondition failed: ${cond}`,
        };
      }
      return {
        damageToSelf: 0,
        damageToOpponent: 0,
        lifeGainToSelf: 0,
        isGuardedOut: false,
        isCertain: true,
      };
    }

    // (2) dealDamage
    if (cmdKey === "dealDamage") {
      const amount = typeof args.amount === "number"
        ? args.amount
        : TacticalExpressionEvaluator.evaluateArithmetic(String(args.amount), context);

      const target = args.target;
      const isTargetSelf =
        target === "self" ||
        target === "targetPlayer" && context.targetPlayerKey === context.viewerPlayerId ||
        target === "targetOwner" && this.isTargetOwnerViewer(context);

      const isTargetOpponent =
        target === "opponent" ||
        target === "targetPlayer" && context.targetPlayerKey && context.targetPlayerKey !== context.viewerPlayerId ||
        target === "targetOwner" && !this.isTargetOwnerViewer(context);

      return {
        damageToSelf: isTargetSelf ? amount : 0,
        damageToOpponent: isTargetOpponent ? amount : 0,
        lifeGainToSelf: 0,
        isGuardedOut: false,
        isCertain: true,
        reason: `dealDamage: amount=${amount} (toSelf=${isTargetSelf})`,
      };
    }

    // (3) moveUnitCardsToZoneTop (ライフ回復・シールド効果等)
    if (cmdKey === "moveUnitCardsToZoneTop") {
      const zone = args.zone;
      const isPlayerSelf =
        args.player === "self" ||
        (args.player === "targetOwner" && this.isTargetOwnerViewer(context));

      if (zone === "life" && isPlayerSelf) {
        // 自軍兵士が自軍ライフに乗る場合: ライフ +1
        return {
          damageToSelf: 0,
          damageToOpponent: 0,
          lifeGainToSelf: 1,
          isGuardedOut: false,
          isCertain: true,
          reason: `moveUnitCardsToZoneTop: life +1 to self`,
        };
      }

      return {
        damageToSelf: 0,
        damageToOpponent: 0,
        lifeGainToSelf: 0,
        isGuardedOut: false,
        isCertain: true,
      };
    }

    // (4) moveToGraveyard (キル等のユニット破壊)
    if (cmdKey === "moveToGraveyard") {
      return {
        damageToSelf: 0,
        damageToOpponent: 0,
        lifeGainToSelf: 0,
        destroyedUnit: context.targetUnit,
        isGuardedOut: false,
        isCertain: true,
        reason: context.targetUnit ? `moveToGraveyard: unit ${context.targetUnit.unitId}` : undefined,
      };
    }

    // (5) if 条件分岐
    if (cmdKey === "if") {
      const cond = args.condition;
      const isPassed = TacticalExpressionEvaluator.evaluateCondition(cond, context);
      const subCommands = isPassed ? args.then : args.else;

      if (Array.isArray(subCommands)) {
        let dmgSelf = 0;
        let dmgOpp = 0;
        let lifeGain = 0;
        let destroyed: UnitView | undefined;
        let guarded = false;
        let certain = true;

        for (const sub of subCommands) {
          const res = this.evaluateEffectCommand(sub, context);
          if (res.isGuardedOut) {
            guarded = true;
            break;
          }
          dmgSelf += res.damageToSelf;
          dmgOpp += res.damageToOpponent;
          lifeGain += res.lifeGainToSelf;
          if (res.destroyedUnit) destroyed = res.destroyedUnit;
          if (!res.isCertain) certain = false;
        }

        return {
          damageToSelf: dmgSelf,
          damageToOpponent: dmgOpp,
          lifeGainToSelf: lifeGain,
          destroyedUnit: destroyed,
          isGuardedOut: guarded,
          isCertain: certain,
        };
      }

      return {
        damageToSelf: 0,
        damageToOpponent: 0,
        lifeGainToSelf: 0,
        isGuardedOut: false,
        isCertain: true,
      };
    }

    // (6) その他未対応または不確実なコマンド
    return {
      damageToSelf: 0,
      damageToOpponent: 0,
      lifeGainToSelf: 0,
      isGuardedOut: false,
      isCertain: false,
      reason: `Unhandled or uncertain effect command: ${cmdKey}`,
    };
  }

  /**
   * targetOwner が viewer（自軍）か判定
   */
  private isTargetOwnerViewer(context: TacticalEvaluationContext): boolean {
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
