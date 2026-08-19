import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import { ActionRequest, ActionRequestTarget, RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../rules/CommandRegistry";
import { CostResolver } from "../rules/CostResolver";
import { ActionRequestValidator } from "../rules/ActionRequestValidator";

/**
 * 選択された LegalPattern の検証、復元、および ActionRequest の構築を行うクラス。
 */
export class PatternExecutor {
  private static validator = new ActionRequestValidator();
  private static costResolver = new CostResolver();

  /**
   * 【後方互換・単体テスト用ラッパー】
   * パターンを即座に解決まで実行します（コアフローでは GameSession / CoreFlowCoordinator を使用してください）。
   */
  static executeResponse(
    request: DecisionRequest,
    response: DecisionResponse,
    state: any,
    rulePackage: RulePackage,
    registry: CommandRegistry
  ): { actionRequest?: ActionRequest; context?: CommandContext } {
    // 1. レスポンスの検証
    this.validateResponse(request, response);

    const pattern = request.patterns[response.selectedPatternRef];
    if (pattern.kind === "PASS") {
      return {};
    }
    return this.executePattern(pattern, request, state, rulePackage, registry);
  }

  /**
   * 【後方互換・単体テスト用ラッパー】
   */
  static executePattern(
    pattern: LegalPattern,
    request: DecisionRequest,
    state: any,
    rulePackage: RulePackage,
    registry: CommandRegistry
  ): { actionRequest: ActionRequest; context: CommandContext } {
    // 1. リクエストの作成（ステージへ積載）
    const { actionRequest, context } = this.createRequestFromPattern(
      pattern,
      request,
      state,
      rulePackage,
      registry
    );

    // 2. ステージ上のトップリクエストを解決
    registry.resolveTopRequest(context);

    return { actionRequest, context };
  }

  /**
   * LegalPattern から ActionRequest を構築してステージに積載します（解決は行いません）。
   */
  static createRequestFromPattern(
    pattern: LegalPattern,
    request: DecisionRequest,
    state: any,
    rulePackage: RulePackage,
    registry: CommandRegistry
  ): { actionRequest: ActionRequest; context: CommandContext } {
    const catalog = request.catalog;

    // アクション定義の取得
    if (pattern.actionSelectionRef === undefined || !catalog.actions[pattern.actionSelectionRef]) {
      throw new Error(`不正なアクション参照です: ${pattern.actionSelectionRef}`);
    }
    const actionSelection = catalog.actions[pattern.actionSelectionRef];
    const actionDef = rulePackage.actions.find((a) => a.id === actionSelection.actionId);
    if (!actionDef) {
      throw new Error(`アクション定義が見つかりません: ${actionSelection.actionId}`);
    }

    // キーカードの復元
    const keyCards: any[] = [];
    if (pattern.keyCardSelectionRef !== undefined) {
      const cardSel = catalog.cardSelections[pattern.keyCardSelectionRef];
      if (cardSel && cardSel.cardIds.length > 0) {
        const player = state.players?.[request.playerId];
        if (player?.hand) {
          for (const cardId of cardSel.cardIds) {
            const card = player.hand.find((c: any) => c.id === cardId);
            if (card) keyCards.push(card);
          }
        }
      }
    }

    // コスト支払いの復元
    const costPayment = pattern.costPaymentRef !== undefined
      ? catalog.costPayments[pattern.costPaymentRef]
      : undefined;

    // 対象の復元
    let targetComponent: any = undefined;
    let targetPlayerKey: string | undefined = undefined;
    let targetRequest: any = undefined;
    const targetSel = pattern.targetSelectionRef !== undefined
      ? catalog.targetSelections[pattern.targetSelectionRef]
      : undefined;

    if (targetSel) {
      if (targetSel.targetType === "unit" && targetSel.targetUnitId) {
        for (const p of Object.values<any>(state.players || {})) {
          const u = p.field?.find((unit: any) => unit.unitId === targetSel.targetUnitId);
          if (u) {
            targetComponent = u;
            break;
          }
        }
      } else if (targetSel.targetType === "player" && targetSel.targetPlayerKey) {
        targetPlayerKey = targetSel.targetPlayerKey;
      } else if (targetSel.targetType === "request" && targetSel.targetRequestId) {
        targetRequest = state.stage?.requests?.find(
          (r: any) => r.id === targetSel.targetRequestId
        );
      }
    }

    const context: CommandContext = {
      state,
      playerKey: request.playerId,
      keyCards,
      keyCard: keyCards.length === 1 ? keyCards[0] : undefined,
      targetComponent,
      targetPlayerKey,
      targetRequest,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 実行直前の再バリデーション（validateActionRequest / canPaySelection は createRequest 内でも実行される）
    this.validator.validateActionRequest(actionDef, context);
    if (costPayment && !this.costResolver.canPaySelection(costPayment, context)) {
      throw new Error(`選択されたコストを支払うことができません: ${costPayment.summary}`);
    }

    // リクエストの生成とコスト支払い
    const actionRequest = registry.createRequest(actionDef, context, {
      selectedCostPayment: costPayment,
      sourcePatternId: pattern.patternId,
    });

    return { actionRequest, context };
  }

  /**
   * DecisionResponse の妥当性を検証
   */
  static validateResponse(
    request: DecisionRequest,
    response: DecisionResponse,
    currentStateVersion?: number
  ): void {
    if (response.decisionId !== request.decisionId) {
      throw new Error(
        `Decision ID が一致しません。要求: ${request.decisionId}, 回答: ${response.decisionId}`
      );
    }
    if (response.stateVersion !== request.stateVersion) {
      throw new Error(
        `State Version が一致しません。要求: ${request.stateVersion}, 回答: ${response.stateVersion}`
      );
    }
    if (currentStateVersion !== undefined && response.stateVersion !== currentStateVersion) {
      throw new Error(
        `State Version が現在の盤面状態と一致しません。現在: ${currentStateVersion}, 回答: ${response.stateVersion}`
      );
    }
    if (
      response.selectedPatternRef < 0 ||
      response.selectedPatternRef >= request.patterns.length
    ) {
      throw new Error(
        `selectedPatternRef が範囲外です。インデックス: ${response.selectedPatternRef}, 有効範囲: 0..${
          request.patterns.length - 1
        }`
      );
    }
  }
}
