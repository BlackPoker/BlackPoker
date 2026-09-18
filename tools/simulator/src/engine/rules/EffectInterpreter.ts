import { CommandRegistry, CommandContext } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { getOpponentPlayerKey, findUnitOwnerPlayerKey, resolveEffectPlayerKey } from "./playerUtils";
import { hasUnitLabel, isCharacterComponent, hasHaste } from "./characterUtils";
import { matchesSuit, matchesRank } from "./cardUtils";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { validateOptionSelectionDefinition } from "./OptionSelectionValidator";
import { validatePartialOrder, validateCompleteOrder } from "./OrderSelectionValidator";
import { enumeratePhysicalCardsInGrave } from "./graveCardUtils";
import { EffectPathCodec, EffectBranchCode, BranchIdentity } from "./EffectPathCodec";

export class NonInterruptibleEffectExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonInterruptibleEffectExecutionError";
  }
}

export interface EffectInterruption {
  readonly interrupted: true;
  readonly effectIndex: number;
  readonly effectStepId: string;
  readonly selectionId: string;
  readonly selectionType?: "unit" | "unitAssignment" | "card" | "option" | "order" | "zoneTop";
  readonly candidates: any[];
  readonly attackers?: any[];
  readonly requiredCount?: number;
  readonly decisionPlayerKey?: PlayerKey;
  readonly resumeNextIndex?: number;
  readonly effectPath?: readonly number[];
}

export type EffectInterpreterResult =
  | { readonly completed: true }
  | EffectInterruption;

/**
 * 効果（エフェクトリスト）の解釈と、制御フロー（if-then-else）の実行管理を行います。
 */
export class EffectInterpreter {
  constructor(
    private registry: CommandRegistry,
    private expressionEvaluator: ExpressionEvaluator,
    private abilityEvaluator: AbilityEvaluator
  ) {}

  /**
   * ifSelection の条件判定と選択値の正規化を行います。
   * context.selections[args.selection] が配列の場合は単一要素を取り出し、
   * 不正な状態（未定義、空配列、複数要素、未知の選択値）に対しては例外を投げて fail-closed します。
   */
  public evaluateIfSelection(args: any, context: CommandContext): { shouldExecuteThen: boolean; shouldExecuteElse: boolean } {
    if (!args || typeof args !== "object") {
      throw new Error("ifSelection: 引数がオブジェクトではありません");
    }

    const selectionId = args.selection;
    if (typeof selectionId !== "string" || selectionId.trim().length === 0) {
      throw new Error(`ifSelection: selection は空でない文字列である必要があります (指定値: ${JSON.stringify(selectionId)})`);
    }

    // args.equals の検証 (必須・空文字不可・文字列)
    if (args.equals === undefined || typeof args.equals !== "string" || args.equals.trim().length === 0) {
      throw new Error(`ifSelection: equals は空でない文字列である必要があります (selection: '${selectionId}', 指定値: ${JSON.stringify(args.equals)})`);
    }

    // validValues の解決（args.validValues または action.effect の selectOption 定義から取得）
    let validValues: string[] | undefined = Array.isArray(args.validValues) ? args.validValues : undefined;
    if (!validValues && context.currentAction?.effect) {
      const optStep: any = context.currentAction.effect.find(
        (e: any) => e.selectOption && e.selectOption.id === selectionId
      );
      if (optStep?.selectOption) {
        const validated = validateOptionSelectionDefinition(optStep.selectOption);
        validValues = validated.options.map((o) => o.value);
      }
    }

    // 16. selection idに対応するselectOptionが存在しない / validValuesを取得不能 (fail-closed)
    if (!validValues || validValues.length === 0) {
      throw new Error(`ifSelection: selection id '${selectionId}' に対応する有効な selectOption 定義または validValues が見つかりません`);
    }

    // 17. args.equals が validValues に存在しない (Rule DSL typo fail-closed)
    if (!validValues.includes(args.equals)) {
      throw new Error(`ifSelection: equals に指定された値 '${args.equals}' は有効な選択肢 (${validValues.join(", ")}) に存在しません (Rule DSL typo)`);
    }

    const raw = context.selections?.[selectionId];

    // fail-closed: missing or undefined
    if (raw === undefined) {
      throw new Error(`ifSelection: 選択結果が見つかりません: ${selectionId}`);
    }

    let selectedValue: any;
    if (Array.isArray(raw)) {
      // fail-closed: empty array or multiple values
      if (raw.length !== 1) {
        throw new Error(`ifSelection: 選択肢は1つのみ指定してください (selection: ${selectionId}, 件数: ${raw.length})`);
      }
      selectedValue = raw[0];
    } else {
      selectedValue = raw;
    }

    // fail-closed: unknown value
    if (!validValues.includes(selectedValue)) {
      throw new Error(`ifSelection: 未知の選択値です: '${selectedValue}' (有効値: ${validValues.join(", ")})`);
    }

    const matches = selectedValue === args.equals;
    return {
      shouldExecuteThen: matches,
      shouldExecuteElse: !matches,
    };
  }

