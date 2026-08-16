import React, { useState, useMemo } from "react";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PatternExpander, PatternView } from "../../engine/decision/PatternExpander";

export interface DecisionPanelProps {
  readonly request: DecisionRequest;
  readonly onSubmit: (response: DecisionResponse) => void;
  readonly onCancel?: () => void;
}

export const DecisionPanel: React.FC<DecisionPanelProps> = ({ request, onSubmit, onCancel }) => {
  const catalog = request.catalog;
  const patterns = request.patterns;

  // 各パターンの表示用展開モデル
  const patternViews = useMemo(() => {
    return PatternExpander.expandAll(patterns, catalog);
  }, [patterns, catalog]);

  // 選択状態
  const [selectedActionRef, setSelectedActionRef] = useState<number | null>(null);
  const [selectedKeyRef, setSelectedKeyRef] = useState<number | null>(null);
  const [selectedCostRef, setSelectedCostRef] = useState<number | null>(null);
  const [selectedTargetRef, setSelectedTargetRef] = useState<number | null>(null);

  // 1. 選択可能なアクション一覧
  const availableActionRefs = useMemo(() => {
    const refs = new Set<number>();
    for (const p of patterns) {
      if (p.actionSelectionRef !== undefined) refs.add(p.actionSelectionRef);
    }
    return Array.from(refs);
  }, [patterns]);

  // アクション選択変更ハンドラ
  const handleSelectAction = (actRef: number) => {
    setSelectedActionRef(actRef);
    setSelectedKeyRef(null);
    setSelectedCostRef(null);
    setSelectedTargetRef(null);
  };

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

  // キーカード選択変更ハンドラ
  const handleSelectKey = (keyRef: number | null) => {
    setSelectedKeyRef(keyRef);
    setSelectedCostRef(null);
    setSelectedTargetRef(null);
  };

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

  // コスト選択変更ハンドラ
  const handleSelectCost = (costRef: number) => {
    setSelectedCostRef(costRef);
    setSelectedTargetRef(null);
  };

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

  // 対象選択変更ハンドラ
  const handleSelectTarget = (targetRef: number) => {
    setSelectedTargetRef(targetRef);
  };

  // 5. 最終的に確定した 1 件のパターン
  const finalMatchedPatternIndex = useMemo(() => {
    if (selectedActionRef === null || selectedCostRef === null || selectedTargetRef === null) {
      return null;
    }
    return patterns.findIndex((p) => {
      const matchAction = p.actionSelectionRef === selectedActionRef;
      const matchKey = selectedKeyRef === null
        ? p.keyCardSelectionRef === undefined
        : p.keyCardSelectionRef === selectedKeyRef;
      const matchCost = p.costPaymentRef === selectedCostRef;
      const matchTarget = p.targetSelectionRef === selectedTargetRef;
      return matchAction && matchKey && matchCost && matchTarget;
    });
  }, [patterns, selectedActionRef, selectedKeyRef, selectedCostRef, selectedTargetRef]);

  const passPatternIndex = useMemo(() => {
    return patterns.findIndex((p) => p.kind === "PASS");
  }, [patterns]);

  // パス送信ハンドラ
  const handlePassSubmit = () => {
    if (passPatternIndex === -1) return;
    const response: DecisionResponse = {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: passPatternIndex,
    };
    onSubmit(response);
  };

  // 決定ハンドラ
  const handleSubmit = () => {
    if (finalMatchedPatternIndex === null || finalMatchedPatternIndex === -1) return;
    const response: DecisionResponse = {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: finalMatchedPatternIndex,
    };
    onSubmit(response);
  };

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-slate-900/95 p-5 text-slate-100 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
        <div>
          <span className="inline-block rounded bg-indigo-600 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">
            Decision Request
          </span>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            判断要求: {request.playerId === "p1" ? "Player A" : "Player B"} ({request.playerId})
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {passPatternIndex !== -1 && (
            <button
              onClick={handlePassSubmit}
              className="rounded-lg border border-amber-500/50 bg-amber-950/50 px-4 py-2 text-xs font-bold text-amber-200 hover:bg-amber-900/70 hover:border-amber-400 transition active:scale-95 shadow-md"
            >
              ⏭️ パスする (PASS)
            </button>
          )}
          <div className="text-right text-xs text-slate-400">
            <div>合法パターン: <span className="font-mono font-bold text-indigo-400">{patterns.length}件</span></div>
            <div>Ver: {request.stateVersion}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {/* ステップ1: アクション選択 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              1. アクションの選択
            </label>
            {availableActionRefs.length === 0 && (
              <span className="text-xs text-slate-500 italic">利用可能なアクションはありません（パスのみ可能）</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {availableActionRefs.map((actRef) => {
              const act = catalog.actions[actRef];
              const isSelected = selectedActionRef === actRef;
              return (
                <button
                  key={actRef}
                  onClick={() => handleSelectAction(actRef)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-950/60 text-indigo-200 shadow-md ring-1 ring-indigo-500"
                      : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600 hover:bg-slate-800"
                  }`}
                >
                  <div className="font-bold text-sm">{act.actionName || act.actionId}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {act.timing ? `Timing: ${act.timing}` : ""} {act.cost ? `Cost: ${act.cost}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ステップ2: キーカード選択（選択中アクションにキーカード候補がある場合） */}
        {selectedActionRef !== null && availableKeyRefs.length > 0 && availableKeyRefs.some((r) => r !== undefined) && (
          <div className="pt-2 border-t border-slate-800">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              2. キーカードの選択
            </label>
            <div className="flex flex-wrap gap-2">
              {availableKeyRefs.map((keyRef, idx) => {
                if (keyRef === undefined) return null;
                const cardSel = catalog.cardSelections[keyRef];
                const isSelected = selectedKeyRef === keyRef;
                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectKey(keyRef)}
                    className={`rounded-lg border px-3 py-1.5 font-mono text-sm font-semibold transition ${
                      isSelected
                        ? "border-amber-500 bg-amber-950/60 text-amber-200 shadow-md ring-1 ring-amber-500"
                        : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600 hover:bg-slate-800"
                    }`}
                  >
                    {cardSel.displayCodes.join("+")}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ステップ3: コスト支払い方法の選択 */}
        {selectedActionRef !== null && (availableKeyRefs.length === 0 || selectedKeyRef !== null || availableKeyRefs.every(r => r === undefined)) && (
          <div className="pt-2 border-t border-slate-800">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              3. コストの支払い方法
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availableCostRefs.map((costRef) => {
                const cost = catalog.costPayments[costRef];
                const isSelected = selectedCostRef === costRef;
                return (
                  <button
                    key={costRef}
                    onClick={() => handleSelectCost(costRef)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-950/60 text-emerald-200 shadow-md ring-1 ring-emerald-500"
                        : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600 hover:bg-slate-800"
                    }`}
                  >
                    <div className="font-semibold">{cost.summary || "コストなし"}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ステップ4: 対象の選択 */}
        {selectedCostRef !== null && (
          <div className="pt-2 border-t border-slate-800">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              4. 対象の選択
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availableTargetRefs.map((tgtRef) => {
                const target = catalog.targetSelections[tgtRef];
                const isSelected = selectedTargetRef === tgtRef;
                return (
                  <button
                    key={tgtRef}
                    onClick={() => handleSelectTarget(tgtRef)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      isSelected
                        ? "border-cyan-500 bg-cyan-950/60 text-cyan-200 shadow-md ring-1 ring-cyan-500"
                        : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600 hover:bg-slate-800"
                    }`}
                  >
                    <div className="font-semibold">{target.displayName || "対象なし"}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ステップ5: 最終確認と送信 */}
        {finalMatchedPatternIndex !== null && finalMatchedPatternIndex !== -1 && (
          <div className="pt-3 border-t border-slate-700 mt-4 bg-slate-800/50 p-3 rounded-lg flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 font-semibold">選択されたパターン [Ref: #{finalMatchedPatternIndex}]:</div>
              <div className="text-sm font-bold text-indigo-300 mt-0.5">
                {patternViews[finalMatchedPatternIndex]?.summary}
              </div>
            </div>
            <button
              onClick={handleSubmit}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 font-bold text-white shadow-lg hover:bg-indigo-500 transition active:scale-95"
            >
              確定して実行
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
