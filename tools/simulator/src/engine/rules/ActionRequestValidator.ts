import { CommandContext } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { CostResolver } from "./CostResolver";
import { matchesSuit, rankToValue, matchesRank, normalizeSuit } from "./cardUtils";
import { getCharacterType } from "./characterUtils";
import {
  evaluateUnitTargetCondition,
  evaluateRequestTargetCondition,
  evaluatePlayerTargetCondition,
} from "./targetConditionUtils";

/**
 * バリデーションエラーを表すカスタム例外クラス
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
    // TypeScriptでの例外クラス継承のためのボイラープレート
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * 複数キーカード条件の重複のないマッチング (二部マッチングを全順列でシンプルに解決)
 */
function matchConditions(cards: any[], conditions: any[]): boolean {
  if (cards.length !== conditions.length) return false;
  
  const indices = Array.from({ length: cards.length }, (_, i) => i);
  const permutations = getPermutations(indices);
  
  for (const perm of permutations) {
    let allMatch = true;
    for (let i = 0; i < conditions.length; i++) {
      const card = cards[perm[i]];
      const cond = conditions[i].card;
      if (!cond) {
        allMatch = false;
        break;
      }
      
      if (!matchesSuit(card.suit, cond.suit) || !matchesRank(card.rank, card.value || 0, cond.rank)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  
  return false;
}

/**
 * 配列の全順列を生成
 */
function getPermutations(arr: number[]): number[][] {
  if (arr.length <= 1) return [arr];
  const result: number[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const subPerms = getPermutations(rest);
    for (const p of subPerms) {
      result.push([arr[i], ...p]);
    }
  }
  return result;
}

/**
 * リクエスト時のキーカード条件・対象条件を検証するバリデータークラス。
 */
export class ActionRequestValidator {
  private expressionEvaluator = new ExpressionEvaluator();

  /**
   * アクションリクエストを事前検証します。不正な場合は ValidationError をスローします。
   */
  validateActionRequest(action: any, context: CommandContext): void {
    if (!action) {
      throw new ValidationError("アクションが指定されていません。");
    }

    // 0.1. アクション使用タイミング (timing) の検証（直接リクエスト時のみ）
    const isTriggered = context.triggered || action.type === "triggered" || action.request?.trigger === "triggered";
    if (!isTriggered && action.request && action.request.timing) {
      const state = context.state;
      if (state && state.turnPlayer !== undefined && state.chancePlayer !== undefined) {
        const timing = action.request.timing;
        const requester = context.playerKey;
        const stageRequests = state.stage?.requests || [];
        const isStageEmpty = stageRequests.length === 0;

        if (timing === "main") {
          if (requester !== state.turnPlayer || requester !== state.chancePlayer || !isStageEmpty) {
            throw new ValidationError(
              `メインタイミングのアクションは手番かつチャンス所持かつステージが空である必要があります。現在: turnPlayer=${state.turnPlayer}, chancePlayer=${state.chancePlayer}, requester=${requester}, stageEmpty=${isStageEmpty}`
            );
          }
        } else if (timing === "quick") {
          if (requester !== state.chancePlayer) {
            throw new ValidationError(
              `クイックタイミングのアクションはチャンスを所持している必要があります。現在: chancePlayer=${state.chancePlayer}, requester=${requester}`
            );
          }
        }
      }
    }

    // 0.1 使用回数制限 (usageLimit) の検証
    if (action.request?.usageLimit) {
      const { scope = "turn", max = 1 } = action.request.usageLimit;
      const state = context.state;
      if (scope === "turn" && state) {
        const usedCount = state.turnUsage?.[context.playerKey]?.[action.id] || 0;
        if (usedCount >= max) {
          throw new ValidationError(
            `アクション '${action.id}' はこのターンすでに上限回数 (${max}回) 使用されています。`
          );
        }
      }
    }

    // 0.1.1 ブロックアクション (action.block) の検証
    if (action.id === "action.block") {
      const state = context.state;
      const requester = context.playerKey;
      // ブロッカー指定時（targetComponent 指定時）または直接リクエスト時はアタッカー存在を厳格検証
      if (context.targetComponent || !context.triggered) {
        let hasValidOpponentAttacker = false;
        if (state && state.players) {
          for (const [pKey, p] of Object.entries<any>(state.players)) {
            if (pKey === requester) continue; // 自分のユニットは除外
            if (p.field?.some((u: any) => u.battle?.role === "attacker" && (u.battle?.targetPlayerKey === requester || !u.battle?.targetPlayerKey))) {
              hasValidOpponentAttacker = true;
              break;
            }
          }
        }
        if (!hasValidOpponentAttacker) {
          throw new ValidationError(
            `自分を攻撃している相手のアタッカーが存在しないため、ブロックできません。`
          );
        }
      }
    }



    // 0.2. リクエスト速度 (speed) の検証
    if (action.request && action.request.speed) {
      if (action.id === "action.twist" && action.request.speed !== "normal") {
        throw new ValidationError("ツイストのリクエスト速度は通常である必要があります。");
      }
    }

    // 0.5. コスト (cost) の事前検証
    if (action.cost) {
      const costResolver = new CostResolver();
      if (!costResolver.canPay(action.cost, context)) {
        throw new ValidationError(`コスト [${action.cost}] を支払うことができません。`);
      }
    }

    // 1. キーカード (key) のバリデーション
    if (action.key) {
      const keyDef = action.key;
      const expectedCount = keyDef.count !== undefined ? keyDef.count : 1;
      
      // keyCards または keyCard から実際の投入カードをリスト化
      const actualCards = context.keyCards && context.keyCards.length > 0
        ? context.keyCards
        : context.keyCard ? [context.keyCard] : [];

      // 枚数の検証
      if (actualCards.length !== expectedCount) {
        throw new ValidationError(
          `キーカードの枚数が一致しません。要求: ${expectedCount}枚, 実際: ${actualCards.length}枚`
        );
      }

      // 条件の検証
      if (keyDef.conditions && Array.isArray(keyDef.conditions)) {
        if (!matchConditions(actualCards, keyDef.conditions)) {
          throw new ValidationError("キーカードが要求される複数条件を満たしていません。");
        }
      } else if (keyDef.condition) {
        const cond = keyDef.condition.card;
        if (cond) {
          const card = actualCards[0];
          if (!card) {
            throw new ValidationError("キーカードが存在しません。");
          }
          if (!matchesSuit(card.suit, cond.suit) || !matchesRank(card.rank, card.value || 0, cond.rank)) {
            throw new ValidationError("キーカードが要求される条件を満たしていません。");
          }
        }
      }
    }

    // 2. 対象 (targets) のバリデーション
    // context.triggered === true の場合、リクエスト時点では未確定の targets 検証をバイパスする。
    // （効果解決時に必要な盤面整合性は各 command handler で検証する）
    if (!context.triggered && action.targets && Array.isArray(action.targets)) {
      for (const targetDef of action.targets) {
        const cond = targetDef.condition;
        let targetType = targetDef.type || (cond ? cond.type : undefined);
        if (!targetType && (cond?.component || cond?.componentType || targetDef.id === "target")) {
          targetType = "unit";
        }

        if (targetType === "player") {
          if (!cond) continue;
          // プレイヤーターゲットの検証
          if (!context.targetPlayerKey) {
            throw new ValidationError("ターゲットとなるプレイヤーが指定されていません。");
          }
          const res = evaluatePlayerTargetCondition(context.targetPlayerKey, cond, {
            requesterPlayerKey: context.playerKey,
          });
          if (!res.isValid) {
            throw new ValidationError(res.detail || "ターゲットプレイヤーの条件が不適合です。");
          }
        } else if (targetType === "request") {
          // リクエストターゲットの検証
          const targetReq = context.targetRequest;
          if (!targetReq) {
            throw new ValidationError("ターゲットとなるリクエストが指定されていません。");
          }
          const res = evaluateRequestTargetCondition(targetReq, cond, {
            currentRequestId: context.currentRequest?.id,
          });
          if (!res.isValid) {
            throw new ValidationError(res.detail || "ターゲットリクエストの条件が不適合です。");
          }
          if (context.currentRequest && targetReq.id === context.currentRequest.id) {
            throw new ValidationError("自分自身のリクエストを対象にすることはできません。");
          }
          const stageReqs = context.state.stage?.requests || [];
          const exists = stageReqs.some((r: any) => r.id === targetReq.id);
          if (!exists) {
            throw new ValidationError(
              `ターゲットリクエスト ${targetReq.id} はステージ上に存在しません。`
            );
          }
        } else if (targetType === "unit") {
          // ツイストを含むユニットターゲットの検証
          if (cond) {
            if (!context.targetComponent) {
              throw new ValidationError("ターゲットとなるコンポーネントが指定されていません。");
            }

            // アタックアクション固有の検証 (アタッカーの所有とチャージ状態)
            if (action.id === "action.attack") {
              const player = context.state.players[context.playerKey];
              const exists = player?.field?.some((u: any) => u.unitId === context.targetComponent.unitId);
              if (!exists) {
                throw new ValidationError("アタッカーは自分のフィールドに存在するユニットである必要があります。");
              }

              if (context.targetComponent.state !== "charge") {
                throw new ValidationError(`ドライブ状態のキャラクターはアタッカーに指定できません。現在: ${context.targetComponent.state}`);
              }
            }

            // ブロックアクション固有の検証 (ブロッカーの条件)
            if (action.id === "action.block") {
              const player = context.state.players[context.playerKey];
              const exists = player?.field?.some((u: any) => u.unitId === context.targetComponent.unitId);
              if (!exists) {
                throw new ValidationError("ブロッカーは自分のフィールドに存在するユニットである必要があります。");
              }

              if (context.targetComponent.state !== "charge") {
                throw new ValidationError(`ドライブ状態のキャラクターはブロッカーに指定できません。現在: ${context.targetComponent.state}`);
              }

              // 防御ラベルを持っていることの検証
              const compId = context.targetComponent.componentId || "";
              const compDef = context.components?.find((c: any) => c.id === compId);
              const labels = (compDef as any)?.labels || context.targetComponent.labels || [];
              const hasDefenseLabel = labels.includes("防御") || labels.includes("defense");
              if (!hasDefenseLabel) {
                throw new ValidationError("防御ラベルを持たないキャラクターはブロッカーに指定できません。");
              }
            }

            let unitOwnerKey: string | undefined;
            if (context.state?.players) {
              for (const [pKey, p] of Object.entries<any>(context.state.players)) {
                if (p.field?.some((u: any) => u.unitId === context.targetComponent.unitId)) {
                  unitOwnerKey = pKey;
                  break;
                }
              }
            }

            const res = evaluateUnitTargetCondition(context.targetComponent, cond, {
              components: context.components,
              keyCard: context.keyCard || (context.keyCards && context.keyCards[0]),
              playerKey: context.playerKey,
              unitOwnerKey,
            });
            if (!res.isValid) {
              throw new ValidationError(res.detail || "ターゲットユニットの条件が不適合です。");
            }
          }
        }
      }
    }
  }
}