  /**
   * ifResult の真偽値判定を行います。
   * context.results[args.id] の値と args.equals を厳密に比較します (fail-closed)。
   */
  public evaluateIfResult(args: any, context: CommandContext): { shouldExecuteThen: boolean; shouldExecuteElse: boolean } {
    if (!args || typeof args !== "object") {
      throw new Error("ifResult: 引数がオブジェクトではありません");
    }

    const resultId = args.id;
    if (typeof resultId !== "string" || resultId.trim().length === 0) {
      throw new Error(`ifResult: id は空でない文字列である必要があります (指定値: ${JSON.stringify(resultId)})`);
    }

    if (typeof args.equals !== "boolean") {
      throw new Error(`ifResult: equals は真偽値 (boolean) である必要があります (id: '${resultId}', 指定値: ${JSON.stringify(args.equals)})`);
    }

    const actual = context.results?.[resultId];
    if (typeof actual !== "boolean") {
      throw new Error(`ifResult: context.results に真偽値の結果が存在しません: '${resultId}' (取得値: ${JSON.stringify(actual)})`);
    }

    const matches = actual === args.equals;
    return {
      shouldExecuteThen: matches,
      shouldExecuteElse: !matches,
    };
  }

  /**
   * 単一の効果コマンドを実行します（if分岐対応）。
   */
  executeEffect(effect: any, context: CommandContext) {
    const keys = Object.keys(effect);
    if (keys.length === 0) return;
    const name = keys[0];
    const args = effect[name];

    if (name === "guardCondition") {
      return;
    } else if (name === "if") {
      if (this.expressionEvaluator.evaluateCondition(args.condition, context, this.abilityEvaluator)) {
        if (args.then && Array.isArray(args.then)) {
          this.executeEffects(args.then, context);
        }
      } else if (args.else && Array.isArray(args.else)) {
        this.executeEffects(args.else, context);
      }
    } else if (name === "ifSelection") {
      const { shouldExecuteThen, shouldExecuteElse } = this.evaluateIfSelection(args, context);
      if (shouldExecuteThen && args.then && Array.isArray(args.then)) {
        this.executeEffects(args.then, context);
      } else if (shouldExecuteElse && args.else && Array.isArray(args.else)) {
        this.executeEffects(args.else, context);
      }
    } else if (name === "ifResult") {
      const { shouldExecuteThen, shouldExecuteElse } = this.evaluateIfResult(args, context);
      if (shouldExecuteThen && args.then && Array.isArray(args.then)) {
        this.executeEffects(args.then, context);
      } else if (shouldExecuteElse && args.else && Array.isArray(args.else)) {
        this.executeEffects(args.else, context);
      }
    } else {
      this.registry.execute(name, args, context);
    }
  }

