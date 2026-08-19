import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { RulePackage, ActionRequest } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../rules/CommandRegistry";
import { PatternExecutor } from "../decision/PatternExecutor";
import { PassTracker } from "./PassTracker";

export type CoreFlowEvent =
  | {
      readonly type: "PASSED";
      readonly playerId: PlayerKey;
      readonly nextChancePlayerId: PlayerKey;
    }
  | {
      readonly type: "NORMAL_ACTION_QUEUED";
      readonly playerId: PlayerKey;
      readonly actionRequest: ActionRequest;
    }
  | {
      readonly type: "IMMEDIATE_ACTION_RESOLVED";
      readonly playerId: PlayerKey;
      readonly actionRequest: ActionRequest;
    }
  | {
      readonly type: "STAGE_TOP_RESOLVED";
      readonly actionRequest: ActionRequest;
      readonly nextChancePlayerId: PlayerKey;
    }
  | {
      readonly type: "STAGE_RESOLUTION_INTERRUPTED";
      readonly actionRequest: ActionRequest;
      readonly decisionRequest: DecisionRequest;
      readonly continuation: any;
      readonly context: CommandContext;
    };

/**
 * BlackPoker 公式コアフロー（手番・チャンス・パス・ステージ解決）の進行を統括するコーディネーター。
 */
export class CoreFlowCoordinator {
  /**
   * 次のプレイヤーキーを取得（2人対戦デフォルト）
   */
  static getNextPlayerKey(current: PlayerKey, state: any): PlayerKey {
    const playerKeys = Object.keys(state.players || {});
    if (playerKeys.length <= 1) return current;
    const currentIndex = playerKeys.indexOf(current);
    if (currentIndex === -1) return playerKeys[0];
    const nextIndex = (currentIndex + 1) % playerKeys.length;
    return playerKeys[nextIndex];
  }

  /**
   * プレイヤーからの DecisionResponse を適用し、コアフローを進めます。
   */
  static applyDecision(
    request: DecisionRequest,
    response: DecisionResponse,
    state: any,
    rulePackage: RulePackage,
    registry: CommandRegistry,
    passTracker: PassTracker
  ): CoreFlowEvent {
    PatternExecutor.validateResponse(request, response);

    const pattern = request.patterns[response.selectedPatternRef];
    const playerId = request.playerId;

    // 1. PASS の処理
    if (pattern.kind === "PASS") {
      passTracker.recordPass();
      const nextChance = this.getNextPlayerKey(playerId, state);
      state.chancePlayer = nextChance;

      return {
        type: "PASSED",
        playerId,
        nextChancePlayerId: nextChance,
      };
    }

    // 2. 通常 / 即時アクション（ACTION）の処理
    passTracker.reset(); // 新しいアクションが積まれたため連続PASS状態をリセット

    if (pattern.actionSelectionRef === undefined) {
      throw new Error(`アクションパターンに actionSelectionRef が存在しません: ${pattern.patternId}`);
    }

    const actionSelection = request.catalog.actions[pattern.actionSelectionRef];
    const actionDef = rulePackage.actions.find((a) => a.id === actionSelection.actionId);
    if (!actionDef) {
      throw new Error(`アクション定義が見つかりません: ${actionSelection.actionId}`);
    }

    const isImmediate = actionDef.request?.speed === "immediate";

    // リクエストの生成とステージへの積載
    const { actionRequest, context } = PatternExecutor.createRequestFromPattern(
      pattern,
      request,
      state,
      rulePackage,
      registry
    );

    if (isImmediate) {
      // 即時アクション: stage を経由せず直接解決。チャンスは現在のプレイヤーが維持
      const resolveResult = registry.resolveRequest(actionRequest, context);
      if (resolveResult.type === "WAITING_FOR_DECISION") {
        return {
          type: "STAGE_RESOLUTION_INTERRUPTED",
          actionRequest,
          decisionRequest: resolveResult.decisionRequest,
          continuation: resolveResult.continuation,
          context: resolveResult.context!,
        };
      }
      return {
        type: "IMMEDIATE_ACTION_RESOLVED",
        playerId,
        actionRequest,
      };
    } else {
      // 通常アクション: stage に残す（未解決）。チャンスは現在のプレイヤーが維持
      return {
        type: "NORMAL_ACTION_QUEUED",
        playerId,
        actionRequest,
      };
    }
  }

  /**
   * 全員連続PASSが成立している場合、ステージ最上段（トップ）を1件だけ解決します。
   */
  static tryResolveStageTop(
    state: any,
    rulePackage: RulePackage,
    registry: CommandRegistry,
    passTracker: PassTracker,
    playerCount: number = 2
  ): CoreFlowEvent | null {
    if (!passTracker.isAllPassed(playerCount)) {
      return null; // 全員連続PASS未成立
    }

    // 全員連続PASS成立時の処理
    passTracker.reset();

    const stageRequests = state.stage?.requests;
    if (stageRequests && stageRequests.length > 0) {
      // ステージ最上段を 1 件だけ解決
      const context: CommandContext = {
        state,
        playerKey: state.chancePlayer || state.turnPlayer || "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      let resolveResult: any;
      try {
        resolveResult = registry.resolveTopRequest(context);
      } catch (err: any) {
        // コスト支払い不能等でキャンセルされた場合
        const turnPlayer: PlayerKey = state.turnPlayer || "p1";
        state.chancePlayer = turnPlayer;
        return {
          type: "STAGE_TOP_RESOLVED",
          actionRequest: stageRequests[0],
          nextChancePlayerId: turnPlayer,
        };
      }

      if (!resolveResult) {
        return null;
      }

      if (resolveResult.type === "WAITING_FOR_DECISION") {
        // 効果解決中に判断が必要になったため中断
        return {
          type: "STAGE_RESOLUTION_INTERRUPTED",
          actionRequest: resolveResult.request,
          decisionRequest: resolveResult.decisionRequest,
          continuation: resolveResult.continuation,
          context: resolveResult.context!,
        };
      }

      // 解決後、チャンスを手番プレイヤー (turnPlayer) へ戻す
      const turnPlayer: PlayerKey = state.turnPlayer || "p1";
      state.chancePlayer = turnPlayer;

      return {
        type: "STAGE_TOP_RESOLVED",
        actionRequest: resolveResult.request,
        nextChancePlayerId: turnPlayer,
      };
    } else {
      // stage が空の状態で全員連続PASSした場合、チャンスを turnPlayer へ戻す
      const turnPlayer: PlayerKey = state.turnPlayer || "p1";
      state.chancePlayer = turnPlayer;
      return null;
    }
  }
}
