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
  unitNumberMap: Map<string, { badge: string; label: string; fullLabel?: string; unitView: any }>;
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
              className="rounded border border-zinc-700 bg-[#161616] p-3 shadow-inner"
            >
              {/* アタッカー情報ヘッダー */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">

                <div className="flex items-center gap-2">
                  {atkInfo.badge && (
                    <span className="w-5 h-5 rounded-full bg-white text-zinc-950 border border-zinc-300 text-xs font-black flex items-center justify-center">
                      {atkInfo.badge}
                    </span>
                  )}
                  <div className="font-bold text-sm text-zinc-100 flex items-center gap-1.5 font-mono">
                    <span className="text-white font-black">[ATTACKER]</span>
                    <span>{atkInfo.label}</span>
                  </div>
                </div>


                {currentBlockers.length > 0 && (
                  <button
                    onClick={() => handleClearAttacker(attacker.unitId)}
                    className="text-[10px] font-mono text-zinc-400 hover:text-white px-2 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition"
                  >
                    解除
                  </button>
                )}
              </div>

              {/* ブロッカー選択肢 */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-400">
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
                        className={`rounded-lg border p-2 text-left text-xs transition flex items-center justify-between ${
                          isSelected
                            ? "border-white bg-zinc-800 text-white shadow ring-1 ring-white"
                            : isDisabled
                            ? "border-zinc-800/80 bg-zinc-950/40 text-zinc-600 opacity-40 cursor-not-allowed"
                            : "border-zinc-700 bg-zinc-900/80 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] font-mono font-bold ${
                              isSelected
                                ? "bg-white border-zinc-900 text-zinc-950 font-black"
                                : "border-zinc-600 text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                          {blkInfo.badge && (
                            <span className="w-5 h-5 rounded-full bg-zinc-950 text-white border border-zinc-500 text-xs font-mono font-black flex items-center justify-center">
                              {blkInfo.badge}
                            </span>
                          )}
                          <span className="font-bold">{blkInfo.label}</span>
                        </div>

                        {isSelected && (
                          <span className="text-[9px] font-mono font-bold bg-zinc-950 px-1 py-0.2 rounded border border-zinc-600 text-white">BLOCK</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* ブロックなし状態の表示 */}
                {currentBlockers.length === 0 && (
                  <div className="text-[10px] text-zinc-400 italic py-0.5 pl-1 font-mono">
                    （ブロックせず直接ダメージを受けます）
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 現在の割当てサマリー & 決定ボタン */}
      <div className="pt-2.5 border-t border-zinc-800">
        <div className="mb-2.5 p-2 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs">
          <div className="font-mono font-bold text-zinc-400 text-[10px] uppercase mb-1">現在の割当て:</div>
          <div className="space-y-1">
            {attackers.map((attacker) => {
              const atkInfo = getUnitDisplay(attacker.unitId);
              const blkIds = assignments[attacker.unitId] || [];
              const blkLabels = blkIds.map((id) => {
                const info = getUnitDisplay(id);
                return `${info.badge} ${info.label}`;
              });

              return (
                <div key={attacker.unitId} className="flex items-center gap-1.5 text-zinc-200 font-mono text-xs">
                  <span className="font-bold text-white">{atkInfo.badge} {atkInfo.label}</span>
                  <span className="text-zinc-500">←</span>
                  {blkLabels.length > 0 ? (
                    <span className="font-bold text-zinc-100">{blkLabels.join(" + ")}</span>
                  ) : (
                    <span className="text-zinc-500 italic">ブロックなし</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <button
          disabled={exactPatternRef === null}
          onClick={handleSubmit}
          className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs transition shadow-md flex items-center justify-center gap-2 font-mono ${
            exactPatternRef !== null
              ? "bg-white hover:bg-zinc-100 active:scale-95 text-zinc-950 ring-1 ring-zinc-300 cursor-pointer font-black"
              : "bg-zinc-900 text-zinc-500 border border-zinc-800 cursor-not-allowed"
          }`}
        >
          <span>この割当てで決定</span>
        </button>
      </div>
    </div>
  );

};