  /**
   * 効果コマンドのリストを順次実行します。
   * ※非中断経路での同期実行専用。実行前またはコマンド実行によって pendingGraveTopSelections が
   * 存在・発生した場合は NonInterruptibleEffectExecutionError を throw します (fail-closed)。
   */
  executeEffects(effects: any[], context: CommandContext) {
    if (context.state.pendingGraveTopSelections && context.state.pendingGraveTopSelections.length > 0) {
      throw new NonInterruptibleEffectExecutionError(
        "executeEffects: pending Grave TOP selection exists before command execution"
      );
    }
    for (const effect of effects) {
      if (context.state.pendingGraveTopSelections && context.state.pendingGraveTopSelections.length > 0) {
        throw new NonInterruptibleEffectExecutionError(
          "executeEffects: pending Grave TOP selection exists before command execution"
        );
      }
      const keys = Object.keys(effect);
      if (keys.length > 0 && keys[0] === "guardCondition") {
        const passed = this.expressionEvaluator.evaluateCondition(
          effect.guardCondition.condition,
          context,
          this.abilityEvaluator
        );
        if (!passed) {
          return;
        }
        continue;
      }
      const pendingBefore = context.state.pendingGraveTopSelections?.length ?? 0;
      this.executeEffect(effect, context);
      const pendingAfter = context.state.pendingGraveTopSelections?.length ?? 0;
      if (pendingAfter > pendingBefore) {
        throw new NonInterruptibleEffectExecutionError(
          "executeEffects: command created Grave TOP selection in non-interruptible path"
        );
      }
    }
  }

  /**
   * DSL に基づいて判断権を持つプレイヤー（DecisionPlayer）を解決します。
   */
  private resolveDecisionPlayerKey(spec: string | undefined, context: CommandContext): PlayerKey {
    return resolveEffectPlayerKey(spec, context);
  }

  private executeConditionalBranchWithInterruption(
    name: "if" | "ifSelection" | "ifResult",
    args: any,
    context: CommandContext,
    index: number,
    branchMatch: { matches: boolean; branch?: BranchIdentity; childPath: readonly number[] }
  ): EffectInterpreterResult | undefined {
    let chosenBranchName: BranchIdentity;
    if (branchMatch.matches && branchMatch.branch) {
      // 再開時は条件を再評価せず、保存された branch identity を直接使用
      chosenBranchName = branchMatch.branch;
    } else {
      let shouldExecuteThen = false;
      let shouldExecuteElse = false;
      if (name === "if") {
        const passed = this.expressionEvaluator.evaluateCondition(args.condition, context, this.abilityEvaluator);
        shouldExecuteThen = passed;
        shouldExecuteElse = !passed;
      } else if (name === "ifSelection") {
        const res = this.evaluateIfSelection(args, context);
        shouldExecuteThen = res.shouldExecuteThen;
        shouldExecuteElse = res.shouldExecuteElse;
      } else if (name === "ifResult") {
        const res = this.evaluateIfResult(args, context);
        shouldExecuteThen = res.shouldExecuteThen;
        shouldExecuteElse = res.shouldExecuteElse;
      }

      if (shouldExecuteThen) {
        chosenBranchName = "then";
      } else if (shouldExecuteElse) {
        chosenBranchName = "else";
      } else {
        return undefined; // 実行すべきブランチなし
      }
    }

    const branchEffects = args[chosenBranchName];
    if (!branchEffects || !Array.isArray(branchEffects) || branchEffects.length === 0) {
      return undefined;
    }

    const childPath = branchMatch.matches ? branchMatch.childPath : [0];
    const branchResult = this.executeEffectsWithInterruption(
      branchEffects,
      context,
      childPath
    );

    if ("interrupted" in branchResult && branchResult.interrupted) {
      const innerChildPath = branchResult.effectPath ?? (
        branchResult.selectionType === "zoneTop"
          ? [branchResult.resumeNextIndex ?? branchResult.effectIndex + 1]
          : [branchResult.effectIndex]
      );

      // ブランチ内の全コマンドが完了しての zoneTop 中断であれば、再開位置は次のトップレベル効果
      const isBranchFullyExecuted = (
        branchResult.selectionType === "zoneTop" &&
        innerChildPath.length === 1 &&
        innerChildPath[0] >= branchEffects.length
      );

      const combinedPath = isBranchFullyExecuted
        ? EffectPathCodec.createTopLevelPath(index + 1)
        : EffectPathCodec.createBranchPath(index, chosenBranchName, innerChildPath);

      return {
        ...branchResult,
        effectIndex: index,
        resumeNextIndex: index + 1,
        effectPath: combinedPath,
      };
    }

    return undefined; // ブランチ正常完了
  }

