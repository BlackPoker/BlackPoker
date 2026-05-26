import { CommandContext } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { CostResolver } from "./CostResolver";

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
 * スートが一致するかどうかを検証
 */
function matchesSuit(cardSuit: string, expectedSuit: string): boolean {
  if (!expectedSuit) return true;
  const cs = cardSuit.toLowerCase();
  const es = expectedSuit.toLowerCase();
  if (cs === es) return true;
  if (es === "spade" && cs === "s") return true;
  if (es === "club" && cs === "c") return true;
  if (es === "heart" && cs === "h") return true;
  if (es === "diamond" && cs === "d") return true;
  if (es === "joker" && cs === "x") return true;
  return false;
}

/**
 * ランクを数値にマッピング
 */
function rankToValue(rank: string): number {
  const r = rank.toUpperCase();
  if (r === "A") return 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  if (r === "JOKER") return 0;
  const num = parseInt(r, 10);
  if (!isNaN(num)) return num;
  return 0;
}

/**
 * ランクが一致するかどうかを検証 (範囲指定 "A..K" などのパースに対応)
 */
function matchesRank(cardRank: string, cardValue: number, expectedRank: any): boolean {
  if (!expectedRank) return true;
  
  if (Array.isArray(expectedRank)) {
    return expectedRank.some((r) => r.toLowerCase() === cardRank.toLowerCase());
  }
  
  if (typeof expectedRank === "string") {
    if (expectedRank.includes("..")) {
      const [start, end] = expectedRank.split("..");
      const startVal = rankToValue(start);
      const endVal = rankToValue(end);
      return cardValue >= startVal && cardValue <= endVal;
    } else {
      return cardRank.toLowerCase() === expectedRank.toLowerCase();
    }
  }
  
  return false;
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

    // 0.1. アクション使用タイミング (timing) の検証
    if (action.request && action.request.timing) {
      const state = context.state;
      if (state && state.phase) {
        const timing = action.request.timing;
        const phase = state.phase;

        if (timing === "main") {
          if (phase !== "main") {
            throw new ValidationError(
              `メインタイミングのアクションはメインフェーズでのみ使用可能です。現在: ${phase}`
            );
          }
        } else if (timing === "quick") {
          // クイックアクションは Phase 12 では仮仕様とし、draw / main / end フェーズ等で広く仮許可する
          const allowedPhases = ["draw", "main", "end"];
          if (!allowedPhases.includes(phase)) {
            throw new ValidationError(
              `クイックタイミングのアクションは不正なフェーズで使用されました。現在: ${phase}`
            );
          }
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
    if (action.targets && Array.isArray(action.targets)) {
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
          if (cond.relation === "opponent") {
            if (context.playerKey === context.targetPlayerKey) {
              throw new ValidationError("ターゲットプレイヤーは対戦相手である必要があります。");
            }
          }
        } else if (targetType === "request") {
          // リクエストターゲットの検証
          const targetReq = context.targetRequest;
          if (!targetReq) {
            throw new ValidationError("ターゲットとなるリクエストが指定されていません。");
          }
          if (cond && cond.status && targetReq.status !== cond.status) {
            throw new ValidationError(
              `ターゲットリクエストのステータスが不適合です。期待: ${cond.status}, 実際: ${targetReq.status}`
            );
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
          if (cond && cond.hasTarget) {
            if (!targetReq.targets || targetReq.targets.length === 0) {
              throw new ValidationError(
                `ターゲットリクエスト ${targetReq.id} は変更可能なターゲットを持っていません。`
              );
            }
          }
        } else if (targetType === "unit") {
          // ツイストを含むユニットターゲットの検証
          if (cond) {
            if (!context.targetComponent) {
              throw new ValidationError("ターゲットとなるコンポーネントが指定されていません。");
            }

            // キャラクタータイプの検証 (ツイストなど)
            if (cond.componentType === "character") {
              const compId = context.targetComponent.componentId || "";
              const compDef = context.components?.find((c: any) => c.id === compId);

              // 優先判定: ComponentDefinition.type === "character"
              // フォールバック: componentId.startsWith("character.")
              const isCharacter = compDef
                ? compDef.type === "character"
                : compId.startsWith("character.");

              if (!isCharacter) {
                throw new ValidationError("ターゲットがキャラクターではありません。");
              }

              // 状態の検証 (charge または drive であること)
              const unitState = context.targetComponent.state;
              if (unitState !== "charge" && unitState !== "drive") {
                throw new ValidationError(
                  `ターゲットユニットの状態が不適合です。期待: charge または drive, 実際: ${unitState}`
                );
              }
            }

            // 既存のコンポーネントターゲット検証 (cond.component がある場合)
            if (cond.component) {
              const isMatch = this.expressionEvaluator.evaluateTargetCondition(
                context.targetComponent,
                cond
              );
              if (!isMatch) {
                throw new ValidationError(
                  `ターゲットコンポーネントが条件を満たしていません。要求: ${cond.component}, 実際: ${context.targetComponent.componentId}`
                );
              }
            }
          }
        }
      }
    }
  }
}
