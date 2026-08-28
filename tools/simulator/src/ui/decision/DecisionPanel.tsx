import React, { useState, useMemo, useEffect } from "react";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PatternExpander } from "../../engine/decision/PatternExpander";
import { formatCardDisplay, formatCardList } from "../../engine/rules/cardUtils";
import { BlockAssignmentEditor } from "./BlockAssignmentEditor";

export interface DecisionPanelProps {
  readonly request: DecisionRequest;
  readonly onSubmit: (response: DecisionResponse, options?: { autoPass?: boolean }) => void;
  readonly onCancel?: () => void;
  readonly onSelectionMarkersChange?: (markers: Map<string, { badge: string; isSelected: boolean }>) => void;
  readonly selectedUnitIdsFromBoard?: string[];
}

export const DecisionPanel: React.FC<DecisionPanelProps> = ({
  request,
  onSubmit,
  onSelectionMarkersChange,
  selectedUnitIdsFromBoard,
}) => {
  const catalog = request.catalog;
  const patterns = request.patterns;

  // 選択状態
  const [selectedActionRef, setSelectedActionRef] = useState<number | null>(null);
  const [selectedKeyRef, setSelectedKeyRef] = useState<number | null>(null);
  const [selectedCostRef, setSelectedCostRef] = useState<number | null>(null);
  const [selectedTargetRef, setSelectedTargetRef] = useState<number | null>(null);
  const [selectedEffectPatternRef, setSelectedEffectPatternRef] = useState<number | null>(null);

  // decisionId 切替時の選択状態リセット (Defense-in-depth)
  useEffect(() => {
    setSelectedActionRef(null);
    setSelectedKeyRef(null);
    setSelectedCostRef(null);
    setSelectedTargetRef(null);
    setSelectedEffectPatternRef(null);
  }, [request.decisionId]);

  // 1. 選択可能なアクション一覧
  const availableActionRefs = useMemo(() => {
    const refs = new Set<number>();
    for (const p of patterns) {
      if (p.actionSelectionRef !== undefined) refs.add(p.actionSelectionRef);
    }
    return Array.from(refs);
  }, [patterns]);

  // 2. 選択中アクションで絞り込まれたパターン
  const patternsFilteredByAction = useMemo(() => {
    if (selectedActionRef === null) return [];
    return patterns.filter((p) => p.actionSelectionRef === selectedActionRef);
  }, [patterns, selectedActionRef]);

  // 選択可能なキーカード一覧
  const availableKeyRefs = useMemo(() => {
    const refs = new Set<number | undefined>();
    for (const p of patternsFilteredByAction) {
      refs.add(p.keyCardSelectionRef);
    }
    return Array.from(refs);
  }, [patternsFilteredByAction]);

  // 3. 選択中アクション + キーカードで絞り込まれたパターン
  const patternsFilteredByKey = useMemo(() => {
    return patternsFilteredByAction.filter((p) => {
      if (selectedKeyRef === null) {
        return p.keyCardSelectionRef === undefined;
      }
      return p.keyCardSelectionRef === selectedKeyRef;
    });
  }, [patternsFilteredByAction, selectedKeyRef]);

  // 選択可能なコスト支払い一覧
  const availableCostRefs = useMemo(() => {
    const refs = new Set<number>();
    for (const p of patternsFilteredByKey) {
      if (p.costPaymentRef !== undefined) refs.add(p.costPaymentRef);
    }
    return Array.from(refs);
  }, [patternsFilteredByKey]);

  // 4. 選択中アクション + キーカード + コストで絞り込まれたパターン
  const patternsFilteredByCost = useMemo(() => {
    if (selectedCostRef === null) return [];
    return patternsFilteredByKey.filter((p) => p.costPaymentRef === selectedCostRef);
  }, [patternsFilteredByKey, selectedCostRef]);

  // 選択可能な対象一覧
  const availableTargetRefs = useMemo(() => {
    const refs = new Set<number>();
    for (const p of patternsFilteredByCost) {
      if (p.targetSelectionRef !== undefined) refs.add(p.targetSelectionRef);
    }
    return Array.from(refs);
  }, [patternsFilteredByCost]);

  // アクション選択ハンドラ
  const handleSelectAction = (actRef: number) => {
    setSelectedActionRef(actRef);

    const acts = patterns.filter((p) => p.actionSelectionRef === actRef);
    const keyRefs = Array.from(new Set(acts.map((p) => p.keyCardSelectionRef)));
    let nextKeyRef: number | null = null;
    if (keyRefs.length === 1) {
      nextKeyRef = keyRefs[0] !== undefined ? keyRefs[0] : null;
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

  // EFFECT_RESOLUTION 時のアタッカー・ブロッカー情報の Observation 照合 & ①/② 番号マッピング
  const unitNumberMap = useMemo(() => {
    const map = new Map<string, { badge: string; label: string; fullLabel: string; unitView: any }>();
    const digits = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

    // Observation から全フィールドユニットを収集
    const allUnits: any[] = [];
    if (request.observation?.players) {
      for (const p of Object.values<any>(request.observation.players)) {
        if (p.field && Array.isArray(p.field)) {
          allUnits.push(...p.field);
        }
      }
    }

    // catalog.effectSelections に含まれる unitId を収集
    const candidateUnitIds = new Set<string>();
    for (const eff of catalog.effectSelections) {
      if (eff.selectedValues) {
        for (const uId of eff.selectedValues) {
          candidateUnitIds.add(uId);
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

    let count = 0;
    for (const unit of allUnits) {
      if (candidateUnitIds.has(unit.unitId)) {
        const badge = digits[count] || `[${count + 1}]`;
        const cardStr = formatCardList(unit.cards || []);
        const unitType = unit.kind || (unit.componentId === "character.bulwark" ? "防壁" : "一般兵");
        const label = `${cardStr} ${unitType}`;
        const fullLabel = `${badge} ${cardStr} ${unitType}`;
        map.set(unit.unitId, { badge, label, fullLabel, unitView: unit });
        count++;
      }
    }

    return map;
  }, [catalog, request.observation]);

  // EFFECT_RESOLUTION 用の人間可読パターンリスト
  const humanReadableEffectPatterns = useMemo(() => {
    return patterns.map((p, idx) => {
      const eff = p.effectSelectionRef !== undefined ? catalog.effectSelections[p.effectSelectionRef] : undefined;
      if (!eff) return { patternIndex: idx, label: "効果の選択", selectedValues: [] };

      // 0. カード選択 (selectionType === "card" / 手札破棄等)
      if (eff.selectionType === "card") {
        return {
          patternIndex: idx,
          label: eff.summary || `カード選択: ${(eff.selectedValues || []).join(", ")}`,
          selectedValues: eff.selectedValues || [],
        };
      }

      // 1. アタッカー選択 (selectedValues)
      if (eff.selectedValues !== undefined) {
        if (eff.selectedValues.length === 0) {
          return { patternIndex: idx, label: "アタッカーなし (0体)", selectedValues: [] };
        }
        const unitLabels = eff.selectedValues.map((uId: string) => {
          const info = unitNumberMap.get(uId);
          return info ? (info as any).fullLabel || info.label : uId;
        });
        const isSingle = eff.selectedValues.length === 1;
        const label = isSingle ? `${unitLabels[0]} のみ` : unitLabels.join(" + ");
        return { patternIndex: idx, label, selectedValues: eff.selectedValues };
      }

      // 2. ブロッカー割当て (assignments)
      if (eff.assignments && eff.assignments.length > 0) {
        const asgnStrs = eff.assignments.map((asgn: any) => {
          const srcInfo = unitNumberMap.get(asgn.sourceUnitId);
          const srcLabel = srcInfo ? (srcInfo as any).fullLabel || srcInfo.label : asgn.sourceUnitId;
          if (!asgn.selectedUnitIds || asgn.selectedUnitIds.length === 0) {
            return `${srcLabel} (ブロックなし)`;
          }
          const blkLabels = asgn.selectedUnitIds.map((bId: string) => {
            const bInfo = unitNumberMap.get(bId);
            return bInfo ? (bInfo as any).fullLabel || bInfo.label : bId;
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
  }, [patterns, catalog, unitNumberMap]);

  // 盤面クリック選択 (selectedUnitIdsFromBoard) との連動
  useEffect(() => {
    if (selectedUnitIdsFromBoard && selectedUnitIdsFromBoard.length > 0) {
      // 選択された unitIds と一致する pattern を検索
      const targetIds = new Set(selectedUnitIdsFromBoard);
      const matchIdx = humanReadableEffectPatterns.findIndex((hp) => {
        if (hp.selectedValues.length !== targetIds.size) return false;
        return hp.selectedValues.every((id) => targetIds.has(id));
      });
      if (matchIdx !== -1) {
        setSelectedEffectPatternRef(matchIdx);
      }
    }
  }, [selectedUnitIdsFromBoard, humanReadableEffectPatterns]);

  // 盤面マーカー（①, ②）と選択状態の通知
  useEffect(() => {
    if (!onSelectionMarkersChange) return;

    const markers = new Map<string, { badge: string; isSelected: boolean }>();
    const currentSelectedPattern =
      selectedEffectPatternRef !== null ? humanReadableEffectPatterns[selectedEffectPatternRef] : undefined;
    const currentSelectedValues = new Set(currentSelectedPattern?.selectedValues || []);

    unitNumberMap.forEach((info, unitId) => {
      markers.set(unitId, {
        badge: info.badge,
        isSelected: currentSelectedValues.has(unitId),
      });
    });

    onSelectionMarkersChange(markers);
  }, [unitNumberMap, selectedEffectPatternRef, humanReadableEffectPatterns, onSelectionMarkersChange]);

  // パターン一致検索
  const finalMatchedPatternIndex = useMemo(() => {
    if (selectedActionRef === null) return null;
    return patterns.findIndex((p) => {
      if (p.actionSelectionRef !== selectedActionRef) return false;
      if (selectedKeyRef !== null) {
        if (p.keyCardSelectionRef !== selectedKeyRef) return false;
      } else {
        if (p.keyCardSelectionRef !== undefined) return false;
      }
      if (selectedCostRef !== null) {
        if (p.costPaymentRef !== selectedCostRef) return false;
      }
      if (selectedTargetRef !== null) {
        if (p.targetSelectionRef !== selectedTargetRef) return false;
      }
      return true;
    });
  }, [patterns, selectedActionRef, selectedKeyRef, selectedCostRef, selectedTargetRef]);

  const handleActionSubmit = (autoPass: boolean = false) => {
    if (finalMatchedPatternIndex === null || finalMatchedPatternIndex === -1) return;
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
    onSubmit({
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: selectedEffectPatternRef,
    });
  };

  const passPatternIndex = patterns.findIndex((p) => p.kind === "PASS");
  const handlePass = () => {
    if (passPatternIndex === -1) return;
    onSubmit({
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: passPatternIndex,
    });
  };

  // EFFECT_RESOLUTION 時の UI
  if (request.source.type === "EFFECT_RESOLUTION") {
    const isBlockAssignment = catalog.effectSelections.some(
      (eff) => eff.selectionType === "unitAssignment" || eff.assignments !== undefined
    );

    return (
      <div className="rounded-xl border border-zinc-700 bg-[#121216] p-3.5 text-zinc-100 shadow-xl font-sans">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2.5">
          <div>
            <span className="inline-block rounded bg-white text-zinc-950 px-1.5 py-0.2 text-[9px] font-mono font-black uppercase tracking-wider">
              EFFECT SELECTION
            </span>
            <h2 className="text-sm font-serif font-black text-white mt-0.5 tracking-wide">
              {request.playerId === "p1" ? "Player A" : "Player B"} の{isBlockAssignment ? "ブロッカー指定" : "対象・割当て指定"}
            </h2>
          </div>
        </div>

        {isBlockAssignment ? (
          <BlockAssignmentEditor
            request={request}
            onSelectPattern={(patternRef) => {
              onSubmit({
                decisionId: request.decisionId,
                stateVersion: request.stateVersion,
                selectedPatternRef: patternRef,
              });
            }}
            unitNumberMap={unitNumberMap}
          />
        ) : (
          <div className="space-y-2.5">
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
              選択肢（盤面の ①, ② をタップまたは下記から選択）:
            </label>

            <div className="grid grid-cols-1 gap-1.5 max-h-60 overflow-y-auto pr-1">
              {humanReadableEffectPatterns.map((hp, idx) => {
                const isSelected = selectedEffectPatternRef === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedEffectPatternRef(idx)}
                    className={`rounded-lg border p-2.5 text-left transition flex items-center justify-between ${
                      isSelected
                        ? "border-white bg-zinc-800 text-white shadow ring-1 ring-white"
                        : "border-zinc-800 bg-zinc-900/80 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-mono">
                      <span
                        className={`w-4 h-4 rounded-full border flex items-center justify-center text-[9px] ${
                          isSelected
                            ? "bg-white border-zinc-900 text-zinc-950 font-black"
                            : "border-zinc-600 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="font-bold text-xs leading-snug">{hp.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedEffectPatternRef !== null && (
              <div className="pt-2.5 border-t border-zinc-800 mt-2 flex items-center justify-between gap-2">
                <div className="text-xs text-zinc-400 font-mono truncate">
                  選択中:{" "}
                  <span className="font-bold text-white">
                    {humanReadableEffectPatterns[selectedEffectPatternRef]?.label}
                  </span>
                </div>
                <button
                  onClick={handleEffectSubmit}
                  className="py-2 px-4 rounded-lg bg-white hover:bg-zinc-100 active:scale-95 text-zinc-950 font-black shadow transition text-xs shrink-0 ring-1 ring-zinc-300"
                >
                  決定して解決する
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }


  const selectedAction = selectedActionRef !== null ? catalog.actions[selectedActionRef] : null;
  const selectedKey = selectedKeyRef !== null ? catalog.cardSelections[selectedKeyRef] : null;
  const selectedCost = selectedCostRef !== null ? catalog.costPayments[selectedCostRef] : null;
  const selectedTarget = selectedTargetRef !== null ? catalog.targetSelections[selectedTargetRef] : null;

  return (
    <div className="rounded-xl border border-zinc-700/80 bg-[#121216] p-3.5 text-zinc-100 shadow-xl font-sans">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2.5">
        <div>
          <div className="flex items-center gap-1.5 font-mono">
            <span className="inline-block rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-zinc-300">
              DECISION
            </span>
            <span className="inline-block rounded bg-zinc-900 border border-zinc-700 text-zinc-400 px-1.5 py-0.2 text-[9px] font-bold">
              未リクエスト
            </span>
          </div>
          <h2 className="text-sm font-serif font-black text-white mt-0.5 tracking-wide">
            {request.playerId === "p1" ? "Player A" : "Player B"} の行動選択
          </h2>
        </div>

        {passPatternIndex !== -1 && (
          <button
            onClick={handlePass}
            title="Pキーを押してもPASSできます"
            className="rounded-lg border border-zinc-600 bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-400 px-3 py-1 text-xs font-mono font-bold text-white transition active:scale-95 shadow"
          >
            <span>PASS [P]</span>
          </button>
        )}
      </div>

      {/* 選択済みサマリーバナー */}
      {selectedAction && (
        <div className="flex flex-wrap items-center gap-2 p-1.5 bg-zinc-950 rounded-lg border border-zinc-800 text-[11px] mb-2.5 font-mono text-zinc-300">
          <span className="font-bold text-white">Action: {selectedAction.actionName || selectedAction.actionId}</span>
          {selectedKey && <span className="text-zinc-400">| Key: {selectedKey.displayCodes.join("+")}</span>}
          {selectedCost && <span className="text-zinc-300">| Cost: {selectedCost.summary}</span>}
          {selectedTarget && <span className="text-zinc-300">| Target: {selectedTarget.displayName}</span>}
        </div>
      )}

      <div className="space-y-2.5">
        {/* ステップ1: アクション選択 */}
        <div>
          <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1">
            1. アクション
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {availableActionRefs.map((actRef) => {
              const act = catalog.actions[actRef];
              const isSelected = selectedActionRef === actRef;
              return (
                <button
                  key={actRef}
                  onClick={() => handleSelectAction(actRef)}
                  className={`rounded-lg border p-2 text-left transition ${
                    isSelected
                      ? "border-white bg-zinc-800 text-white shadow ring-1 ring-white"
                      : "border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/90"
                  }`}
                >
                  <div className="font-black text-xs font-serif">{act.actionName || act.actionId}</div>
                  <div className="text-[9px] text-zinc-400 mt-0.5 font-mono">
                    {act.timing ? `[${act.timing}]` : ""} {act.cost ? `Cost: ${act.cost}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ステップ2: キーカード選択 */}
        {selectedActionRef !== null && availableKeyRefs.length > 0 && availableKeyRefs.some((r) => r !== undefined) && (
          <div className="pt-2 border-t border-zinc-800">
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1">
              2. キーカードの選択
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableKeyRefs.map((keyRef, idx) => {
                if (keyRef === undefined) return null;
                const cardSel = catalog.cardSelections[keyRef];
                const isSelected = selectedKeyRef === keyRef;
                return (
                  <button
                    key={keyRef ?? idx}
                    onClick={() => setSelectedKeyRef(keyRef)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition font-mono ${
                      isSelected
                        ? "border-white bg-zinc-800 text-white shadow ring-1 ring-white"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    {cardSel.displayCodes.join("+")}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ステップ3: コスト選択 */}
        {selectedActionRef !== null &&
          (availableKeyRefs.length === 0 ||
            selectedKeyRef !== null ||
            availableKeyRefs.every((r) => r === undefined)) &&
          availableCostRefs.length > 1 && (
            <div className="pt-2 border-t border-zinc-800">
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1">
                3. コストの支払い方法
              </label>
              {/* キーカードとして使用中のカードがある場合の説明 */}
              {selectedKey && selectedKey.displayCodes && selectedKey.displayCodes.length > 0 && (
                <div className="mb-1.5 p-1.5 rounded bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-300 flex items-center gap-1 font-mono">
                  <span className="font-bold text-zinc-300">[KEY] キーカード使用中:</span>
                  <span className="font-bold text-white bg-zinc-800 px-1 py-0.2 rounded border border-zinc-700">
                    {selectedKey.displayCodes.join(", ")}
                  </span>
                  <span className="text-zinc-500 text-[9px] ml-0.5">(コスト破棄不可)</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-1">
                {availableCostRefs.map((costRef) => {
                  const cost = catalog.costPayments[costRef];
                  const isSelected = selectedCostRef === costRef;
                  return (
                    <button
                      key={costRef}
                      onClick={() => setSelectedCostRef(costRef)}
                      className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition font-mono ${
                        isSelected
                          ? "border-white bg-zinc-800 text-white shadow ring-1 ring-white"
                          : "border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:border-zinc-600"
                      }`}
                    >
                      <div className="font-bold">{cost.summary || "コストなし"}</div>
                    </button>
                  );
                })}

                {/* 使用不可（キーカード使用中）のカードを disabled 候補として明示 */}
                {selectedKey && selectedKey.displayCodes && selectedKey.displayCodes.length > 0 && selectedAction?.cost?.includes("$D") && (
                  <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-1.5 text-xs text-zinc-600 flex items-center justify-between font-mono">
                    <div className="flex items-center gap-1 text-[10px]">
                      <span>{selectedKey.displayCodes.join(", ")}</span>
                      <span className="text-[9px] text-zinc-600 font-sans">（[KEY] キーカード使用中のためコスト破棄不可）</span>
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">UNAVAILABLE</span>
                  </div>
                )}
              </div>
            </div>
          )}

        {/* ステップ4: 対象選択 */}
        {selectedCostRef !== null && availableTargetRefs.length > 1 && (
          <div className="pt-2 border-t border-zinc-800">
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1">
              4. 対象の選択
            </label>
            <div className="grid grid-cols-1 gap-1 max-h-36 overflow-y-auto pr-1">
              {availableTargetRefs.map((tgtRef) => {
                const target = catalog.targetSelections[tgtRef];
                const isSelected = selectedTargetRef === tgtRef;
                return (
                  <button
                    key={tgtRef}
                    onClick={() => setSelectedTargetRef(tgtRef)}
                    className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                      isSelected
                        ? "border-white bg-zinc-800 text-white shadow ring-1 ring-white"
                        : "border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:border-zinc-600"
                    }`}
                  >
                    <div className="font-bold">{target.displayName}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 決定ボタン (リクエスト / リクエスト＆PASS) */}
        {finalMatchedPatternIndex !== null && finalMatchedPatternIndex !== -1 && (
          <div className="pt-2.5 border-t border-zinc-800 flex flex-col sm:flex-row gap-1.5 mt-2">
            <button
              onClick={() => handleActionSubmit(false)}
              className="flex-1 py-2 px-3 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-bold transition text-xs shadow flex items-center justify-center gap-1 font-mono"
            >
              <span>リクエストのみ</span>
            </button>
            <button
              onClick={() => handleActionSubmit(true)}
              className="flex-1 py-2 px-3 rounded-lg bg-white hover:bg-zinc-100 active:scale-95 text-zinc-950 font-black transition text-xs shadow-md ring-1 ring-zinc-300 flex items-center justify-center gap-1 font-mono"
            >
              <span>リクエスト＆PASS (推奨)</span>
            </button>
          </div>
        )}

        {/* ショートカット操作ガイド */}
        <div className="pt-1.5 border-t border-zinc-800/80 text-[9px] text-zinc-500 font-mono flex items-center justify-between">
          <span>SHORTCUT: <strong className="text-zinc-300 bg-zinc-800 px-1 py-0.2 rounded border border-zinc-700">P</strong> = PASS</span>
          <span className="text-zinc-600">BlackPoker Core Battle</span>
        </div>
      </div>
    </div>
  );

};