  /**
   * 効果リストを実行し、途中でユーザー判断が必要なステップ（selectUnits, selectBlockAssignments等）に到達した場合は中断します。
   */
  executeEffectsWithInterruption(
    effects: any[],
    context: CommandContext,
    startIndexOrPath: number | readonly number[] = 0
  ): EffectInterpreterResult {
    const currentPath = EffectPathCodec.normalize(startIndexOrPath);
    const topStartIndex = EffectPathCodec.getTopIndex(currentPath);

    for (let i = topStartIndex; i < effects.length; i++) {
      const branchMatch = EffectPathCodec.matchNestedBranch(currentPath, i);

      // Fail-safe: Effect command実行前に pendingGraveTopSelections が既に存在する異常状態を遮断
      // ただし、このエフェクトの途中に再開中（branchMatch.matches）ではない場合
      if (!branchMatch.matches && context.state.pendingGraveTopSelections && context.state.pendingGraveTopSelections.length > 0) {
        const nextPending = context.state.pendingGraveTopSelections[0];
        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: "zoneTopSelection",
          selectionId: "graveTopCard",
          selectionType: "zoneTop",
          candidates: nextPending.candidateCardIds,
          decisionPlayerKey: nextPending.playerId,
          resumeNextIndex: i,
          effectPath: EffectPathCodec.createTopLevelPath(i),
        };
      }

      const effect = effects[i];
      const keys = Object.keys(effect);
      if (keys.length === 0) continue;
      const name = keys[0];
      const args = effect[name];

      if (name === "guardCondition") {
        const passed = this.expressionEvaluator.evaluateCondition(
          args.condition,
          context,
          this.abilityEvaluator
        );
        if (!passed) {
          return { completed: true };
        }
        continue;
      }

      if (name === "selectUnits") {
        const selectionId = args.id || "attackers";
        // 既に selections に値がセットされている場合はスキップ
        if (context.selections && context.selections[selectionId] !== undefined) {
          continue;
        }

        const decisionPlayerKey = this.resolveDecisionPlayerKey(args.decisionPlayer || args.chooser, context);

        // テスト等で targetComponent が明示されている場合は自動束縛
        if (context.targetComponent) {
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = [context.targetComponent.unitId || context.targetComponent];
          continue;
        }

        const candidates = this.findSelectableUnits(args, context, decisionPlayerKey);
        if (candidates.length === 0) {
          // 候補0体の場合はDecisionを発生させず、空配列をバインドして継続
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = [];
          continue;
        }

        // 候補1体以上が存在する場合は中断してDecisionを要求
        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: name,
          selectionId,
          selectionType: "unit",
          candidates,
          decisionPlayerKey,
          effectPath: EffectPathCodec.createTopLevelPath(i),
        };
      }

