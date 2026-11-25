import React, { useEffect, useMemo, useRef, useState } from "react";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { RichCardText } from "../common/RichCardText";

export interface AttackerSelectionEditorProps {
  request: DecisionRequest;
  unitNumberMap: Map<string, { badge: string; label: string; fullLabel?: string; unitView: any }>;
  onExactPatternRefChange: (patternRef: number | null) => void;
  lastBoardUnitClick?: { unitId: string; seq: number } | null;
}

function makeSetKey(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

/**
 * 合法パターンがユニット集合の選択（アタッカー選択等）として一意に表現できるかを判定し、
 * 候補ユニットID一覧と「ソート済みID集合キー -> patternRef」マップを返す。
 */
export function buildUnitSetSelectionModel(request: Readonly<DecisionRequest>): {
  isUnitSetSelection: boolean;
  candidateUnitIds: string[];
  patternMap: Map<string, number>;
} {
  if (
    request.source?.type !== "EFFECT_RESOLUTION" ||
    request.source.sourceActionId !== "action.attack"
  ) {
    return { isUnitSetSelection: false, candidateUnitIds: [], patternMap: new Map() };
  }

  const effs = request.catalog.effectSelections || [];
  if (request.patterns.length === 0 || effs.length === 0) {
    return { isUnitSetSelection: false, candidateUnitIds: [], patternMap: new Map() };
  }

  const candidateSet = new Set<string>();
  const patternMap = new Map<string, number>();

  for (let i = 0; i < request.patterns.length; i++) {
    const p = request.patterns[i];
    if (p.effectSelectionRef === undefined) {
      return { isUnitSetSelection: false, candidateUnitIds: [], patternMap: new Map() };
    }
    const eff = effs[p.effectSelectionRef];
    if (!eff || (eff.selectionType !== "unit" && eff.selectionType !== "target")) {
      return { isUnitSetSelection: false, candidateUnitIds: [], patternMap: new Map() };
    }
    const ids = eff.selectedValues ?? [];
    for (const id of ids) {
      candidateSet.add(id);
    }
    const key = makeSetKey(ids);
    if (patternMap.has(key)) {
      return { isUnitSetSelection: false, candidateUnitIds: [], patternMap: new Map() };
    }
    patternMap.set(key, i);
  }

  return {
    isUnitSetSelection: candidateSet.size > 0,
    candidateUnitIds: Array.from(candidateSet),
    patternMap,
  };
}

export const AttackerSelectionEditor: React.FC<AttackerSelectionEditorProps> = ({
  request,
  unitNumberMap,
  onExactPatternRefChange,
  lastBoardUnitClick,
}) => {
  const { candidateUnitIds, patternMap } = useMemo(
    () => buildUnitSetSelectionModel(request),
    [request]
  );

  // 初期選択: 空集合が合法なら空集合、そうでなければ最初の合法パターン
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (patternMap.has("")) return [];
    const firstEffRef = request.patterns[0]?.effectSelectionRef;
    const firstEff =
      firstEffRef !== undefined ? request.catalog.effectSelections?.[firstEffRef] : undefined;
    return [...(firstEff?.selectedValues ?? [])];
  });

  const lastProcessedSeqRef = useRef<number>(lastBoardUnitClick?.seq ?? 0);

  // 選択集合に対応する patternRef を親へ通知
  useEffect(() => {
    const key = makeSetKey(selectedIds);
    const ref = patternMap.get(key) ?? null;
    onExactPatternRefChange(ref);
  }, [selectedIds, patternMap, onExactPatternRefChange]);

  // 盤面ユニットタップ連動
  useEffect(() => {
    if (!lastBoardUnitClick || lastBoardUnitClick.seq === lastProcessedSeqRef.current) return;
    lastProcessedSeqRef.current = lastBoardUnitClick.seq;
    const clickedId = lastBoardUnitClick.unitId;
    if (!candidateUnitIds.includes(clickedId)) return;

    setSelectedIds((prev) =>
      prev.includes(clickedId) ? prev.filter((id) => id !== clickedId) : [...prev, clickedId]
    );
  }, [lastBoardUnitClick, candidateUnitIds]);

  const toggleUnit = (unitId: string) => {
    setSelectedIds((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  };

  const canSelectAll = patternMap.has(makeSetKey(candidateUnitIds));
  const canClearAll = patternMap.has("");

  const handleSelectAll = () => {
    if (canSelectAll) {
      setSelectedIds([...candidateUnitIds]);
    }
  };

  const handleClearAll = () => {
    if (canClearAll) {
      setSelectedIds([]);
    }
  };

  const isCurrentValid = patternMap.has(makeSetKey(selectedIds));

  return (
    <div data-testid="attacker-selection-editor" className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] font-mono font-bold text-zinc-700">
          選択中: <span className="text-zinc-950 font-black">{selectedIds.length}体</span>
          <span className="text-zinc-400 ml-1">/ {candidateUnitIds.length}体</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={!canSelectAll}
            className="rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 px-2 py-1 text-[11px] font-mono font-bold text-zinc-800 transition active:scale-95"
          >
            全選択
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={!canClearAll}
            className="rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 px-2 py-1 text-[11px] font-mono font-bold text-zinc-800 transition active:scale-95"
          >
            全解除
          </button>
        </div>
      </div>

      <div className="text-[10px] font-mono text-zinc-500">
        盤面の兵士または下記をタップして選択・解除してください
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {candidateUnitIds.map((unitId) => {
          const info = unitNumberMap.get(unitId);
          const isSelected = selectedIds.includes(unitId);
          const label = info?.label || unitId;

          return (
            <button
              key={unitId}
              type="button"
              onClick={() => toggleUnit(unitId)}
              data-testid={`attacker-unit-btn-${unitId}`}
              aria-pressed={isSelected}
              className={`rounded border p-2 text-left transition flex items-center justify-between gap-2 min-h-[42px] ${
                isSelected
                  ? "border-zinc-950 bg-zinc-950 text-white shadow ring-1 ring-zinc-950"
                  : "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500 hover:bg-zinc-50"
              }`}
            >
              <div className="flex items-center gap-2 font-mono min-w-0">
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] shrink-0 ${
                    isSelected
                      ? "bg-white border-zinc-900 text-zinc-950 font-black"
                      : "border-zinc-400 text-transparent"
                  }`}
                >
                  ✓
                </span>
                {info?.badge && (
                  <span
                    className={`px-1 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                      isSelected ? "bg-zinc-800 text-zinc-100" : "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    {info.badge}
                  </span>
                )}
                <span className="font-bold text-xs truncate">
                  <RichCardText text={label} />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {!isCurrentValid && (
        <div className="text-[11px] font-mono text-red-600 font-bold">
          この組み合わせはルール上選択できません。別の組み合わせを選択してください。
        </div>
      )}
    </div>
  );
};
