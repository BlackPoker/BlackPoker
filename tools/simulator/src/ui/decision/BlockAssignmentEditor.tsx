import React, { useState, useMemo } from "react";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import {
  AttackerBlockMap,
  canAssignBlocker,
  findExactMatchPatternRef,
} from "./blockAssignmentUtils";

interface BlockAssignmentEditorProps {
  request: DecisionRequest;
  onSelectPattern: (patternRef: number) => void;
  unitNumberMap: Map<string, { badge: string; label: string; unitView: any }>;
}

export const BlockAssignmentEditor: React.FC<BlockAssignmentEditorProps> = ({
  request,
  onSelectPattern,
  unitNumberMap,
}) => {
  const effectSelections = request.catalog.effectSelections || [];

  // アタッカー群およびブロッカー候補群の特定 (catalog から抽出)
  const { attackers, candidateBlockers } = useMemo(() => {
    const atkMap = new Map<string, any>();
    const blkMap = new Map<string, any>();

    // Observation から全フィールドユニットを辞書化
    const allFieldUnits = new Map<string, any>();
    if (request.observation?.players) {
      for (const p of Object.values<any>(request.observation.players)) {
        if (p.field && Array.isArray(p.field)) {
          for (const u of p.field) {
            allFieldUnits.set(u.unitId, u);
          }
        }
      }
    }

    for (const eff of effectSelections) {
      if (eff.assignments) {
        for (const asgn of eff.assignments) {
          if (asgn.sourceUnitId && !atkMap.has(asgn.sourceUnitId)) {
            const unit = allFieldUnits.get(asgn.sourceUnitId);
            atkMap.set(asgn.sourceUnitId, unit || { unitId: asgn.sourceUnitId });
          }
          if (asgn.selectedUnitIds) {
            for (const bId of asgn.selectedUnitIds) {
              if (!blkMap.has(bId)) {
                const unit = allFieldUnits.get(bId);
                blkMap.set(bId, unit || { unitId: bId });
              }
            }
          }
        }
      }
    }

    return {
      attackers: Array.from(atkMap.values()),
      candidateBlockers: Array.from(blkMap.values()),
    };
  }, [effectSelections, request.observation]);

  // 各アタッカーに対するブロッカー割当て状態 (初期状態: 各アタッカー = [])
  const [assignments, setAssignments] = useState<AttackerBlockMap>(() => {
    const initial: AttackerBlockMap = {};
    for (const atk of attackers) {
      initial[atk.unitId] = [];
    }
    return initial;
  });

  // ブロッカーのトグル操作
  const handleToggleBlocker = (attackerUnitId: string, blockerUnitId: string) => {
    setAssignments((prev) => {
      const curList = prev[attackerUnitId] || [];
      let nextList: string[];
      if (curList.includes(blockerUnitId)) {
        nextList = curList.filter((id) => id !== blockerUnitId);
      } else {
        nextList = [...curList, blockerUnitId];
      }
      return {
        ...prev,
        [attackerUnitId]: nextList,
      };
    });
  };

  // 特定アタッカーのブロック解除
  const handleClearAttacker = (attackerUnitId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [attackerUnitId]: [],
    }));
  };

  // 現在の割当てと完全一致する Legal Pattern のインデックス
  const exactPatternRef = useMemo(() => {
    return findExactMatchPatternRef(assignments, effectSelections);
  }, [assignments, effectSelections]);

  const handleSubmit = () => {
    if (exactPatternRef !== null) {
      onSelectPattern(exactPatternRef);
    }
  };

  // ユニット表示ラベルの取得
  const getUnitDisplay = (unitId: string) => {
    const info = unitNumberMap.get(unitId);
    if (info) {
      return { badge: info.badge, label: info.label, unit: info.unitView };
    }
    return { badge: "", label: unitId, unit: undefined };
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-300 font-medium">
        各アタッカーをブロックするキャラクター（ブロッカー）を選択してください。
      </div>

      {/* アタッカー毎の割当てエディタ */}
      <div className="space-y-3.5">
        {attackers.map((attacker) => {
          const atkInfo = getUnitDisplay(attacker.unitId);
          const currentBlockers = assignments[attacker.unitId] || [];

          return (
            <div
              key={attacker.unitId}
              className="rounded-xl border-2 border-slate-700/80 bg-slate-800/40 p-3 shadow-inner"
            >
              {/* アタッカー情報ヘッダー */}
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-2 mb-2.5">
                <div className="flex items-center gap-2">
                  {atkInfo.badge && (
                    <span className="w-5 h-5 rounded-full bg-red-950 text-red-400 border border-red-800 text-xs font-black flex items-center justify-center">
                      {atkInfo.badge}
                    </span>
                  )}
                  <div className="font-bold text-sm text-slate-100 flex items-center gap-1.5">
                    <span className="text-red-400 font-black">⚔️ アタッカー:</span>
                    <span>{atkInfo.label}</span>
                  </div>
                </div>

                {currentBlockers.length > 0 && (
                  <button
                    onClick={() => handleClearAttacker(attacker.unitId)}
                    className="text-[10px] text-slate-400 hover:text-red-300 px-2 py-0.5 rounded border border-slate-700 hover:border-red-800 transition"
                  >
                    解除
                  </button>
                )}
              </div>

              {/* ブロッカー選択肢 */}
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  ブロッカーを指定:
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {candidateBlockers.map((blocker) => {
                    const blkInfo = getUnitDisplay(blocker.unitId);
                    const isSelected = currentBlockers.includes(blocker.unitId);
                    const canSelect = canAssignBlocker(
                      assignments,
                      attacker.unitId,
                      blocker.unitId,
                      effectSelections
                    );
                    const isDisabled = !isSelected && !canSelect;

                    return (
                      <button
                        key={blocker.unitId}
                        disabled={isDisabled}
                        onClick={() => handleToggleBlocker(attacker.unitId, blocker.unitId)}
                        className={`rounded-lg border-2 p-2 text-left text-xs transition flex items-center justify-between ${
                          isSelected
                            ? "border-amber-400 bg-amber-950/80 text-amber-100 shadow ring-1 ring-amber-400/50"
                            : isDisabled
                            ? "border-slate-800 bg-slate-900/40 text-slate-600 opacity-40 cursor-not-allowed"
                            : "border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-500 hover:bg-slate-700/80"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold ${
                              isSelected
                                ? "bg-amber-400 border-amber-300 text-slate-950 font-black"
                                : "border-slate-600 text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                          {blkInfo.badge && (
                            <span className="text-amber-400 font-bold">{blkInfo.badge}</span>
                          )}
                          <span className="font-bold">{blkInfo.label}</span>
                        </div>

                        {isSelected && (
                          <span className="text-[10px] font-bold text-amber-300">BLOCK</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* ブロックなし状態の表示 */}
                {currentBlockers.length === 0 && (
                  <div className="text-[11px] text-slate-400 italic py-1 pl-1">
                    （ブロックせず直接ダメージを受けます）
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 現在の割当てサマリー & 決定ボタン */}
      <div className="pt-3 border-t border-slate-700">
        <div className="mb-3 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
          <div className="font-bold text-slate-400 text-[10px] uppercase mb-1">現在の割当て:</div>
          <div className="space-y-1">
            {attackers.map((attacker) => {
              const atkInfo = getUnitDisplay(attacker.unitId);
              const blkIds = assignments[attacker.unitId] || [];
              const blkLabels = blkIds.map((id) => getUnitDisplay(id).label);

              return (
                <div key={attacker.unitId} className="flex items-center gap-1.5 text-slate-200">
                  <span className="font-bold text-red-400">{atkInfo.badge || "⚔️"} {atkInfo.label}</span>
                  <span className="text-slate-500">←</span>
                  {blkLabels.length > 0 ? (
                    <span className="font-bold text-amber-300">{blkLabels.join(" + ")}</span>
                  ) : (
                    <span className="text-slate-500 italic">ブロックなし</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <button
          disabled={exactPatternRef === null}
          onClick={handleSubmit}
          className={`w-full py-3 px-4 rounded-xl font-black text-xs transition shadow-lg flex items-center justify-center gap-2 ${
            exactPatternRef !== null
              ? "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-slate-950 ring-2 ring-amber-400/50 cursor-pointer"
              : "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
          }`}
        >
          <span>🛡</span>
          <span>この割当てで決定</span>
        </button>
      </div>
    </div>
  );
};
