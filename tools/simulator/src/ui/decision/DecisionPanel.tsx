import React, { useState, useMemo, useEffect, useRef } from "react";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PatternExpander } from "../../engine/decision/PatternExpander";
import { formatCardDisplay, formatCardList, formatSuitSymbol, formatOfficialSuitSymbol } from "../../engine/rules/cardUtils";
import { BlockAssignmentEditor } from "./BlockAssignmentEditor";
import { isBlockAssignmentRequest } from "./blockAssignmentUtils";
import { BattleRelationPresenter, type UnitBattleDisplayInfo } from "../game/BattleRelationPresenter";
import { RichCardText } from "../common/RichCardText";
import { CardView } from "../game/CardView";

export interface DecisionPanelDraftState {
  readonly decisionId: string;
  readonly selectedActionRef: number | null;
  readonly selectedKeyRef: number | null;
  readonly selectedCostRef: number | null;
  readonly selectedTargetRef: number | null;
  readonly selectedEffectPatternRef: number | null;
  readonly selectedBlockPatternRef: number | null;
  readonly firstSelectedCardId: string | null;
  readonly blockAssignments?: Record<string, string[]>;
}

export interface DecisionPanelProps {
  readonly request: DecisionRequest;
  readonly onSubmit: (response: DecisionResponse, options?: { autoPass?: boolean }) => void;
  readonly onCancel?: () => void;
  readonly onSelectionMarkersChange?: (markers: Map<string, { badge: string; isSelected: boolean }>) => void;
  readonly selectedUnitIdsFromBoard?: string[];
  readonly lastBoardUnitClick?: { unitId: string; seq: number } | null;
  readonly draftStateRef?: React.MutableRefObject<DecisionPanelDraftState | null>;
  readonly onHighlightRequest?: (requestId?: string) => void;
  readonly initialActionRef?: number;
  readonly initialCostRef?: number;
  readonly initialTargetRef?: number;
  readonly battleRelationMap?: Map<string, UnitBattleDisplayInfo> | ReadonlyMap<string, UnitBattleDisplayInfo>;
  readonly onUndo?: () => void;
  readonly canUndo?: boolean;
  readonly disabled?: boolean;
}


/**
 * コスト支払い要素の表示用文字列を生成します。
 * 防壁ドライブ ($B) 選択時は、防壁配置番号（ライフ側から ①, ②...）とカードのスート/ランクを表示します。
 * 例: "防壁① ♠2", "手札 ♠A 破棄, 防壁① ♠2"
 */
export function formatCostPaymentDisplay(
  costSel: {
    readonly discardedCardIds?: readonly string[];
    readonly drivenBulwarkUnitIds?: readonly string[];
    readonly sacrificedUnitIds?: readonly string[];
    readonly lifeCount?: number;
    readonly summary?: string;
  },
  request: DecisionRequest,
  battleRelationMap?: Map<string, UnitBattleDisplayInfo> | ReadonlyMap<string, UnitBattleDisplayInfo>
): string {
  const parts: string[] = [];
  const decisionPlayer = request.observation?.players?.find((p) => p.playerId === request.playerId);

  // 1. 手札破棄
  if (costSel.discardedCardIds && costSel.discardedCardIds.length > 0) {
    const cardLabels = costSel.discardedCardIds.map((cId) => {
      const card = decisionPlayer?.handCards?.find(
        (c: any) => (c.cardInstanceId && c.cardInstanceId === cId) || c.id === cId
      );
      return card ? formatOfficialSuitSymbol(formatCardDisplay(card)) : cId;
    });
    parts.push(`手札 ${cardLabels.join(", ")} 破棄`);
  }

  // 2. 防壁ドライブ
  if (costSel.drivenBulwarkUnitIds && costSel.drivenBulwarkUnitIds.length > 0) {
    const bulwarkLabels = costSel.drivenBulwarkUnitIds.map((bId) => {
      const info = battleRelationMap?.get(bId);
      const bulwarkPos = info?.bulwarkPosition ?? "";
      const unit = decisionPlayer?.field?.find((u: any) => u.unitId === bId);
      const cardText = unit?.cards?.[0] ? formatOfficialSuitSymbol(formatCardDisplay(unit.cards[0])) : "";
      return `防壁${bulwarkPos}${cardText ? ` ${cardText}` : ""}`;
    });
    parts.push(bulwarkLabels.join(", "));
  }

  // 3. ライフ消費
  if (costSel.lifeCount && costSel.lifeCount > 0) {
    parts.push(`${costSel.lifeCount}点 ライフ消費`);
  }

  if (parts.length > 0) {
    return parts.join(", ");
  }
  return costSel.summary || "コストなし";
}

