import React, { useState, useMemo, useEffect } from "react";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PatternExpander, PatternView } from "../../engine/decision/PatternExpander";

export interface DecisionPanelProps {
  readonly request: DecisionRequest;
  readonly onSubmit: (response: DecisionResponse, options?: { autoPass?: boolean }) => void;
  readonly onCancel?: () => void;
}

export const DecisionPanel: React.FC<DecisionPanelProps> = ({ request, onSubmit }) => {
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

  // アクション選択ハンドラ（自動選択ヘルパー連動）
  const handleSelectAction = (actRef: number) => {
    setSelectedActionRef(actRef);

    // そのアクションで選べるキーカードをチェック
    const acts = patterns.filter((p) => p.actionSelectionRef === actRef);
    const keyRefs = Array.from(new Set(acts.map((p) => p.keyCardSelectionRef)));
    let nextKeyRef: number | null = null;
    if (keyRefs.length === 1) {
      nextKeyRef = keyRefs[0] !== undefined ? keyRefs[0] : null;
    }
    setSelectedKeyRef(nextKeyRef);

    // コスト候補をチェック
    const keys = acts.filter((p) =>
      nextKeyRef === null ? p.keyCardSelectionRef === undefined : p.keyCardSelectionRef === nextKeyRef
    );
    const costRefs = Array.from(new Set(keys.map((p) => p.costPaymentRef).filter((r): r is number => r !== undefined)));
    let nextCostRef: number | null = null;
    if (costRefs.length === 1) {
      nextCostRef = costRefs[0];
    }
    setSelectedCostRef(nextCostRef);

    // 対象候補をチェック
    if (nextCostRef !== null) {
      const costs = keys.filter((p) => p.costPaymentRef === nextCostRef);
      const tgtRefs = Array.from(new Set(costs.map((p) => p.targetSelectionRef).filter((r): r is number => r !== undefined)));
      let nextTgtRef: number | null = null;
      if (tgtRefs.length === 1) {
        nextTgtRef = tgtRefs[0];
      }
      setSelectedTargetRef(nextTgtRef);
    } else {
      setSelectedTargetRef(null);
    }
  };

  // 5. 最終的に確定した 1 件のパターン
  const finalMatchedPatternIndex = useMemo(() => {
    if (selectedActionRef === null || selectedCostRef === null || selectedTargetRef === null) {
      return null;
    }
    return patterns.findIndex((p) => {
      const matchAction = p.actionSelectionRef === selectedActionRef;
      const matchKey =
        selectedKeyRef === null ? p.keyCardSelectionRef === undefined : p.keyCardSelectionRef === selectedKeyRef;
      const matchCost = p.costPaymentRef === selectedCostRef;
      const matchTarget = p.targetSelectionRef === selectedTargetRef;
      return matchAction && matchKey && matchCost && matchTarget;
    });
  }, [patterns, selectedActionRef, selectedKeyRef, selectedCostRef, selectedTargetRef]);

  const isEffectResolution = request.source.type === "EFFECT_RESOLUTION";
  const [selectedEffectPatternRef, setSelectedEffectPatternRef] = useState<number | null>(null);

  // パス（PASS）パターンの取得
  const passPatternIndex = useMemo(() => {
    return patterns.findIndex((p) => p.kind === "PASS");
  }, [patterns]);

  const handlePass = () => {
    if (passPatternIndex !== -1) {
      onSubmit({
        decisionId: request.decisionId,
        stateVersion: request.stateVersion,
        selectedPatternRef: passPatternIndex,
      });
    }
  };

  const handleEffectSubmit = () => {
    if (selectedEffectPatternRef !== null) {
      onSubmit({
        decisionId: request.decisionId,
        stateVersion: request.stateVersion,
        selectedPatternRef: selectedEffectPatternRef,
      });
    }
  };

  const handleActionSubmit = (autoPass: boolean) => {
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

  if (isEffectResolution) {
    const isAttackSelection = request.source.effectStepId === "selectUnits";

    return (
      <div className="rounded-xl border-2 border-amber-500/80 bg-slate-900/95 p-4 shadow-xl text-slate-100">
        <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5 mb-3">
          <div>
            <span className="inline-block rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              EFFECT RESOLUTION
            </span>
            <h3 className="text-base font-black text-amber-300 mt-0.5">
              {isAttackSelection ? "⚔ アタッカーの選択" : "🛡 ブロッカー割当ての選択"}
            </h3>
          </div>
          <div className="text-xs text-slate-400">
            Player: <span className="font-bold text-amber-300">{request.playerId === "p1" ? "Player A" : "Player B"}</span>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
            選択肢（全 {patterns.length} 通り）:
          </label>

          <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
            {patternViews.map((pv, idx) => {
              const isSelected = selectedEffectPatternRef === idx;
              return (
                <button
                  key={pv.patternId || idx}
                  onClick={() => setSelectedEffectPatternRef(idx)}
                  className={`rounded-xl border-2 p-3 text-left transition flex items-center justify-between ${
                    isSelected
                      ? "border-amber-400 bg-amber-950/80 text-amber-100 shadow-md ring-2 ring-amber-400/50"
                      : "border-slate-700 bg-slate-800/60 text-slate-200 hover:border-slate-500 hover:bg-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full border flex items-center justify-center text-[8px] ${isSelected ? "bg-amber-400 border-amber-300 text-slate-950 font-bold" : "border-slate-500"}`}>
                      {isSelected ? "✓" : ""}
                    </span>
                    <span className="font-bold text-sm leading-snug">{pv.summary}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedEffectPatternRef !== null && (
            <div className="pt-3 border-t border-slate-700 mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400 truncate">
                選択中: <span className="font-bold text-amber-300">{patternViews[selectedEffectPatternRef]?.summary}</span>
              </div>
              <button
                onClick={handleEffectSubmit}
                className="py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black shadow-lg transition text-sm shrink-0"
              >
                決定して解決する
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const selectedAction = selectedActionRef !== null ? catalog.actions[selectedActionRef] : null;
  const selectedKey = selectedKeyRef !== null ? catalog.cardSelections[selectedKeyRef] : null;
  const selectedCost = selectedCostRef !== null ? catalog.costPayments[selectedCostRef] : null;
  const selectedTarget = selectedTargetRef !== null ? catalog.targetSelections[selectedTargetRef] : null;

  return (
    <div className="rounded-xl border-2 border-indigo-500/40 bg-slate-900/95 p-4 text-slate-100 shadow-xl">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5 mb-3">
        <div>
          <span className="inline-block rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            DECISION PANEL
          </span>
          <h2 className="text-base font-bold text-slate-100 mt-0.5">
            {request.playerId === "p1" ? "Player A" : "Player B"} の行動選択
          </h2>
        </div>

        {passPatternIndex !== -1 && (
          <button
            onClick={handlePass}
            className="rounded-xl border border-amber-500/60 bg-amber-950/60 px-3.5 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-900/80 hover:border-amber-400 transition active:scale-95 shadow-md flex items-center gap-1"
          >
            <span>⏭️</span>
            <span>PASS (パスする)</span>
          </button>
        )}
      </div>

      {/* 選択済みサマリーバナー */}
      {selectedAction && (
        <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-800/80 rounded-lg border border-slate-700 text-xs mb-3 font-mono">
          <span className="font-bold text-indigo-300">Action: {selectedAction.actionName || selectedAction.actionId}</span>
          {selectedKey && <span className="text-slate-400">| Key: {selectedKey.displayCodes.join("+")}</span>}
          {selectedCost && <span className="text-emerald-400">| Cost: {selectedCost.summary}</span>}
          {selectedTarget && <span className="text-amber-300">| Target: {selectedTarget.displayName}</span>}
        </div>
      )}

      <div className="space-y-3.5">
        {/* ステップ1: アクション選択 */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
            1. アクション
          </label>
          <div className="grid grid-cols-2 gap-2">
            {availableActionRefs.map((actRef) => {
              const act = catalog.actions[actRef];
              const isSelected = selectedActionRef === actRef;
              return (
                <button
                  key={actRef}
                  onClick={() => handleSelectAction(actRef)}
                  className={`rounded-xl border-2 p-2.5 text-left transition ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-950/80 text-indigo-100 shadow-md ring-2 ring-indigo-400/40"
                      : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800"
                  }`}
                >
                  <div className="font-black text-sm">{act.actionName || act.actionId}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                    {act.timing ? `[${act.timing}]` : ""} {act.cost ? `Cost: ${act.cost}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ステップ2: キーカード選択 */}
        {selectedActionRef !== null && availableKeyRefs.length > 0 && availableKeyRefs.some((r) => r !== undefined) && (
          <div className="pt-2 border-t border-slate-800">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              2. キーカードの選択
            </label>
            <div className="flex flex-wrap gap-2">
              {availableKeyRefs.map((keyRef, idx) => {
                if (keyRef === undefined) return null;
                const cardSel = catalog.cardSelections[keyRef];
                const isSelected = selectedKeyRef === keyRef;
                return (
                  <button
                    key={keyRef ?? idx}
                    onClick={() => setSelectedKeyRef(keyRef)}
                    className={`rounded-lg border-2 px-3 py-1.5 text-xs font-bold transition font-mono ${
                      isSelected
                        ? "border-indigo-400 bg-indigo-900 text-white shadow ring-2 ring-indigo-400/50"
                        : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
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
        {selectedActionRef !== null && (availableKeyRefs.length === 0 || selectedKeyRef !== null || availableKeyRefs.every((r) => r === undefined)) && availableCostRefs.length > 1 && (
          <div className="pt-2 border-t border-slate-800">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              3. コストの支払い方法
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {availableCostRefs.map((costRef) => {
                const cost = catalog.costPayments[costRef];
                const isSelected = selectedCostRef === costRef;
                return (
                  <button
                    key={costRef}
                    onClick={() => setSelectedCostRef(costRef)}
                    className={`rounded-lg border-2 px-3 py-2 text-left text-xs transition ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-950/70 text-emerald-100 shadow ring-1 ring-emerald-500"
                        : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <div className="font-bold">{cost.summary || "コストなし"}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ステップ4: 対象選択 */}
        {selectedCostRef !== null && availableTargetRefs.length > 1 && (
          <div className="pt-2 border-t border-slate-800">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              4. 対象の選択
            </label>
            <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto pr-1">
              {availableTargetRefs.map((tgtRef) => {
                const target = catalog.targetSelections[tgtRef];
                const isSelected = selectedTargetRef === tgtRef;
                return (
                  <button
                    key={tgtRef}
                    onClick={() => setSelectedTargetRef(tgtRef)}
                    className={`rounded-lg border-2 px-3 py-2 text-left text-xs transition ${
                      isSelected
                        ? "border-amber-500 bg-amber-950/70 text-amber-100 shadow ring-1 ring-amber-500"
                        : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500"
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
          <div className="pt-3 border-t border-slate-700 flex flex-col sm:flex-row gap-2 mt-3">
            <button
              onClick={() => handleActionSubmit(false)}
              className="flex-1 py-2.5 px-4 rounded-xl border border-indigo-400 bg-indigo-900/60 hover:bg-indigo-800 text-indigo-100 font-bold transition text-xs shadow flex items-center justify-center gap-1"
            >
              <span>📥</span>
              <span>リクエストのみ</span>
            </button>
            <button
              onClick={() => handleActionSubmit(true)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:scale-95 text-white font-black transition text-xs shadow-lg ring-2 ring-indigo-400/40 flex items-center justify-center gap-1.5"
            >
              <span>🚀</span>
              <span>リクエスト＆PASS (推奨)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
