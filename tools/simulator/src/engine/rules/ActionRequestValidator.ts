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
    if (!context.triggered && action.request && action.request.timing) {
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
        } else if (timing === "block") {
          if (requester !== state.chancePlayer || !isStageEmpty) {
            throw new ValidationError(
              `ブロックタイミングのアクションはチャンス所持かつステージが空である必要があります。現在: chancePlayer=${state.chancePlayer}, requester=${requester}, stageEmpty=${isStageEmpty}`
            );
          }
          // フィールド上に自分を攻撃対象とする「相手のアタッカー」が存在するか検証する
          let hasValidOpponentAttacker = false;
          for (const [pKey, p] of Object.entries<any>(state.players)) {
            if (pKey === requester) continue; // 自分の所有するユニットは除外（自分自身のアタッカーをブロックできない）
            if (p.field?.some((u: any) => u.battle?.role === "attacker" && u.battle?.targetPlayerKey === requester)) {
              hasValidOpponentAttacker = true;
              break;
            }
          }
          if (!hasValidOpponentAttacker) {
            throw new ValidationError(
              `自分を攻撃している相手のアタッカーが存在しないため、ブロックできません。`
            );
          }
        } else if (timing === "damageJudge") {
          if (requester !== state.turnPlayer || requester !== state.chancePlayer || !isStageEmpty) {
            throw new ValidationError(
              `ダメージ判定タイミングのアクションは手番かつチャンス所持かつステージが空である必要があります。現在: turnPlayer=${state.turnPlayer}, chancePlayer=${state.chancePlayer}, requester=${requester}, stageEmpty=${isStageEmpty}`
            );
          }

          // アタッカーの検索とカウント
          const attackers: any[] = [];
          for (const player of Object.values<any>(state.players)) {
            if (player.field) {
              const uList = player.field.filter((u: any) => u.battle?.role === "attacker");
              attackers.push(...uList);
            }
          }

          if (attackers.length === 0) {
            throw new ValidationError("戦闘中のアタッカーが存在しないため、ダメージ判定を行えません。");
          }
          if (attackers.length > 1) {
            throw new ValidationError(`戦闘中のアタッカーが複数（${attackers.length}体）存在するため、ダメージ判定を行えません。`);
          }

          const attacker = attackers[0];

          // ブロッカーの検索とカウント
          const blockers: any[] = [];
          for (const player of Object.values<any>(state.players)) {
            if (player.field) {
              const uList = player.field.filter(
                (u: any) => u.battle?.role === "blocker" && u.battle?.blocksUnitId === attacker.unitId
              );
              blockers.push(...uList);
            }
          }

          if (blockers.length === 0) {
            throw new ValidationError("アタッカーに対するブロッカーが存在しないため、ダメージ判定を行えません。");
          }
          if (blockers.length > 1) {
            throw new ValidationError(`アタッカーに対するブロッカーが複数（${blockers.length}体）存在するため、ダメージ判定を行えません。`);
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