export const DecisionPanel: React.FC<DecisionPanelProps> = ({
  request,
  onSubmit,
  onSelectionMarkersChange,
  selectedUnitIdsFromBoard,
  lastBoardUnitClick,
  draftStateRef,
  onHighlightRequest,
  initialActionRef,
  initialCostRef,
  initialTargetRef,
  battleRelationMap,
  onUndo,
  canUndo,
  disabled,
}) => {

  const catalog = request.catalog;
  const patterns = request.patterns;

  // 同一 decisionId でブレークポイント跨ぎ (1023px <-> 1024px) が発生した場合、draftStateRef から復元
  const matchingDraft =
    draftStateRef?.current && draftStateRef.current.decisionId === request.decisionId
      ? draftStateRef.current
      : null;

  // 選択状態
  const [selectedActionRef, setSelectedActionRef] = useState<number | null>(
    matchingDraft ? matchingDraft.selectedActionRef : (initialActionRef ?? null)
  );
  const [selectedKeyRef, setSelectedKeyRef] = useState<number | null>(
    matchingDraft ? matchingDraft.selectedKeyRef : null
  );
  const [selectedCostRef, setSelectedCostRef] = useState<number | null>(
    matchingDraft ? matchingDraft.selectedCostRef : (initialCostRef ?? null)
  );
  const [selectedTargetRef, setSelectedTargetRef] = useState<number | null>(
    matchingDraft ? matchingDraft.selectedTargetRef : (initialTargetRef ?? null)
  );
  const [selectedEffectPatternRef, setSelectedEffectPatternRef] = useState<number | null>(
    matchingDraft ? matchingDraft.selectedEffectPatternRef : null
  );
  const [selectedBlockPatternRef, setSelectedBlockPatternRef] = useState<number | null>(
    matchingDraft ? matchingDraft.selectedBlockPatternRef : null
  );
  const [firstSelectedCardId, setFirstSelectedCardId] = useState<string | null>(
    matchingDraft ? matchingDraft.firstSelectedCardId : null
  );
  const [blockAssignmentsDraft, setBlockAssignmentsDraft] = useState<Record<string, string[]> | undefined>(
    matchingDraft?.blockAssignments
  );
  const [isActionListExpanded, setIsActionListExpanded] = useState<boolean>(false);
  const isSubmittedRef = useRef(false);
  const lastDecisionIdRef = useRef(request.decisionId);
  const lastProcessedBoardClickSeqRef = useRef<number>(lastBoardUnitClick?.seq ?? 0);

  // decisionId 切替時の選択状態リセット (Defense-in-depth)
  useEffect(() => {
    if (lastDecisionIdRef.current !== request.decisionId) {
      lastDecisionIdRef.current = request.decisionId;
      setSelectedActionRef(initialActionRef ?? null);
      setSelectedKeyRef(null);
      setSelectedCostRef(initialCostRef ?? null);
      setSelectedTargetRef(initialTargetRef ?? null);
      setSelectedEffectPatternRef(null);
      setSelectedBlockPatternRef(null);
      setFirstSelectedCardId(null);
      setBlockAssignmentsDraft(undefined);
      setIsActionListExpanded(false);
      isSubmittedRef.current = false;
    }
  }, [request.decisionId, initialActionRef, initialCostRef, initialTargetRef]);

  // draftStateRef への選択状態同期 (ブレークポイント跨ぎでの状態保持)
  useEffect(() => {
    if (!draftStateRef) return;
    draftStateRef.current = {
      decisionId: request.decisionId,
      selectedActionRef,
      selectedKeyRef,
      selectedCostRef,
      selectedTargetRef,
      selectedEffectPatternRef,
      selectedBlockPatternRef,
      firstSelectedCardId,
      blockAssignments: blockAssignmentsDraft,
    };
  }, [
    draftStateRef,
    request.decisionId,
    selectedActionRef,
    selectedKeyRef,
    selectedCostRef,
    selectedTargetRef,
    selectedEffectPatternRef,
    selectedBlockPatternRef,
    firstSelectedCardId,
    blockAssignmentsDraft,
  ]);

  // 選択中ターゲットのリクエストIDハイライト連携
  useEffect(() => {
    if (selectedTargetRef !== null && catalog.targetSelections[selectedTargetRef]) {
      const target = catalog.targetSelections[selectedTargetRef];
      onHighlightRequest?.(target.targetRequestId);
    } else {
      onHighlightRequest?.(undefined);
    }
  }, [selectedTargetRef, catalog, onHighlightRequest]);

  useEffect(() => {
    return () => {
      onHighlightRequest?.(undefined);
    };
  }, [onHighlightRequest]);

  // 1. 選択可能なアクション一覧（カタログ定義順 / 公式Action順で表示）
  const availableActionRefs = useMemo(() => {
    const refs = new Set<number>();
    for (const p of patterns) {
      if (p.actionSelectionRef !== undefined) refs.add(p.actionSelectionRef);
    }
    return Array.from(refs).sort((a, b) => a - b);
  }, [patterns]);

  // 2. 選択中アクションで絞り込まれたパターン
  const patternsFilteredByAction = useMemo(() => {
    if (selectedActionRef === null) return [];
    return patterns.filter((p) => p.actionSelectionRef === selectedActionRef);
  }, [patterns, selectedActionRef]);

  // 選択可能なキーカード一覧 (keyCardSelectionRef が実際にカタログに存在するもののみ)
  const availableKeyRefs = useMemo(() => {
    const refs = new Set<number>();
    for (const p of patternsFilteredByAction) {
      if (p.keyCardSelectionRef !== undefined && catalog.cardSelections?.[p.keyCardSelectionRef] !== undefined) {
        refs.add(p.keyCardSelectionRef);
      }
    }
    return Array.from(refs);
  }, [patternsFilteredByAction, catalog.cardSelections]);

  // 3. 選択中アクション + キーカードで絞り込まれたパターン
  const patternsFilteredByKey = useMemo(() => {
    if (availableKeyRefs.length === 0) {
      return patternsFilteredByAction;
    }
    if (selectedKeyRef === null) {
      if (availableKeyRefs.length === 1) {
        return patternsFilteredByAction.filter((p) => p.keyCardSelectionRef === availableKeyRefs[0]);
      }
      return [];
    }
    return patternsFilteredByAction.filter((p) => p.keyCardSelectionRef === selectedKeyRef);
  }, [patternsFilteredByAction, availableKeyRefs, selectedKeyRef]);

  // 選択可能なコスト支払い一覧 (costPaymentRef が実際にカタログに存在するもののみ)
  const availableCostRefs = useMemo(() => {
    const refs = new Set<number>();
    for (const p of patternsFilteredByKey) {
      if (p.costPaymentRef !== undefined && catalog.costPayments?.[p.costPaymentRef] !== undefined) {
        refs.add(p.costPaymentRef);
      }
    }
    return Array.from(refs);
  }, [patternsFilteredByKey, catalog.costPayments]);

  // 4. 選択中アクション + キーカード + コストで絞り込まれたパターン
  const patternsFilteredByCost = useMemo(() => {
    if (availableCostRefs.length === 0) {
      return patternsFilteredByKey;
    }
    if (selectedCostRef === null) {
      if (availableCostRefs.length === 1) {
        return patternsFilteredByKey.filter((p) => p.costPaymentRef === availableCostRefs[0]);
      }
      return [];
    }
    return patternsFilteredByKey.filter((p) => p.costPaymentRef === selectedCostRef);
  }, [patternsFilteredByKey, availableCostRefs, selectedCostRef]);

  // 選択可能な対象一覧 (targetSelectionRef が実際にカタログに存在するもののみ)
  const availableTargetRefs = useMemo(() => {
    const refs = new Set<number>();
    for (const p of patternsFilteredByCost) {
      if (p.targetSelectionRef !== undefined && catalog.targetSelections?.[p.targetSelectionRef] !== undefined) {
        refs.add(p.targetSelectionRef);
      }
    }
    return Array.from(refs);
  }, [patternsFilteredByCost, catalog.targetSelections]);

  // アクション選択ハンドラ
  const handleSelectAction = (actRef: number) => {
    setSelectedActionRef(actRef);
    setFirstSelectedCardId(null);

    const acts = patterns.filter((p) => p.actionSelectionRef === actRef);
    const keyRefs = Array.from(
      new Set(acts.map((p) => p.keyCardSelectionRef).filter((r): r is number => r !== undefined))
    );
    let nextKeyRef: number | null = null;
    if (keyRefs.length === 1) {
      nextKeyRef = keyRefs[0];
    }
    setSelectedKeyRef(nextKeyRef);


    const keys = acts.filter((p) =>
      nextKeyRef === null ? p.keyCardSelectionRef === undefined : p.keyCardSelectionRef === nextKeyRef
    );
    const costRefs = Array.from(new Set(keys.map((p) => p.costPaymentRef).filter((r) => r !== undefined)));
    let nextCostRef: number | null = null;
    if (costRefs.length === 1) {
      nextCostRef = costRefs[0] as number;
    }
    setSelectedCostRef(nextCostRef);

    const costs = keys.filter((p) => (nextCostRef === null ? true : p.costPaymentRef === nextCostRef));
    const targetRefs = Array.from(new Set(costs.map((p) => p.targetSelectionRef).filter((r) => r !== undefined)));
    let nextTargetRef: number | null = null;
    if (targetRefs.length === 1) {
      nextTargetRef = targetRefs[0] as number;
    }
    setSelectedTargetRef(nextTargetRef);
  };

  const handleSelectKey = (keyRef: number | undefined) => {
    const kRef = keyRef !== undefined ? keyRef : null;
    setSelectedKeyRef(kRef);

    const keys = patternsFilteredByAction.filter((p) =>
      kRef === null ? p.keyCardSelectionRef === undefined : p.keyCardSelectionRef === kRef
    );
    const costRefs = Array.from(new Set(keys.map((p) => p.costPaymentRef).filter((r) => r !== undefined)));
    let nextCostRef: number | null = null;
    if (costRefs.length === 1) {
      nextCostRef = costRefs[0] as number;
    }
    setSelectedCostRef(nextCostRef);

    const costs = keys.filter((p) => (nextCostRef === null ? true : p.costPaymentRef === nextCostRef));
    const targetRefs = Array.from(new Set(costs.map((p) => p.targetSelectionRef).filter((r) => r !== undefined)));
    let nextTargetRef: number | null = null;
    if (targetRefs.length === 1) {
      nextTargetRef = targetRefs[0] as number;
    }
    setSelectedTargetRef(nextTargetRef);
  };

  const handleSelectCost = (costRef: number) => {
    setSelectedCostRef(costRef);

    const costs = patternsFilteredByKey.filter((p) => p.costPaymentRef === costRef);
    const targetRefs = Array.from(new Set(costs.map((p) => p.targetSelectionRef).filter((r) => r !== undefined)));
    let nextTargetRef: number | null = null;
    if (targetRefs.length === 1) {
      nextTargetRef = targetRefs[0] as number;
    }
    setSelectedTargetRef(nextTargetRef);
  };

  const handleSelectTarget = (targetRef: number) => {
    setSelectedTargetRef(targetRef);
    const target = catalog.targetSelections[targetRef];
    onHighlightRequest?.(target?.targetRequestId);
  };

  // --- 2枚キーカード段階選択 (Progressive Selector) ロジック ---

  // 判断プレイヤーの手札（自プレイヤーの公開手札のみ参照し、Hidden Information を厳格保護）
  const decisionPlayer = useMemo(() => {
    return request.observation?.players?.find((p) => p.playerId === request.playerId);
  }, [request.observation, request.playerId]);

  const handCards = useMemo(() => {
    return decisionPlayer?.handCards || [];
  }, [decisionPlayer]);

  // 全ての合法キーカード選択肢が 2枚のカードを要求しているか判定
  const isTwoKeyCardAction = useMemo(() => {
    if (availableKeyRefs.length === 0) return false;
    return availableKeyRefs.every((ref) => {
      const sel = catalog.cardSelections[ref];
      return sel && sel.cardIds && sel.cardIds.length === 2;
    });
  }, [availableKeyRefs, catalog.cardSelections]);

  // cardId から手札カードおよび表示用テキストを取得
  const getCardInfo = (cardId: string) => {
    const rawCard = handCards.find((c: any) => (c.cardInstanceId && c.cardInstanceId === cardId) || c.id === cardId);
    const card: { id?: string; suit?: string; rank?: string; value?: number; code?: string } | undefined =
      rawCard && !("visibility" in rawCard && rawCard.visibility === "HIDDEN") ? (rawCard as any) : undefined;
    let displayCode = "";
    for (const ref of availableKeyRefs) {
      const sel = catalog.cardSelections[ref];
      if (sel) {
        const idx = sel.cardIds.indexOf(cardId);
        if (idx !== -1 && sel.displayCodes?.[idx]) {
          displayCode = sel.displayCodes[idx];
          break;
        }
      }
    }
    if (!displayCode && rawCard) {
      displayCode = formatOfficialSuitSymbol(formatCardDisplay(rawCard));
    }
    if (!displayCode) {
      displayCode = cardId;
    }
    return { card, displayCode };
  };

  // 手札順でカードIDをソート
  const sortCardIdsByHand = (cardIds: string[]) => {
    return [...cardIds].sort((a, b) => {
      const idxA = handCards.findIndex((c: any) => (c.cardInstanceId && c.cardInstanceId === a) || c.id === a);
      const idxB = handCards.findIndex((c: any) => (c.cardInstanceId && c.cardInstanceId === b) || c.id === b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  };

  // 1枚目候補カードID一覧 (重複排除 & 手札順ソート)
  const step1CardIds = useMemo(() => {
    if (!isTwoKeyCardAction) return [];
    const idSet = new Set<string>();
    for (const ref of availableKeyRefs) {
      const sel = catalog.cardSelections[ref];
      if (sel?.cardIds) {
        for (const cid of sel.cardIds) {
          idSet.add(cid);
        }
      }
    }
    return sortCardIdsByHand(Array.from(idSet));
  }, [isTwoKeyCardAction, availableKeyRefs, catalog.cardSelections, handCards]);

  // 2枚目候補カードID一覧 (1枚目とペアを組める相手のみ抽出 & 重複排除 & 手札順ソート)
  const step2CardIds = useMemo(() => {
    if (!isTwoKeyCardAction || !firstSelectedCardId) return [];
    const idSet = new Set<string>();
    for (const ref of availableKeyRefs) {
      const sel = catalog.cardSelections[ref];
      if (sel?.cardIds && sel.cardIds.includes(firstSelectedCardId)) {
        for (const cid of sel.cardIds) {
          if (cid !== firstSelectedCardId) {
            idSet.add(cid);
          } else {
            const count = sel.cardIds.filter((id) => id === firstSelectedCardId).length;
            if (count > 1) {
              idSet.add(cid);
            }
          }
        }
      }
    }
    return sortCardIdsByHand(Array.from(idSet));
  }, [isTwoKeyCardAction, firstSelectedCardId, availableKeyRefs, catalog.cardSelections, handCards]);

  // 2枚目選択時のハンドラ (既存の keyCardSelectionRef を検索・解決)
  const handleSelectSecondCard = (secondCardId: string) => {
    if (!firstSelectedCardId) return;
    const matchedKeyRef = availableKeyRefs.find((ref) => {
      const sel = catalog.cardSelections[ref];
      if (!sel || !sel.cardIds || sel.cardIds.length !== 2) return false;
      if (firstSelectedCardId === secondCardId) {
        return sel.cardIds[0] === firstSelectedCardId && sel.cardIds[1] === secondCardId;
      }
      return sel.cardIds.includes(firstSelectedCardId) && sel.cardIds.includes(secondCardId);
    });

    if (matchedKeyRef !== undefined) {
      handleSelectKey(matchedKeyRef);
    }
  };

  // 2段階選択のリセットハンドラ
  const handleResetTwoKeySelection = () => {
    setFirstSelectedCardId(null);
    handleSelectKey(undefined);
  };


  // BattleRelationPresenter を Single Source of Truth (SSOT) とし、
  // battleRelationMap が渡されていない場合も BattleRelationPresenter.buildPresentationMap(undefined, request.observation) を呼び出す
  const effectiveBattleRelationMap = useMemo(() => {
    if (battleRelationMap && battleRelationMap.size > 0) {
      return battleRelationMap;
    }
    if (request.observation) {
      return BattleRelationPresenter.buildPresentationMap(undefined, request.observation);
    }
    return new Map<string, UnitBattleDisplayInfo>();
  }, [battleRelationMap, request.observation]);

  // EFFECT_RESOLUTION 時のアタッカー・ブロッカー情報の Observation 照合 & 番号マッピング
  // ※ 独自番号ロジックは一切作らず、BattleRelationPresenter / effectiveBattleRelationMap を SSOT として使用。
  // ※ P1/P2 双方の「①」の曖昧性を除去するため、「自分」「相手」の owner-relative プレフィックスを付与。
  const unitNumberMap = useMemo(() => {
    const map = new Map<string, { badge: string; label: string; fullLabel: string; unitView: any }>();

    // Observation から全フィールドユニットを辞書化 (unitId -> { unit, ownerPlayerKey })
    const allFieldUnits = new Map<string, { unit: any; ownerPlayerKey: string }>();
    if (request.observation?.players && Array.isArray(request.observation.players)) {
      for (const p of request.observation.players) {
        if (p.field && Array.isArray(p.field)) {
          for (const u of p.field) {
            if (u?.unitId) {
              allFieldUnits.set(u.unitId, { unit: u, ownerPlayerKey: p.playerId });
            }
          }
        }
      }
    }

    // catalog.effectSelections に含まれる candidateUnitIds を収集 (カード選択は除外)
    const candidateUnitIds = new Set<string>();
    for (const eff of (catalog.effectSelections || [])) {
      if (eff.selectionType === "card") continue;
      if (eff.selectedValues) {
        for (const uId of eff.selectedValues) {
          if (allFieldUnits.has(uId) || eff.selectionType === "unit" || eff.selectionType === "target") {
            candidateUnitIds.add(uId);
          }
        }
      }
      if (eff.assignments) {
        for (const asgn of eff.assignments) {
          if (asgn.sourceUnitId) candidateUnitIds.add(asgn.sourceUnitId);
          if (asgn.selectedUnitIds) {
            for (const bId of asgn.selectedUnitIds) candidateUnitIds.add(bId);
          }
        }
      }
    }

    const NUMBER_BADGES = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯"];

    // candidateUnitIds それぞれについて、effectiveBattleRelationMap (SSOT) から情報を取得
    const candidateUnitIdList = Array.from(candidateUnitIds);
    candidateUnitIdList.forEach((unitId, index) => {
      const fieldEntry = allFieldUnits.get(unitId);
      const relInfo = effectiveBattleRelationMap.get(unitId);
      const ownerPlayerKey = relInfo?.ownerPlayerKey || fieldEntry?.ownerPlayerKey;
      const isOwner = ownerPlayerKey === request.playerId;

      // プレイヤー表示名の解決 (SSOT: request.observation.players または Player A / Player B)
      const playerObj = request.observation?.players?.find((p) => p.playerId === ownerPlayerKey);
      const playerName = playerObj?.name || (ownerPlayerKey === "p1" ? "Player A" : ownerPlayerKey === "p2" ? "Player B" : "");
      const relationPrefix = ownerPlayerKey ? (isOwner ? "自分" : "相手") : "";
      const playerPrefix = relationPrefix
        ? (playerName ? `${relationPrefix} ${playerName} の` : `${relationPrefix} `)
        : (playerName ? `${playerName} の` : "");

      // バッジ番号: effectiveBattleRelationMap に既存バッジがあれば優先、なければ出現順に決定論的付与
      const badge = relInfo?.badge || NUMBER_BADGES[index] || `[${index + 1}]`;

      const unit = fieldEntry?.unit;
      const unitType = unit?.kind || (unit?.componentId === "character.bulwark" ? "防壁" : "一般兵");

      // 実カード情報の抽出 (秘匿境界 fail-closed を厳守)
      // 相手の伏せカード (face === "down" かつ !isOwner) や visibility === "HIDDEN" は秘匿
      const isFaceDown = unit?.face === "down";
      const isHidden = (!isOwner && isFaceDown) || unit?.cards?.some((c: any) => c.visibility === "HIDDEN");

      let cardStr = "";
      if (!isHidden && unit?.cards && Array.isArray(unit.cards) && unit.cards.length > 0) {
        const formatted = unit.cards
          .map((c: any) => {
            if (c.code) {
              return c.code
                .replace(/S/g, "♠")
                .replace(/H/g, "♥")
                .replace(/D/g, "♦")
                .replace(/C/g, "♣")
                .replace(/♡/g, "♥")
                .replace(/♢/g, "♦");
            }
            if (c.suit) {
              const sym = formatOfficialSuitSymbol(c.suit);
              const rank = c.rank !== undefined ? String(c.rank) : "";
              return `${sym}${rank}`;
            }
            return "";
          })
          .filter(Boolean);
        if (formatted.length > 0) {
          cardStr = formatted.join(", ");
        }
      }

      let humanLabel = relInfo?.humanLabel;
      if (!humanLabel) {
        if (unit?.componentId === "character.bulwark" || unitType === "防壁") {
          const bulwarkPos = relInfo?.bulwarkPosition ? `防壁${relInfo.bulwarkPosition}` : "防壁";
          humanLabel = `${playerPrefix}${bulwarkPos}${cardStr ? `（${cardStr}）` : ""}`;
        } else {
          humanLabel = `${playerPrefix}${unitType}${cardStr ? `（${cardStr}）` : ""}`;
        }
      } else {
        if (!humanLabel.includes("Player") && !humanLabel.includes("自分") && !humanLabel.includes("相手") && playerPrefix) {
          humanLabel = `${playerPrefix}${humanLabel}`;
        }
        if (cardStr && !humanLabel.includes("（") && !humanLabel.includes("(")) {
          humanLabel = `${humanLabel}（${cardStr}）`;
        }
      }

      // label: バッジ＋人間識別名（例: "① Player B の一般兵（♣3）"）
      const label = badge ? `${badge} ${humanLabel}`.trim() : humanLabel.trim();
      const fullLabel = label;

      map.set(unitId, {
        badge,
        label,
        fullLabel,
        unitView: unit,
      });
    });

    return map;
  }, [catalog.effectSelections, request.observation, request.playerId, effectiveBattleRelationMap]);

  // EFFECT_RESOLUTION 用の人間可読パターンリスト
  const humanReadableEffectPatterns = useMemo(() => {
    const rawPatterns = patterns.map((p, idx) => {
      // 順序選択 (p.orderSelectionRef)
      if (p.orderSelectionRef !== undefined && catalog.orderSelections) {
        const ord = catalog.orderSelections[p.orderSelectionRef];
        if (ord) {
          return {
            patternIndex: idx,
            label: ord.summary || "順序選択",
            selectedValues: ord.orderedIds || [],
          };
        }
      }

      const eff = p.effectSelectionRef !== undefined ? catalog.effectSelections[p.effectSelectionRef] : undefined;
      if (!eff) return { patternIndex: idx, label: "効果の選択", selectedValues: [] };

      // 0. カード選択 (selectionType === "card" / 手札破棄等)
      if (eff.selectionType === "card") {
        let label = eff.summary;
        if (!label) {
          const formattedCards = (eff.selectedValues || []).map((val) => formatCardDisplay(val) || val);
          label = `カード選択: ${formattedCards.join(", ")}`;
        }
        // ASCII 短縮コード (s10, hJ, dA, cK 等) が含まれている場合の安全な表示変換 (SSOT: formatCardDisplay / formatOfficialSuitSymbol)
        label = label.replace(/\b([shdcSHDC])(10|[2-9ajqkAJQK])\b/g, (_m, s, r) => `${formatOfficialSuitSymbol(s)}${r.toUpperCase()}`);
        return {
          patternIndex: idx,
          label,
          selectedValues: eff.selectedValues || [],
        };
      }

      // 1. ユニット選択 / 選択肢 (selectedValues)
      if (eff.selectedValues !== undefined) {
        if (eff.selectedValues.length === 0) {
          return { patternIndex: idx, label: "なし (0体)", selectedValues: [] };
        }
        const isUnitSelection = eff.selectedValues.some((val: string) => unitNumberMap.has(val));
        if (isUnitSelection) {
          const unitLabels = eff.selectedValues.map((uId: string) => {
            const info = unitNumberMap.get(uId);
            return info ? info.label : uId;
          });
          const isSingle = eff.selectedValues.length === 1;
          const isAttackerSelection = eff.selectionType === "unit";
          const label = isSingle && isAttackerSelection ? `${unitLabels[0]} のみ` : unitLabels.join(" + ");
          return { patternIndex: idx, label, selectedValues: eff.selectedValues };
        }

        // ユニットIDではないオプション選択 (例: ["charge"], ["drive"] 等)
        const optLabel = eff.summary || eff.selectedValues.join(", ");
        return { patternIndex: idx, label: optLabel, selectedValues: eff.selectedValues };
      }

      // 2. ブロッカー割当て (assignments)
      if (eff.assignments && eff.assignments.length > 0) {
        const asgnStrs = eff.assignments.map((asgn: any) => {
          const srcInfo = unitNumberMap.get(asgn.sourceUnitId);
          const srcLabel = srcInfo ? srcInfo.label : asgn.sourceUnitId;
          if (!asgn.selectedUnitIds || asgn.selectedUnitIds.length === 0) {
            return `${srcLabel} (ブロックなし)`;
          }
          const blkLabels = asgn.selectedUnitIds.map((bId: string) => {
            const bInfo = unitNumberMap.get(bId);
            return bInfo ? bInfo.label : bId;
          });
          return `${srcLabel} ← ${blkLabels.join(" + ")}`;
        });
        return { patternIndex: idx, label: asgnStrs.join(" / "), selectedValues: [] };
      }

      return {
        patternIndex: idx,
        label: eff.summary || "選択肢",
        selectedValues: [],
      };
    });

    // 衝突回避ガード (同一ラベルが複数存在する場合、[1], [2] を自動付与して完全解消)
    const labelCounts = new Map<string, number>();
    for (const item of rawPatterns) {
      labelCounts.set(item.label, (labelCounts.get(item.label) || 0) + 1);
    }
    const hasCollision = Array.from(labelCounts.values()).some((count) => count > 1);
    if (!hasCollision) {
      return rawPatterns;
    }

    const seenIndices = new Map<string, number>();
    return rawPatterns.map((item) => {
      const count = labelCounts.get(item.label) || 0;
      if (count <= 1) {
        return item;
      }
      const currentIndex = (seenIndices.get(item.label) || 0) + 1;
      seenIndices.set(item.label, currentIndex);
      return {
        ...item,
        label: `${item.label} [${currentIndex}]`,
      };
    });
  }, [patterns, catalog, unitNumberMap]);

  // 盤面クリック選択 (selectedUnitIdsFromBoard / lastBoardUnitClick) との連動
  useEffect(() => {
    if (selectedUnitIdsFromBoard && selectedUnitIdsFromBoard.length > 0 && !lastBoardUnitClick) {
      // 従来互換: selectedUnitIdsFromBoard 配列と完全一致する EFFECT_RESOLUTION pattern を検索
      const targetIds = new Set(selectedUnitIdsFromBoard);
      const matchIdx = humanReadableEffectPatterns.findIndex((hp) => {
        if (hp.selectedValues.length !== targetIds.size) return false;
        return hp.selectedValues.every((id) => targetIds.has(id));
      });
      if (matchIdx !== -1) {
        setSelectedEffectPatternRef(matchIdx);
      } else if (request.source?.type === "ACTION_REQUEST" && availableTargetRefs.length > 0) {
        const lastClickedId = selectedUnitIdsFromBoard[selectedUnitIdsFromBoard.length - 1];
        const matchedTargetRef = availableTargetRefs.find(
          (tRef) => catalog.targetSelections[tRef]?.targetUnitId === lastClickedId
        );
        if (matchedTargetRef !== undefined) {
          handleSelectTarget(matchedTargetRef);
        }
      }
    }
  }, [selectedUnitIdsFromBoard, lastBoardUnitClick, humanReadableEffectPatterns, request.source?.type, availableTargetRefs, catalog.targetSelections]);

  // 盤面ユニットタップイベント (lastBoardUnitClick) による ACTION_REQUEST 対象選択 & EFFECT_RESOLUTION 単体/複数ユニット選択
  useEffect(() => {
    if (!lastBoardUnitClick || lastBoardUnitClick.seq === lastProcessedBoardClickSeqRef.current) return;
    lastProcessedBoardClickSeqRef.current = lastBoardUnitClick.seq;
    const clickedUnitId = lastBoardUnitClick.unitId;

    if (request.source?.type === "ACTION_REQUEST") {
      if (selectedActionRef !== null && availableTargetRefs.length > 0) {
        const matchedTargetRef = availableTargetRefs.find(
          (tRef) => catalog.targetSelections[tRef]?.targetUnitId === clickedUnitId
        );
        if (matchedTargetRef !== undefined) {
          handleSelectTarget(matchedTargetRef);
        }
      }
      return;
    }

    if (request.source?.type === "EFFECT_RESOLUTION") {
      const isBlockAssignment = isBlockAssignmentRequest(request);
      if (isBlockAssignment) {
        // BlockAssignmentEditor 側で処理
        return;
      }

      const supportsMultiUnit = humanReadableEffectPatterns.some((hp) => hp.selectedValues.length > 1);
      if (!supportsMultiUnit) {
        // 単一ユニット選択: タップしたユニットを直接選択 (既に選択中なら解除または0体パターン)
        const currentVals =
          selectedEffectPatternRef !== null
            ? humanReadableEffectPatterns[selectedEffectPatternRef]?.selectedValues || []
            : [];
        if (currentVals.length === 1 && currentVals[0] === clickedUnitId) {
          const zeroIdx = humanReadableEffectPatterns.findIndex((hp) => hp.selectedValues.length === 0);
          setSelectedEffectPatternRef(zeroIdx !== -1 ? zeroIdx : null);
        } else {
          const singleIdx = humanReadableEffectPatterns.findIndex(
            (hp) => hp.selectedValues.length === 1 && hp.selectedValues[0] === clickedUnitId
          );
          if (singleIdx !== -1) {
            setSelectedEffectPatternRef(singleIdx);
          }
        }
      } else {
        // 複数ユニット選択 (アタッカー指定等): 現在の選択集合に対して clickedUnitId をトグル
        const currentVals =
          selectedEffectPatternRef !== null
            ? humanReadableEffectPatterns[selectedEffectPatternRef]?.selectedValues || []
            : [];
        const nextSet = new Set(currentVals);
        if (nextSet.has(clickedUnitId)) {
          nextSet.delete(clickedUnitId);
        } else {
          nextSet.add(clickedUnitId);
        }
        if (nextSet.size === 0) {
          const zeroIdx = humanReadableEffectPatterns.findIndex((hp) => hp.selectedValues.length === 0);
          setSelectedEffectPatternRef(zeroIdx !== -1 ? zeroIdx : null);
        } else {
          const matchIdx = humanReadableEffectPatterns.findIndex((hp) => {
            if (hp.selectedValues.length !== nextSet.size) return false;
            return hp.selectedValues.every((id) => nextSet.has(id));
          });
          if (matchIdx !== -1) {
            setSelectedEffectPatternRef(matchIdx);
          }
        }
      }
    }
  }, [
    lastBoardUnitClick,
    request.source?.type,
    selectedActionRef,
    availableTargetRefs,
    catalog.targetSelections,
    catalog.effectSelections,
    humanReadableEffectPatterns,
    selectedEffectPatternRef,
  ]);

  // 盤面マーカー（①, ②）と選択状態の通知 (EFFECT_RESOLUTION および ACTION_REQUEST のユニット対象選択に対応)
  useEffect(() => {
    if (!onSelectionMarkersChange) return;

    const markers = new Map<string, { badge: string; isSelected: boolean }>();
    const NUMBER_BADGES = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯"];

    if (request.source?.type === "EFFECT_RESOLUTION" || request.source?.type === "ZONE_TOP_SELECTION") {
      const isBlockAssignment = isBlockAssignmentRequest(request);
      if (isBlockAssignment) {
        const assignedBlockerIds = new Set<string>();
        if (blockAssignmentsDraft) {
          for (const bList of Object.values(blockAssignmentsDraft)) {
            for (const bId of bList) assignedBlockerIds.add(bId);
          }
        }
        unitNumberMap.forEach((info, unitId) => {
          markers.set(unitId, {
            badge: info.badge,
            isSelected: assignedBlockerIds.has(unitId),
          });
        });
      } else {
        const currentSelectedPattern =
          selectedEffectPatternRef !== null ? humanReadableEffectPatterns[selectedEffectPatternRef] : undefined;
        const currentSelectedValues = new Set(currentSelectedPattern?.selectedValues || []);

        unitNumberMap.forEach((info, unitId) => {
          markers.set(unitId, {
            badge: info.badge,
            isSelected: currentSelectedValues.has(unitId),
          });
        });
      }
    } else if (request.source?.type === "ACTION_REQUEST" && selectedActionRef !== null && availableTargetRefs.length > 0) {
      let unitBadgeIdx = 0;
      for (const targetRef of availableTargetRefs) {
        const target = catalog.targetSelections[targetRef];
        if (target?.targetUnitId) {
          const relInfo = effectiveBattleRelationMap.get(target.targetUnitId);
          const badge = relInfo?.badge || NUMBER_BADGES[unitBadgeIdx] || `[${unitBadgeIdx + 1}]`;
          unitBadgeIdx++;
          markers.set(target.targetUnitId, {
            badge,
            isSelected: selectedTargetRef === targetRef,
          });
        }
      }
    }

    onSelectionMarkersChange(markers);
  }, [
    request.source?.type,
    catalog.effectSelections,
    catalog.targetSelections,
    unitNumberMap,
    selectedEffectPatternRef,
    humanReadableEffectPatterns,
    blockAssignmentsDraft,
    selectedActionRef,
    availableTargetRefs,
    selectedTargetRef,
    effectiveBattleRelationMap,
    onSelectionMarkersChange,
  ]);

  // パターン一致検索 (未選択の必須項目がある場合は null を返し提出不可とする)
  const finalMatchedPatternIndex = useMemo(() => {
    if (selectedActionRef === null) return null;

    // 1. キーカードの解決
    let resolvedKeyRef: number | undefined;
    if (availableKeyRefs.length === 0) {
      resolvedKeyRef = undefined;
    } else if (availableKeyRefs.length === 1) {
      resolvedKeyRef = selectedKeyRef ?? availableKeyRefs[0];
    } else {
      if (selectedKeyRef === null) return null; // 複数候補あり未選択
      resolvedKeyRef = selectedKeyRef;
    }

    // 2. コストの解決
    let resolvedCostRef: number | undefined;
    if (availableCostRefs.length === 0) {
      resolvedCostRef = undefined;
    } else if (availableCostRefs.length === 1) {
      resolvedCostRef = selectedCostRef ?? availableCostRefs[0];
    } else {
      if (selectedCostRef === null) return null; // 複数候補あり未選択
      resolvedCostRef = selectedCostRef;
    }

    // 3. 対象の解決
    let resolvedTargetRef: number | undefined;
    if (availableTargetRefs.length === 0) {
      resolvedTargetRef = undefined;
    } else if (availableTargetRefs.length === 1) {
      resolvedTargetRef = selectedTargetRef ?? availableTargetRefs[0];
    } else {
      if (selectedTargetRef === null) return null; // 複数候補あり未選択
      resolvedTargetRef = selectedTargetRef;
    }

    const idx = patterns.findIndex((p) => {
      if (p.actionSelectionRef !== selectedActionRef) return false;
      if (p.keyCardSelectionRef !== resolvedKeyRef) return false;
      if (p.costPaymentRef !== resolvedCostRef) return false;
      if (p.targetSelectionRef !== resolvedTargetRef) return false;
      return true;
    });

    return idx !== -1 ? idx : null;
  }, [
    patterns,
    selectedActionRef,
    availableKeyRefs,
    selectedKeyRef,
    availableCostRefs,
    selectedCostRef,
    availableTargetRefs,
    selectedTargetRef,
  ]);

  const selectedAction = selectedActionRef !== null ? catalog.actions[selectedActionRef] : null;
  const selectedKey = selectedKeyRef !== null ? catalog.cardSelections[selectedKeyRef] : null;
  const selectedCost = selectedCostRef !== null ? catalog.costPayments[selectedCostRef] : null;
  const selectedTarget = selectedTargetRef !== null ? catalog.targetSelections[selectedTargetRef] : null;

  const needsKeySelection = availableKeyRefs.length > 1 && selectedKeyRef === null;
  const needsCostSelection = availableCostRefs.length > 1 && selectedCostRef === null;
  const needsTargetSelection = availableTargetRefs.length > 1 && selectedTargetRef === null;

  const nextGuidance = useMemo(() => {
    if (selectedActionRef === null) {
      return "アクションを選択してください";
    }
    if (needsKeySelection) {
      return "キーカードを選択してください";
    }
    if (needsCostSelection) {
      return "コストの支払い方法を選択してください";
    }
    if (needsTargetSelection) {
      return "対象（ターゲット）を選択してください";
    }
    if (finalMatchedPatternIndex !== null && finalMatchedPatternIndex !== -1) {
      return "設定完了：決定ボタンまたはEnterで送信できます";
    }
    return "";
  }, [selectedActionRef, needsKeySelection, needsCostSelection, needsTargetSelection, finalMatchedPatternIndex]);

  const handleActionSubmit = (autoPass: boolean = false) => {
    if (finalMatchedPatternIndex === null || finalMatchedPatternIndex === -1) return;
    if (isSubmittedRef.current) return;
    isSubmittedRef.current = true;
    onSubmit(
      {
        decisionId: request.decisionId,
        stateVersion: request.stateVersion,
        selectedPatternRef: finalMatchedPatternIndex,
      },
      { autoPass }
    );
  };

  const handleEffectSubmit = () => {
    if (selectedEffectPatternRef === null) return;
    if (isSubmittedRef.current) return;
    isSubmittedRef.current = true;
    onSubmit({
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: selectedEffectPatternRef,
    });
  };

  const passPatternIndex = patterns.findIndex((p) => p.kind === "PASS");
  const handlePass = () => {
    if (passPatternIndex === -1) return;
    if (isSubmittedRef.current) return;
    isSubmittedRef.current = true;
    onSubmit({
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: passPatternIndex,
    });
  };

  // キーボードショートカット (Enter: 決定 / Shift+Enter: リクエストのみ)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      if (isSubmittedRef.current) return;

      // 1. IME composition check
      if (e.isComposing || (e as any).keyCode === 229) return;

      // 2. Repeat check (長押し repeat submit 防止)
      if (e.repeat) return;

      // 3. Modifier key check: only Shift is allowed for Shift+Enter; Ctrl, Alt, Meta are forbidden
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // 4. Input target check (input, textarea, select, contentEditable)
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable) {
          return;
        }
      }

      if (e.key === "Enter") {
        const isEffectOrZoneTop =
          request.source?.type === "EFFECT_RESOLUTION" || request.source?.type === "ZONE_TOP_SELECTION";

        if (!isEffectOrZoneTop) {
          // ACTION_REQUEST
          if (finalMatchedPatternIndex !== null && finalMatchedPatternIndex !== -1) {
            const isImmediate = selectedAction?.speed === "immediate";
            if (isImmediate) {
              e.preventDefault();
              handleActionSubmit(false);
            } else {
              if (e.shiftKey) {
                e.preventDefault();
                handleActionSubmit(false);
              } else {
                e.preventDefault();
                handleActionSubmit(true);
              }
            }
          }
        } else {
          // EFFECT_RESOLUTION / ZONE_TOP_SELECTION
          const isBlockAssignment = isBlockAssignmentRequest(request);
          if (isBlockAssignment) {
            if (selectedBlockPatternRef !== null) {
              e.preventDefault();
              if (!isSubmittedRef.current) {
                isSubmittedRef.current = true;
                onSubmit({
                  decisionId: request.decisionId,
                  stateVersion: request.stateVersion,
                  selectedPatternRef: selectedBlockPatternRef,
                });
              }
            }
          } else {
            if (selectedEffectPatternRef !== null) {
              e.preventDefault();
              handleEffectSubmit();
            }
          }
        }
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [
    disabled,
    request.decisionId,
    request.stateVersion,
    request.source?.type,
    finalMatchedPatternIndex,
    selectedAction?.speed,
    selectedEffectPatternRef,
    selectedBlockPatternRef,
    catalog.effectSelections,
    onSubmit,
  ]);

  // EFFECT_RESOLUTION / ZONE_TOP_SELECTION 時の UI
  if (request.source?.type === "EFFECT_RESOLUTION" || request.source?.type === "ZONE_TOP_SELECTION") {
    const isZoneTopSelection = request.source?.type === "ZONE_TOP_SELECTION";
    const isBlockAssignment = isBlockAssignmentRequest(request);
    const isCardSelection = (catalog.effectSelections || []).some(
      (eff) => eff.selectionType === "card"
    );
    const isUnitSelection =
      !isCardSelection &&
      (catalog.effectSelections || []).some(
        (eff) =>
          (eff.selectedValues && eff.selectedValues.some((v: string) => unitNumberMap.has(v))) ||
          eff.selectionType === "target" ||
          eff.selectionType === "unit"
      );

    const headerTitle = isZoneTopSelection
      ? "墓地TOPを選択"
      : isBlockAssignment
      ? "ブロッカー指定"
      : isUnitSelection
      ? "対象ユニットを選択"
      : "効果を選択";

    const guideLabel = isUnitSelection
      ? "対象ユニットを選択（盤面をタップまたは下記から選択）:"
      : "選択肢（盤面をタップまたは下記から選択）:";

    return (
      <div
        data-testid="decision-panel"
        className="flex flex-col max-h-full min-h-0 rounded border border-zinc-200 bg-white p-2 sm:p-2.5 text-zinc-950 shadow-sm font-sans"
      >
        <div
          data-testid="decision-panel-header"
          className="sticky top-0 z-10 bg-white flex items-center justify-between border-b border-zinc-200 pb-1.5 mb-2 shrink-0"
        >
          <div>
            <span className="inline-block rounded bg-zinc-950 text-white px-1.5 py-0.2 text-[10px] font-mono font-black uppercase tracking-wider">
              {isZoneTopSelection ? "ZONE TOP SELECTION" : "EFFECT SELECTION"}
            </span>
            <h2 className="text-sm font-bold text-zinc-950 mt-0.5 tracking-wide">
              {request.playerId === "p1" ? "Player A" : "Player B"} の{headerTitle}
            </h2>
          </div>

          {onUndo && (
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title={canUndo ? "直前の操作を取り消します" : "戻せる操作はありません"}
              aria-label="1つ前の判断に戻る"
              className="rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white px-2.5 py-1 text-xs font-mono font-bold text-zinc-700 transition active:scale-95 shadow-sm flex items-center gap-1 shrink-0"
            >
              <span>↶</span>
              <span>1つ戻る</span>
            </button>
          )}
        </div>

        <div
          data-testid="decision-panel-scroll-body"
          className="flex-1 min-h-0 overflow-y-auto lg:max-h-[46vh] pr-1"
        >
          {isBlockAssignment ? (
            <BlockAssignmentEditor
              request={request}
              onSelectPattern={(patternRef) => {
                if (isSubmittedRef.current) return;
                isSubmittedRef.current = true;
                onSubmit({
                  decisionId: request.decisionId,
                  stateVersion: request.stateVersion,
                  selectedPatternRef: patternRef,
                });
              }}
              unitNumberMap={unitNumberMap}
              onExactPatternRefChange={setSelectedBlockPatternRef}
              initialAssignments={blockAssignmentsDraft}
              onAssignmentsChange={setBlockAssignmentsDraft}
              lastBoardUnitClick={lastBoardUnitClick}
            />
          ) : (
            <div className="space-y-2">
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">
                {guideLabel}
              </label>

              <div className="grid grid-cols-1 gap-1.5">
                {humanReadableEffectPatterns.map((hp, idx) => {
                  const isSelected = selectedEffectPatternRef === idx;
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedEffectPatternRef(idx)}
                      className={`rounded border p-2 text-left transition flex items-center justify-between ${
                        isSelected
                          ? "border-zinc-950 bg-zinc-950 text-white shadow ring-1 ring-zinc-950"
                          : "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500 hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-mono">
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                            isSelected
                              ? "bg-white border-zinc-900 text-zinc-950 font-black"
                              : "border-zinc-400 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="font-bold text-xs leading-snug">
                          <RichCardText text={hp.label} />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 常時固定フッター: 決定ボタン + ショートカット操作ガイド */}
        <div
          data-testid="decision-panel-sticky-footer"
          className="shrink-0 sticky bottom-0 z-10 bg-white pt-1.5 mt-1.5 border-t border-zinc-200"
        >
          {!isBlockAssignment && selectedEffectPatternRef !== null && (
            <div className="pb-1.5 mb-1.5 border-b border-zinc-200 flex items-center justify-between gap-2">
              <div className="text-xs text-zinc-600 font-mono truncate">
                選択中:{" "}
                <span className="font-bold text-zinc-950">
                  <RichCardText text={humanReadableEffectPatterns[selectedEffectPatternRef]?.label || ""} />
                </span>
              </div>
              <button
                onClick={handleEffectSubmit}
                className="py-1.5 px-4 rounded bg-zinc-950 hover:bg-zinc-800 active:scale-95 text-white font-bold shadow transition text-xs shrink-0 font-mono"
              >
                決定して解決する
              </button>
            </div>
          )}

          <div className="text-[10px] text-zinc-500 font-mono flex items-center justify-between">
            <span className="flex items-center gap-1.5 flex-wrap">
              <span>SHORTCUT:</span>
              <span>
                <strong className="text-zinc-950 bg-zinc-100 px-1 py-0.2 rounded border border-zinc-300">Enter</strong> = {isBlockAssignment ? "この割当てで決定" : "決定して解決する"}
              </span>
            </span>
            <span className="text-zinc-400 shrink-0">BlackPoker Core Battle</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="decision-panel"
      className="flex flex-col max-h-full min-h-0 rounded border border-zinc-200 bg-white p-2 sm:p-2.5 text-zinc-950 shadow-sm font-sans"
    >
      {/* ヘッダー (常時上部固定: 1つ戻る / PASS [P]) */}
      <div
        data-testid="decision-panel-header"
        className="sticky top-0 z-10 bg-white flex items-center justify-between border-b border-zinc-200 pb-1.5 mb-2 shrink-0"
      >
        <div>
          <div className="flex items-center gap-1.5 font-mono">
            <span className="inline-block rounded bg-zinc-100 border border-zinc-300 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-zinc-700">
              DECISION
            </span>
            <span className="inline-block rounded bg-zinc-50 border border-zinc-200 text-zinc-500 px-1.5 py-0.2 text-[10px] font-bold">
              未リクエスト
            </span>
          </div>
          <h2 className="text-sm font-bold text-zinc-950 mt-0.5 tracking-wide">
            {request.playerId === "p1" ? "Player A" : "Player B"} の行動選択
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {onUndo && (
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title={canUndo ? "直前の操作を取り消します" : "戻せる操作はありません"}
              aria-label="1つ前の判断に戻る"
              className="rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white px-2.5 py-1 text-xs font-mono font-bold text-zinc-700 transition active:scale-95 shadow-sm flex items-center gap-1"
            >
              <span>↶</span>
              <span>1つ戻る</span>
            </button>
          )}

          {passPatternIndex !== -1 && (
            <button
              onClick={handlePass}
              title="Pキーを押してもPASSできます"
              className="rounded border border-zinc-300 bg-white hover:bg-zinc-100 px-3 py-1 text-xs font-mono font-bold text-zinc-950 transition active:scale-95 shadow-sm"
            >
              <span>PASS [P]</span>
            </button>
          )}
        </div>
      </div>

      {/* 判断選択スクロール領域 (1.アクション / 2.キーカード / 3.コスト / 4.対象) */}
      <div
        data-testid="decision-panel-scroll-body"
        className="flex-1 min-h-0 overflow-y-auto lg:max-h-[46vh] pr-1 space-y-2"
      >
        {/* 選択状況 & 未設定項目の明示バナー */}
        {selectedAction && (
          <div className="p-2 bg-zinc-50 rounded border border-zinc-200 text-[11px] font-mono text-zinc-800 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-zinc-950 bg-zinc-200/80 px-1.5 py-0.5 rounded font-serif">
                {selectedAction.actionName || selectedAction.actionId}
              </span>

              {/* キーカード状況 */}
              {availableKeyRefs.length > 0 && (
                <span className="flex items-center gap-1">
                  <span className="text-zinc-500">Key:</span>
                  {selectedKey ? (
                    <span className="font-bold text-zinc-950 bg-white border border-zinc-300 px-1 py-0.5 rounded">
                      <RichCardText text={selectedKey.displayCodes.join("+")} />
                    </span>
                  ) : availableKeyRefs.length === 1 ? (
                    <span className="font-bold text-zinc-950 bg-white border border-zinc-300 px-1 py-0.5 rounded">
                      <RichCardText text={catalog.cardSelections[availableKeyRefs[0]]?.displayCodes.join("+") || "自動選択"} />
                    </span>
                  ) : (
                    <span className="font-bold text-amber-700 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded">
                      未選択 (必須)
                    </span>
                  )}
                </span>
              )}

              {/* コスト状況 */}
              {availableCostRefs.length > 0 && (
                <span className="flex items-center gap-1">
                  <span className="text-zinc-500">Cost:</span>
                  {selectedCost ? (
                    <span className="font-bold text-zinc-950 bg-white border border-zinc-300 px-1 py-0.5 rounded">
                      <RichCardText text={selectedCost.summary} />
                    </span>
                  ) : availableCostRefs.length === 1 ? (
                    <span className="font-bold text-zinc-950 bg-white border border-zinc-300 px-1 py-0.5 rounded">
                      <RichCardText text={catalog.costPayments[availableCostRefs[0]]?.summary || "自動選択"} />
                    </span>
                  ) : (
                    <span className="font-bold text-amber-700 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded">
                      未選択 (必須)
                    </span>
                  )}
                </span>
              )}

              {/* 対象状況 */}
              {availableTargetRefs.length > 0 && (
                <span className="flex items-center gap-1">
                  <span className="text-zinc-500">Target:</span>
                  {selectedTarget ? (
                    <span className="font-bold text-zinc-950 bg-white border border-zinc-300 px-1 py-0.5 rounded">
                      <RichCardText text={selectedTarget.displayName} />
                    </span>
                  ) : availableTargetRefs.length === 1 ? (
                    <span className="font-bold text-zinc-950 bg-white border border-zinc-300 px-1 py-0.5 rounded">
                      <RichCardText text={catalog.targetSelections[availableTargetRefs[0]]?.displayName || "自動選択"} />
                    </span>
                  ) : (
                    <span className="font-bold text-amber-700 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded">
                      未選択 (必須)
                    </span>
                  )}
                </span>
              )}
            </div>

            {/* 次の誘導メッセージ */}
            {nextGuidance && (
              <div
                className={`text-[10px] font-bold ${
                  finalMatchedPatternIndex !== null && finalMatchedPatternIndex !== -1
                    ? "text-emerald-700"
                    : "text-amber-800"
                }`}
              >
                {nextGuidance}
              </div>
            )}
          </div>
        )}

        {/* ステップ1: アクション選択 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">
              1. アクション
            </label>
            {selectedActionRef !== null && !isActionListExpanded && (
              <button
                type="button"
                onClick={() => setIsActionListExpanded(true)}
                className="text-[10px] font-mono font-bold text-zinc-600 hover:text-zinc-950 underline px-1 py-0.5"
              >
                変更する
              </button>
            )}
            {selectedActionRef !== null && isActionListExpanded && (
              <button
                type="button"
                onClick={() => setIsActionListExpanded(false)}
                className="text-[10px] font-mono font-bold text-zinc-600 hover:text-zinc-950 underline px-1 py-0.5"
              >
                折りたたむ
              </button>
            )}
          </div>

          {/* アクション選択後のコンパクト表示 (選択中かつ折りたたみ時) */}
          {selectedActionRef !== null && !isActionListExpanded && (
            <div className="flex items-center justify-between p-1.5 sm:p-2 rounded border border-zinc-950 bg-zinc-950 text-white shadow-sm mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 uppercase shrink-0">
                  選択中
                </span>
                <span className="font-bold text-xs font-serif truncate">
                  {selectedAction?.actionName || selectedAction?.actionId}
                </span>
                <span className="text-[11px] font-mono text-zinc-300 truncate">
                  {selectedAction?.timing ? `[${selectedAction.timing}]` : ""} {selectedAction?.cost ? `Cost: ${selectedAction.cost}` : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsActionListExpanded(true)}
                className="ml-2 px-2.5 py-1 text-xs font-mono font-bold bg-white text-zinc-950 hover:bg-zinc-200 rounded transition active:scale-95 shrink-0"
                aria-label="アクションを変更する"
              >
                変更する
              </button>
            </div>
          )}

          {/* 全アクション一覧グリッド (未選択時または展開時に表示、選択済かつ折りたたみ時は hidden) */}
          <div
            className={`grid grid-cols-2 gap-1.5 ${
              selectedActionRef !== null && !isActionListExpanded ? "hidden" : ""
            }`}
          >
            {availableActionRefs.map((actRef) => {
              const act = catalog.actions[actRef];
              const isSelected = selectedActionRef === actRef;
              return (
                <button
                  key={actRef}
                  onClick={() => {
                    handleSelectAction(actRef);
                    setIsActionListExpanded(false);
                  }}
                  className={`rounded border p-1.5 sm:p-2 text-left transition ${
                    isSelected
                      ? "border-zinc-950 bg-zinc-950 text-white shadow ring-1 ring-zinc-950"
                      : "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500 hover:bg-zinc-50"
                  }`}
                >
                  <div className="font-bold text-xs font-serif">{act.actionName || act.actionId}</div>
                  <div className={`text-[11px] mt-0.5 font-mono ${isSelected ? "text-zinc-200" : "text-zinc-600"}`}>
                    {act.timing ? `[${act.timing}]` : ""} {act.cost ? `Cost: ${act.cost}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ステップ2: キーカード選択 */}
        {selectedActionRef !== null && availableKeyRefs.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">
                2. キーカード（任意）
                {needsKeySelection && (
                  <span className="text-amber-700 font-bold ml-1.5">[要選択]</span>
                )}
              </label>
              {isTwoKeyCardAction && (selectedKeyRef !== null || firstSelectedCardId !== null) && (
                <button
                  type="button"
                  onClick={handleResetTwoKeySelection}
                  className="text-[10px] font-mono font-bold text-zinc-600 hover:text-zinc-950 underline px-1 py-0.5"
                >
                  選択し直す
                </button>
              )}
            </div>

            {isTwoKeyCardAction ? (
              <div className="space-y-2 rounded border border-zinc-200 bg-zinc-50/50 p-2">
                {selectedKeyRef !== null && selectedKey ? (
                  // ペア確定状態
                  <div className="flex items-center justify-between gap-2 p-1.5 bg-white rounded border border-zinc-300 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-zinc-500">確定ペア:</span>
                      <div className="flex items-center gap-1 font-mono font-bold text-xs text-zinc-950">
                        {selectedKey.cardIds.map((cid, i) => {
                          const info = getCardInfo(cid);
                          return (
                            <React.Fragment key={cid}>
                              {i > 0 && <span className="text-zinc-400 font-bold">+</span>}
                              {info.card ? (
                                <CardView card={info.card} size="sm" compact={true} />
                              ) : (
                                <span className="px-1.5 py-0.5 rounded border border-zinc-200 bg-zinc-100">
                                  <RichCardText text={info.displayCode} />
                                </span>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetTwoKeySelection}
                      className="px-2.5 py-1 text-xs font-mono font-bold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded border border-zinc-300 transition shrink-0 active:scale-95"
                    >
                      変更
                    </button>
                  </div>
                ) : firstSelectedCardId !== null ? (
                  // 1枚目選択済み、2枚目選択待ち
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">1枚目:</span>
                        {(() => {
                          const info = getCardInfo(firstSelectedCardId);
                          return info.card ? (
                            <CardView card={info.card} size="sm" compact={true} />
                          ) : (
                            <span className="font-bold text-zinc-950 px-1.5 py-0.5 rounded border border-zinc-200 bg-white">
                              <RichCardText text={info.displayCode} />
                            </span>
                          );
                        })()}
                        <span className="text-[10px] text-zinc-400 font-bold">→ 2枚目を選択</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFirstSelectedCardId(null)}
                        className="text-[10px] text-zinc-500 hover:text-zinc-900 underline"
                      >
                        取消
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {step2CardIds.map((cid) => {
                        const info = getCardInfo(cid);
                        return (
                          <button
                            key={cid}
                            type="button"
                            onClick={() => handleSelectSecondCard(cid)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-1 rounded border border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50 active:scale-95 transition shadow-sm"
                            aria-label={`2枚目として ${info.displayCode} を選択`}
                          >
                            {info.card ? (
                              <CardView card={info.card} size="sm" compact={true} />
                            ) : (
                              <span className="font-mono font-bold text-xs px-1">
                                <RichCardText text={info.displayCode} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  // 1枚目未選択
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-mono font-bold text-zinc-500">
                      1枚目のキーカードを選択してください:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {step1CardIds.map((cid) => {
                        const info = getCardInfo(cid);
                        return (
                          <button
                            key={cid}
                            type="button"
                            onClick={() => setFirstSelectedCardId(cid)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-1 rounded border border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50 active:scale-95 transition shadow-sm"
                            aria-label={`1枚目として ${info.displayCode} を選択`}
                          >
                            {info.card ? (
                              <CardView card={info.card} size="sm" compact={true} />
                            ) : (
                              <span className="font-mono font-bold text-xs px-1">
                                <RichCardText text={info.displayCode} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // 従来の一覧表示 (1枚Key Card または混在時)
              <div className="grid grid-cols-3 gap-1.5">
                {availableKeyRefs.map((keyRef) => {
                  const keySel = catalog.cardSelections[keyRef];
                  const isSelected = selectedKeyRef === keyRef;
                  return (
                    <button
                      key={keyRef}
                      onClick={() => handleSelectKey(keyRef)}
                      className={`min-h-[40px] rounded border p-1 sm:p-1.5 text-center transition ${
                        isSelected
                          ? "border-zinc-950 bg-zinc-950 text-white shadow ring-1 ring-zinc-950"
                          : "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500 hover:bg-zinc-50"
                      }`}
                    >
                      <div className="font-mono font-bold text-xs">
                        <RichCardText text={keySel?.displayCodes ? keySel.displayCodes.join("+") : ""} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ステップ3: コスト支払い選択 */}
        {selectedActionRef !== null && availableCostRefs.length > 0 && (
          <div>
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 mb-1">
              3. コスト支払い
              {needsCostSelection && (
                <span className="text-amber-700 font-bold ml-1.5">[要選択]</span>
              )}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {availableCostRefs.map((costRef) => {
                const costSel = catalog.costPayments[costRef];
                const isSelected = selectedCostRef === costRef;
                return (
                  <button
                    key={costRef}
                    onClick={() => handleSelectCost(costRef)}
                    className={`rounded border p-1 sm:p-1.5 text-left transition ${
                      isSelected
                        ? "border-zinc-950 bg-zinc-950 text-white shadow ring-1 ring-zinc-950"
                        : "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500 hover:bg-zinc-50"
                    }`}
                  >
                    <div className="font-mono font-bold text-xs">
                      <RichCardText text={costSel ? formatCostPaymentDisplay(costSel, request, battleRelationMap) : ""} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ステップ4: ターゲット選択 */}
        {selectedActionRef !== null && availableTargetRefs.length > 0 && (
          <div>
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 mb-1">
              4. 対象（ターゲット）
              {needsTargetSelection && (
                <span className="text-amber-700 font-bold ml-1.5">[要選択]</span>
              )}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {availableTargetRefs.map((targetRef) => {
                const target = catalog.targetSelections[targetRef];
                const isSelected = selectedTargetRef === targetRef;
                return (
                  <button
                    key={targetRef}
                    onClick={() => handleSelectTarget(targetRef)}
                    onMouseEnter={() => {
                      if (target?.targetRequestId) onHighlightRequest?.(target.targetRequestId);
                    }}
                    onMouseLeave={() => {
                      const current = selectedTargetRef !== null ? catalog.targetSelections?.[selectedTargetRef] : null;
                      onHighlightRequest?.(current?.targetRequestId);
                    }}
                    className={`rounded p-1.5 sm:p-2 text-left transition flex flex-col justify-center ${
                      isSelected
                        ? "border-2 border-zinc-950 ring-1 ring-zinc-950 bg-zinc-100 text-zinc-950 shadow-sm"
                        : "border border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500 hover:bg-zinc-50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-bold text-xs leading-snug">
                        <RichCardText text={target?.primaryLabel || target?.displayName || ""} />
                      </span>
                      {isSelected && (
                        <span className="text-[9px] font-mono font-bold px-1 rounded bg-zinc-950 text-white shrink-0 ml-1">
                          SELECTED
                        </span>
                      )}
                    </div>
                    {target?.secondaryLabel && (
                      <span
                        className={`text-[10px] font-mono leading-tight mt-0.5 ${
                          isSelected ? "text-zinc-700 font-medium" : "text-zinc-500"
                        }`}
                      >
                        <RichCardText text={target.secondaryLabel} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 常時固定フッター: 決定ボタン (リクエスト / リクエスト＆PASS) + ショートカット操作ガイド */}
      <div
        data-testid="decision-panel-sticky-footer"
        className="shrink-0 sticky bottom-0 z-10 bg-white pt-1.5 mt-1.5 border-t border-zinc-200"
      >
        <div className="pb-1.5 mb-1.5 border-b border-zinc-200 flex flex-col sm:flex-row gap-1.5">
          {selectedAction?.speed === "immediate" ? (
            <button
              onClick={() => handleActionSubmit(false)}
              disabled={disabled || finalMatchedPatternIndex === null || finalMatchedPatternIndex === -1}
              className="w-full min-h-[36px] py-1.5 sm:py-2 px-3 sm:px-4 rounded bg-zinc-950 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-950 disabled:cursor-not-allowed text-white font-bold transition text-xs sm:text-sm shadow-sm flex items-center justify-center gap-1 font-mono leading-snug"
            >
              <span>リクエスト</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => handleActionSubmit(false)}
                disabled={disabled || finalMatchedPatternIndex === null || finalMatchedPatternIndex === -1}
                className="flex-1 min-h-[36px] py-1.5 sm:py-2 px-2.5 sm:px-3 rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed text-zinc-900 font-bold transition text-xs sm:text-sm shadow-sm flex items-center justify-center gap-1 font-mono leading-snug"
              >
                <span>リクエストのみ</span>
              </button>
              <button
                onClick={() => handleActionSubmit(true)}
                disabled={disabled || finalMatchedPatternIndex === null || finalMatchedPatternIndex === -1}
                className="flex-1 min-h-[36px] py-1.5 sm:py-2 px-2.5 sm:px-3 rounded bg-zinc-950 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-950 disabled:cursor-not-allowed active:scale-95 text-white font-bold transition text-xs sm:text-sm shadow-sm flex items-center justify-center gap-1 font-mono leading-snug"
              >
                <span>リクエスト＆PASS (推奨)</span>
              </button>
            </>
          )}
        </div>

        {/* ショートカット操作ガイド */}
        <div className="text-[9px] text-zinc-500 font-mono flex items-center justify-between">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span>SHORTCUT:</span>
            <span>
              <strong className="text-zinc-950 bg-zinc-100 px-1 py-0.2 rounded border border-zinc-300">P</strong> = PASS
            </span>
            <span>
              <strong className="text-zinc-950 bg-zinc-100 px-1 py-0.2 rounded border border-zinc-300">Enter</strong> = {selectedAction?.speed === "immediate" ? "リクエスト" : "決定 (リクエスト＆PASS)"}
            </span>
            {selectedAction && selectedAction.speed !== "immediate" && (
              <span>
                <strong className="text-zinc-950 bg-zinc-100 px-1 py-0.2 rounded border border-zinc-300">Shift+Enter</strong> = リクエストのみ
              </span>
            )}
          </span>
          <span className="text-zinc-400 shrink-0">BlackPoker Core Battle</span>
        </div>
      </div>
    </div>
  );


};

