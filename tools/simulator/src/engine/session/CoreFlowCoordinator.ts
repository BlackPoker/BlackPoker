import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PlayerKey, ChanceHolder, RULE_SYSTEM_CHANCE } from "../../domain/decision/DecisionSource";
import { RulePackage, ActionRequest } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../rules/CommandRegistry";
import { ValidationError } from "../rules/ActionRequestValidator";
import { PatternExecutor } from "../decision/PatternExecutor";
import { PassTracker } from "./PassTracker";

export type CoreFlowEvent =
  | {
      readonly type: "PASSED";
      readonly playerId: PlayerKey;
      readonly nextChancePlayerId: PlayerKey;
    }
  | {
      readonly type: "ALL_PASSED";
      readonly playerId: PlayerKey;
      readonly nextChancePlayerId: ChanceHolder;
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
 * BlackPoker 公式コアフロー（第9.2版：手番・チャンス・フォーカス・パス・ステージ解決）の進行を統括するコーディネーター。
 */
export class CoreFlowCoordinator {
  /**
   * 次のプレイヤーキーを取得（2人対戦デフォルト、ルールシステム "system" は除外）
   */
  static getNextPlayerKey(current: PlayerKey, state: any): PlayerKey {
    const playerKeys = Object.keys(state.players || {}).filter((k) => k !== RULE_SYSTEM_CHANCE);
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
    passTracker?: PassTracker
  ): CoreFlowEvent {
    PatternExecutor.validateResponse(request, response);

    const pattern = request.patterns[response.selectedPatternRef];
    const playerId = request.playerId;

    // 1. PASS の処理（コアフロー[3], [11], [12], [14]）
    if (pattern.kind === "PASS") {
      const stageRequests = state.stage?.requests || [];
      if (stageRequests.length === 0) {
        throw new ValidationError("ステージが空のためパスできません（公式ルール第9.2版 コアフロー[3]）。");
      }

      if (passTracker) {
        passTracker.recordPass();
      }

      const prevChance = state.chancePlayer;
      const nextPlayer = this.getNextPlayerKey(playerId, state);
      const focusPlayer: PlayerKey = state.focusPlayer || state.turnPlayer || "p1";

      if (registry.logRecorder) {
        registry.logRecorder.record({
          type: "player.passed",
          stateVersion: state.stateVersion ?? state.version ?? 1,
          playerId,
          passCount: passTracker ? passTracker.consecutivePassCount : 1,
        });
      }

      // [11] 全員パス判定: 次のプレイヤーがフォーカスを持っているか？
      if (nextPlayer === focusPlayer) {
        // [12] チャンスをルールシステムへ移動
        state.chancePlayer = RULE_SYSTEM_CHANCE;
        if (registry.logRecorder && prevChance !== RULE_SYSTEM_CHANCE) {
          registry.logRecorder.record({
            type: "chance.changed",
            stateVersion: state.stateVersion ?? state.version ?? 1,
            fromChancePlayer: prevChance,
            toChancePlayer: RULE_SYSTEM_CHANCE,
            reason: "allPassed",
          });
        }
        return {
          type: "ALL_PASSED",
          playerId,
          nextChancePlayerId: RULE_SYSTEM_CHANCE,
        };
      } else {
        // [14] チャンスを次のプレイヤーへ移動
        state.chancePlayer = nextPlayer;
        if (registry.logRecorder && prevChance !== nextPlayer) {
          registry.logRecorder.record({
            type: "chance.changed",
            stateVersion: state.stateVersion ?? state.version ?? 1,
            fromChancePlayer: prevChance,
            toChancePlayer: nextPlayer,
            reason: "pass",
          });
        }
        return {
          type: "PASSED",
          playerId,
          nextChancePlayerId: nextPlayer,
        };
      }
    }

    // 2. 通常 / 即時アクション（ACTION）の処理（コアフロー[4]〜[10]）
    if (passTracker) {
      passTracker.reset();
    }

    if (pattern.actionSelectionRef === undefined) {
      throw new Error(`アクションパターンに actionSelectionRef が存在しません: ${pattern.patternId}`);
    }

    const actionSelection = request.catalog.actions[pattern.actionSelectionRef];
    const actionDef = rulePackage.actions.find((a) => a.id === actionSelection.actionId);
    if (!actionDef) {
      throw new Error(`アクション定義が見つかりません: ${actionSelection.actionId}`);
    }

    const isImmediate = actionDef.request?.speed === "immediate";

    // リクエストの生成とステージへの積載（[4], [9]）
    const { actionRequest, context } = PatternExecutor.createRequestFromPattern(
      pattern,
      request,
      state,
      rulePackage,
      registry
    );

    if (isImmediate) {
      // [7] 即時アクション: stage を経由せず直接解決。チャンスは現在のプレイヤーが維持
      const resolveResult = registry.resolveRequest(actionRequest, context);
      if (resolveResult.type === "WAITING_FOR_DECISION") {
        // 解決途中でプレイヤー判断が必要になったため中断（[10] フォーカス設定は解決・誘発チェック完了後に行う）
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
      // [9] 通常アクション: stage に残す（未解決）。チャンスは現在のプレイヤーが維持
      return {
        type: "NORMAL_ACTION_QUEUED",
        playerId,
        actionRequest,
      };
    }
  }

  /**
   * ステージ最上段（トップ）のアクションを1件だけ解決します（コアフロー[13]）。
   *
   * 発動条件:
   * - state.chancePlayer === RULE_SYSTEM_CHANCE ("system")（全員パスによりルールシステムがチャンスを所持）
   * ※旧PassTracker.isAllPassed() による解決開始は完全廃止（第9.2版フォーカス方式へ統一）。
   *
   * options.deferChanceReturnToStep2 が true の場合（GameSession.advance からの呼び出し時）、
   * 解決完了時点では state.chancePlayer を "system" のまま維持し、誘発チェック[5]完了後のコアフロー[2]にて
   * チャンスとフォーカスをターンプレイヤーへ移動させます。
   */
  static tryResolveStageTop(
    state: any,
    rulePackage: RulePackage,
    registry: CommandRegistry,
    passTracker?: PassTracker,
    playerCount?: number | { deferChanceReturnToStep2?: boolean },
    options?: { deferChanceReturnToStep2?: boolean }
  ): CoreFlowEvent | null {
    // 引数正規化 (第5引数に options が渡された場合に対応)
    const resolvedOptions =
      typeof playerCount === "object" && playerCount !== null
        ? playerCount
        : options;

    // ステージ解決の開始条件は chancePlayer === "system"（ルールシステムがチャンスを所持）
    if (state.chancePlayer !== RULE_SYSTEM_CHANCE) {
      return null; // 全員パス未成立（ルールシステムがチャンスを所持していない）
    }

    if (passTracker) {
      passTracker.reset();
    }

    const stageRequests = state.stage?.requests;
    const hasStageRequests = Array.isArray(stageRequests) && stageRequests.length > 0;

    if (hasStageRequests) {
      const topReq = stageRequests[stageRequests.length - 1];
      // ステージ最上段（最新）を 1 件だけ解決
      const context: CommandContext = {
        state,
        playerKey: topReq.controller || state.turnPlayer || "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      const resolveResult = registry.resolveTopRequest(context);
      if (!resolveResult) {
        return null;
      }

      if (resolveResult.type === "WAITING_FOR_DECISION") {
        // 効果解決中に判断が必要になったため中断（state.chancePlayer === "system" を維持）
        return {
          type: "STAGE_RESOLUTION_INTERRUPTED",
          actionRequest: resolveResult.request,
          decisionRequest: resolveResult.decisionRequest,
          continuation: resolveResult.continuation,
          context: resolveResult.context!,
        };
      }

      const turnPlayer: PlayerKey = state.turnPlayer || "p1";

      // 単体テスト等（GameSession外）から直接呼ばれた場合は、ここで[2]相当のチャンス・フォーカス移動を行う
      if (!resolvedOptions?.deferChanceReturnToStep2) {
        const prevChance = state.chancePlayer;
        const prevFocus = state.focusPlayer;
        state.chancePlayer = turnPlayer;
        state.focusPlayer = turnPlayer;
        if (registry.logRecorder && prevChance && prevChance !== turnPlayer) {
          registry.logRecorder.record({
            type: "chance.changed",
            stateVersion: state.stateVersion ?? state.version ?? 1,
            fromChancePlayer: prevChance,
            toChancePlayer: turnPlayer,
            reason: "stageTopResolved",
          });
        }
        if (registry.logRecorder && prevFocus && prevFocus !== turnPlayer) {
          registry.logRecorder.record({
            type: "focus.changed",
            stateVersion: state.stateVersion ?? state.version ?? 1,
            fromFocusPlayer: prevFocus,
            toFocusPlayer: turnPlayer,
            reason: "stageTopResolved",
          });
        }
      }

      return {
        type: "STAGE_TOP_RESOLVED",
        actionRequest: resolveResult.request,
        nextChancePlayerId: turnPlayer,
      };
    } else {
      // ステージが空の場合、ルールシステムが保持しているチャンスを[2]相当で返却
      if (!resolvedOptions?.deferChanceReturnToStep2) {
        const prevChance = state.chancePlayer;
        const prevFocus = state.focusPlayer;
        const turnPlayer: PlayerKey = state.turnPlayer || "p1";
        state.chancePlayer = turnPlayer;
        state.focusPlayer = turnPlayer;
        if (registry.logRecorder && prevChance && prevChance !== turnPlayer) {
          registry.logRecorder.record({
            type: "chance.changed",
            stateVersion: state.stateVersion ?? state.version ?? 1,
            fromChancePlayer: prevChance,
            toChancePlayer: turnPlayer,
            reason: "allPassedStageEmpty",
          });
        }
        if (registry.logRecorder && prevFocus && prevFocus !== turnPlayer) {
          registry.logRecorder.record({
            type: "focus.changed",
            stateVersion: state.stateVersion ?? state.version ?? 1,
            fromFocusPlayer: prevFocus,
            toFocusPlayer: turnPlayer,
            reason: "stageEmpty",
          });
        }
      }
      return null;
    }
  }
}