      if (name === "selectBlockAssignments" || name === "selectUnitAssignments") {
        const selectionId = args.id || "blocks";
        if (context.selections && context.selections[selectionId] !== undefined) {
          continue;
        }

        const decisionPlayerKey = args.decisionPlayer || args.chooser
          ? this.resolveDecisionPlayerKey(args.decisionPlayer || args.chooser, context)
          : (context.state.nonTurnPlayer || (context.state.turnPlayer ? getOpponentPlayerKey(context.state.turnPlayer, context.state) : context.playerKey));

        // アタッカー群の特定（ディフェンダー側から見た攻撃側のユニット）
        const state = context.state;
        const defenderKey = decisionPlayerKey;
        const attackerPlayerKey = getOpponentPlayerKey(defenderKey, state);
        const attackerPlayer = state.players?.[attackerPlayerKey];
        const attackers: any[] = (attackerPlayer?.field || []).filter(
          (u: any) => u.battle?.role === "attacker" && (u.battle?.targetPlayerKey === defenderKey || !u.battle?.targetPlayerKey)
        );

        // テスト等で targetComponent が明示されている場合は自動束縛
        if (context.targetComponent) {
          if (!context.selections) context.selections = {};
          if (attackers.length > 0) {
            context.selections[selectionId] = [
              {
                sourceUnitId: attackers[0].unitId,
                selectedUnitIds: [context.targetComponent.unitId || context.targetComponent],
              },
            ];
          }
          continue;
        }

        // ブロッカー候補群の抽出 (relation: "decisionPlayer" は防御側プレイヤーの自陣)
        const candidates = this.findSelectableUnits(args, context, decisionPlayerKey);

        if (candidates.length === 0 || attackers.length === 0) {
          // ブロッカー候補0体またはアタッカー0体の場合はDecisionを発生させず、全アタッカー空配列の割当てをバインドして継続
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = attackers.map((a) => ({
            sourceUnitId: a.unitId,
            selectedUnitIds: [],
          }));
          continue;
        }

        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: name,
          selectionId,
          selectionType: "unitAssignment",
          candidates,
          attackers,
          decisionPlayerKey,
          effectPath: EffectPathCodec.createTopLevelPath(i),
        };
      }

      if (name === "selectCards" || name === "selectCard") {
        const selectionId = args.id || "selectedCards";
        if (context.selections && context.selections[selectionId] !== undefined) {
          continue;
        }

        const count = args.count ?? 1;
        const candidatePlayerSpec =
          args.candidatePlayer ?? args.sourcePlayer ?? args.player ?? args.chooser ?? "self";
        const decisionPlayerSpec =
          args.decisionPlayer ?? args.chooser ?? args.player ?? "self";

        const candidatePlayerKey = this.resolveDecisionPlayerKey(candidatePlayerSpec, context);
        const decisionPlayerKey = this.resolveDecisionPlayerKey(decisionPlayerSpec, context);
        const candidates = this.findSelectableCards(args, context, candidatePlayerKey);

        if (candidates.length === 0) {
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = [];
          continue;
        }

        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: name,
          selectionId,
          selectionType: "card",
          candidates,
          requiredCount: count,
          decisionPlayerKey,
          effectPath: EffectPathCodec.createTopLevelPath(i),
        };
      }

      if (name === "selectDiscardCards" || name === "discardDownTo") {
        const selectionId = args.id || "discardCards";
        const max = args.max ?? 7;
        const playerKey = this.resolveDecisionPlayerKey(args.player, context);
        const player = context.state.players?.[playerKey];
        const hand = Array.isArray(player?.hand) ? player.hand : [];

        // 手札枚数チェック: max 以下の場合は中断せず次ステップへ
        if (hand.length <= max) {
          continue;
        }

        const requiredCount = hand.length - max;
        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: name,
          selectionId,
          selectionType: "card",
          candidates: [...hand],
          requiredCount,
          decisionPlayerKey: playerKey,
          effectPath: EffectPathCodec.createTopLevelPath(i),
        };
      }

      if (name === "selectOption") {
        const validated = validateOptionSelectionDefinition(args);
        const selectionId = validated.id;
        if (context.selections && context.selections[selectionId] !== undefined) {
          continue;
        }

        const decisionPlayerKey = this.resolveDecisionPlayerKey(args.decisionPlayer || args.chooser, context);

        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: name,
          selectionId,
          selectionType: "option",
          candidates: validated.options,
          decisionPlayerKey,
          effectPath: EffectPathCodec.createTopLevelPath(i),
        };
      }

      if (name === "selectUnitCardOrder") {
        const selectionId = args.id || "order";

        // ターゲットユニットの特定
        let targetUnit: any = context.targetComponent;
        if (!targetUnit && args.target) {
          const targetUnitId = this.expressionEvaluator.resolveBindingValue(args.target, context);
          if (typeof targetUnitId === "string") {
            for (const p of Object.values<any>(context.state.players || {})) {
              const u = p.field?.find((unit: any) => unit.unitId === targetUnitId);
              if (u) {
                targetUnit = u;
                break;
              }
            }
          }
        }

        if (!targetUnit) {
          throw new Error(`selectUnitCardOrder: 対象ユニットが見つかりません (target: ${args.target})`);
        }

        const cards: any[] = Array.isArray(targetUnit.cards) ? targetUnit.cards : [];
        if (cards.length === 0) {
          throw new Error(`selectUnitCardOrder: ユニット (${targetUnit.unitId}) の構成カードが0枚です (fail-closed)`);
        }

        const candidateCardIds = cards.map((c) => c.id);

        // オーナー（判断権を持つプレイヤー）の特定
        const decisionPlayerKey = this.resolveDecisionPlayerKey(args.chooser || args.decisionPlayer || "targetOwner", context);

        // 現在の選択状態を取得
        const currentSelection = context.selections?.[selectionId];

        // 1枚のみの場合: 決定不要で自動束縛
        if (cards.length === 1) {
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = [cards[0].id];
          continue;
        }

        // 2枚以上の場合
        let partialOrder: string[] = [];
        if (Array.isArray(currentSelection)) {
          validatePartialOrder(currentSelection, candidateCardIds);
          partialOrder = currentSelection;
        } else if (currentSelection !== undefined) {
          throw new Error(`selectUnitCardOrder: selection.${selectionId} の値が配列ではありません`);
        }

        // すでに全カード確定済みの場合
        if (partialOrder.length === cards.length) {
          validateCompleteOrder(partialOrder, candidateCardIds);
          continue;
        }

        const remainingCardIds = candidateCardIds.filter((id) => !partialOrder.includes(id));

        // 残り1枚の場合は自動確定して次ステップへ
        if (remainingCardIds.length === 1) {
          const finalOrder = [...partialOrder, remainingCardIds[0]];
          validateCompleteOrder(finalOrder, candidateCardIds);
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = finalOrder;
          continue;
        }

        // 2枚以上残っている場合はオーナーに選択を要求
        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: name,
          selectionId,
          selectionType: "order",
          candidates: cards,
          decisionPlayerKey,
          effectPath: EffectPathCodec.createTopLevelPath(i),
        };
      }

      if (name === "if" || name === "ifSelection" || name === "ifResult") {
        const branchInterruption = this.executeConditionalBranchWithInterruption(
          name,
          args,
          context,
          i,
          branchMatch
        );
        if (branchInterruption) {
          return branchInterruption;
        }
        continue;
      }

      this.executeEffect(effect, context);

      // コマンド単位即時中断 (Immediate Post-Command Interruption)
      // 最後のeffectであっても、pendingGraveTopSelectionsが存在すれば必ず中断する (i < effects.length - 1 ガード撤廃)
      if (context.state.pendingGraveTopSelections && context.state.pendingGraveTopSelections.length > 0) {
        const nextPending = context.state.pendingGraveTopSelections[0];
        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: "zoneTopSelection",
          selectionId: "graveTopCard",
          selectionType: "zoneTop",
          candidates: nextPending.candidateCardIds,
          decisionPlayerKey: nextPending.playerId,
          resumeNextIndex: i + 1,
          effectPath: EffectPathCodec.createTopLevelPath(i + 1),
        };
      }
    }

    return { completed: true };
  }

  /**
   * 手札等から選択可能なカード群を抽出します。
   */
  findSelectableCards(args: any, context: CommandContext, playerKey: PlayerKey): any[] {
    const zone = args.zone || "hand";
    const condition = args.condition || {};
    const player = context.state.players?.[playerKey];
    if (!player) return [];

    let cardPool: any[] = [];
    if (zone === "hand") {
      cardPool = Array.isArray(player.hand) ? [...player.hand] : [];
      const seenIds = new Set<string>();
      for (const card of cardPool) {
        if (!card || typeof card !== "object" || !card.id || card.unitId || Array.isArray(card.cards) || card.kind) {
          throw new Error("findSelectableCards: 手札に不正なエントリまたはUnit wrapperが含まれています (fail-closed)");
        }
        if (seenIds.has(card.id)) {
          throw new Error(`findSelectableCards: 手札に重複するカードIDが存在します: ${card.id} (fail-closed)`);
        }
        seenIds.add(card.id);
      }
    } else if (zone === "grave") {
      cardPool = Array.isArray(player.grave) ? enumeratePhysicalCardsInGrave(player.grave) : [];
    } else if (zone === "pack") {
      cardPool = Array.isArray(player.pack?.cards) ? [...player.pack.cards] : [];
    } else if (zone === "life") {
      cardPool = Array.isArray(player.life) ? [...player.life] : [];
    }

    // 候補カードの絞り込み
    return cardPool.filter((card) => {
      // 1. component (例: character.bulwark) 定義からの判定
      if (condition.component) {
        const compDef = context.components?.find((c) => c.id === condition.component);
        if (compDef?.unitCondition?.cards) {
          const uCards = compDef.unitCondition.cards;
          if (uCards.suit && !matchesSuit(card.suit, uCards.suit)) {
            return false;
          }
          if (uCards.rank && !matchesRank(card.rank, card.value || 0, uCards.rank)) {
            return false;
          }
        }
      }

      // 2. card 条件の直接指定
      if (condition.card) {
        const condCard = condition.card;
        if (condCard.suit && !matchesSuit(card.suit, condCard.suit)) {
          return false;
        }
        if (condCard.rank && !matchesRank(card.rank, card.value || 0, condCard.rank)) {
          return false;
        }
      }

      // 3. suit / rank の直接指定
      if (condition.suit && !matchesSuit(card.suit, condition.suit)) {
        return false;
      }
      if (condition.rank && !matchesRank(card.rank, card.value || 0, condition.rank)) {
        return false;
      }

      return true;
    });
  }


  /**
   * 盤面から選択可能なユニット群を抽出します。
   */
  findSelectableUnits(args: any, context: CommandContext, decisionPlayerKey?: PlayerKey): any[] {
    const relation = args.relation || "self";
    const condition = args.condition || {};

    let playerKey: PlayerKey = context.playerKey;
    if (relation === "decisionPlayer") {
      playerKey = decisionPlayerKey || context.playerKey;
    } else if (relation === "opponent") {
      playerKey = getOpponentPlayerKey(context.playerKey, context.state);
    } else if (relation === "self") {
      playerKey = context.playerKey;
    }

    const player = context.state.players?.[playerKey];
    if (!player || !player.field) return [];

    return player.field.filter((unit: any) => {
      // 状態チェック (例: charge)
      if (condition.state && unit.state !== condition.state) return false;

      // ラベルチェック (例: 攻撃 / attack, 防御 / defense)
      if (condition.label) {
        const expectedLabels = Array.isArray(condition.label) ? condition.label : [condition.label];
        const hasLabel = expectedLabels.some((l: string) =>
          hasUnitLabel(unit, l, context.components)
        );
        if (!hasLabel) return false;
      }

      // componentType チェック (例: character)
      if (condition.componentType === "character") {
        if (!isCharacterComponent(unit, context.components)) {
          return false;
        }
      } else if (condition.componentType) {
        const compId = unit.componentId || "";
        const compDef = context.components?.find((c: any) => c.id === compId);
        const matchType = compDef ? compDef.type === condition.componentType : compId.startsWith(`${condition.componentType}.`);
        if (!matchType) return false;
      }

      // 召喚酔いチェック (アタッカー指定時: このターン場に出たキャラクターは <速攻> を持たない限りアタッカー指定不可)
      // ※ プリセット配置 (enteredFieldBeforeGame === true) のユニットはゲーム開始前配置のため Turn 1 からアタック可能
      const isAttackerSelection = args.id === "attackers" || condition.canAttack === true;
      if (isAttackerSelection) {
        const currentTurn = context.state.turnCount ?? 1;
        const isPreset = unit.enteredFieldBeforeGame === true || unit.enteredFieldTurn === 0 || unit.enteredTurn === 0;
        if (!isPreset) {
          const enteredThisTurn = unit.enteredFieldTurn === currentTurn || (unit.enteredFieldTurn === undefined && unit.enteredTurn === currentTurn);
          if (enteredThisTurn && !hasHaste(unit, context.components)) {
            return false;
          }
        }
      }

      return true;
    });
  }

  /**
   * ゲームイベントを発行し、TriggerResolver に伝達してリクエストバッファへ蓄積します。
   */
  dispatchEvent(event: any, context: CommandContext) {
    this.registry.emitEvent(event, context);
    if (this.registry.triggerResolver) {
      this.registry.triggerResolver.resolveTriggers(event, context);
    }
  }
}

