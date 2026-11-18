import React, { useState, useMemo, useEffect } from "react";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import {
  AttackerBlockMap,
  canAssignBlocker,
  findExactMatchPatternRef,
} from "./blockAssignmentUtils";
import { RichCardText } from "../common/RichCardText";

interface BlockAssignmentEditorProps {
  request: DecisionRequest;
  onSelectPattern: (patternRef: number) => void;
  unitNumberMap: Map<string, { badge: string; label: string; fullLabel?: string; unitView: any }>;
  onExactPatternRefChange?: (patternRef: number | null) => void;
  initialAssignments?: AttackerBlockMap;
  onAssignmentsChange?: (assignments: AttackerBlockMap) => void;
  lastBoardUnitClick?: { unitId: string; seq: number } | null;
}

export const BlockAssignmentEditor: React.FC<BlockAssignmentEditorProps> = ({
  request,
  onSelectPattern,
  unitNumberMap,
  onExactPatternRefChange,
  initialAssignments,
  onAssignmentsChange,
  lastBoardUnitClick,
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

  // 各アタッカーに対するブロッカー割当て状態 (初期状態: initialAssignments または 各アタッカー = [])
  const [assignments, setAssignments] = useState<AttackerBlockMap>(() => {
    const initial: AttackerBlockMap = {};
    for (const atk of attackers) {
      initial[atk.unitId] = initialAssignments?.[atk.unitId] ? [...initialAssignments[atk.unitId]] : [];
    }
    return initial;
  });
  const [activeAttackerUnitId, setActiveAttackerUnitId] = useState<string | null>(
    () => attackers[0]?.unitId ?? null
  );
  const lastProcessedBoardClickSeqRef = React.useRef<number>(lastBoardUnitClick?.seq ?? 0);

  useEffect(() => {
    onAssignmentsChange?.(assignments);
  }, [assignments, onAssignmentsChange]);

  // 盤面ユニットタップ連動: アタッカーをタップで対象アタッカー切替、ブロッカー候補をタップで割当てトグル
  useEffect(() => {
    if (!lastBoardUnitClick || lastBoardUnitClick.seq === lastProcessedBoardClickSeqRef.current) return;
    lastProcessedBoardClickSeqRef.current = lastBoardUnitClick.seq;
    const clickedId = lastBoardUnitClick.unitId;

    if (attackers.some((a) => a.unitId === clickedId)) {
      setActiveAttackerUnitId(clickedId);
      return;
    }

    if (candidateBlockers.some((b) => b.unitId === clickedId)) {
      const targetAttackerId =
        activeAttackerUnitId && attackers.some((a) => a.unitId === activeAttackerUnitId)
          ? activeAttackerUnitId
          : attackers[0]?.unitId;
      if (!targetAttackerId) return;

      setAssignments((prev) => {
        const curList = prev[targetAttackerId] || [];
        const isSelected = curList.includes(clickedId);
        if (isSelected) {
          return {
            ...prev,
            [targetAttackerId]: curList.filter((id) => id !== clickedId),
          };
        }
        if (canAssignBlocker(prev, targetAttackerId, clickedId, effectSelections)) {
          return {
            ...prev,
            [targetAttackerId]: [...curList, clickedId],
          };
        }
        return prev;
      });
    }
  }, [lastBoardUnitClick, attackers, candidateBlockers, activeAttackerUnitId, effectSelections]);

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

  useEffect(() => {
    onExactPatternRefChange?.(exactPatternRef);
  }, [exactPatternRef, onExactPatternRefChange]);

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
      <div className="text-xs text-zinc-600 font-medium">
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
              className="rounded border border-zinc-300 bg-zinc-50 p-3 shadow-sm"
            >
              {/* アタッカー情報ヘッダー */}
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="font-bold text-sm text-zinc-950 flex items-center gap-1.5 font-mono">
                    <span className="text-zinc-950 font-black">[ATTACKER]</span>
                    <span><RichCardText text={atkInfo.label} /></span>
                  </div>
                </div>

                {currentBlockers.length > 0 && (
                  <button
                    onClick={() => handleClearAttacker(attacker.unitId)}
                    className="text-[10px] font-mono text-zinc-600 hover:text-zinc-950 px-2 py-0.5 rounded border border-zinc-300 hover:border-zinc-500 bg-white transition"
                  >
                    解除
                  </button>
                )}
              </div>

              {/* ブロッカー選択肢 */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-500">
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
                        className={`rounded border p-2 text-left text-xs transition flex items-center justify-between ${
                          isSelected
                            ? "border-zinc-950 bg-zinc-950 text-white shadow ring-1 ring-zinc-950"
                            : isDisabled
                            ? "border-zinc-200 bg-zinc-100 text-zinc-400 opacity-50 cursor-not-allowed"
                            : "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500 hover:bg-zinc-50"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] font-mono font-bold ${
                              isSelected
                                ? "bg-white border-zinc-900 text-zinc-950 font-black"
                                : "border-zinc-400 text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                          <span className="font-bold"><RichCardText text={blkInfo.label} /></span>
                        </div>

                        {isSelected && (
                          <span className="text-[9px] font-mono font-bold bg-white px-1 py-0.2 rounded text-zinc-950">BLOCK</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* ブロックなし状態の表示 */}
                {currentBlockers.length === 0 && (
                  <div className="text-[10px] text-zinc-500 italic py-0.5 pl-1 font-mono">
                    （ブロックせず直接ダメージを受けます）
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 現在の割当てサマリー (スクロール領域内) */}
      <div className="pt-2 border-t border-zinc-200">
        <div className="p-2 rounded bg-zinc-50 border border-zinc-200 text-xs">
          <div className="font-mono font-bold text-zinc-500 text-[10px] uppercase mb-1">現在の割当て:</div>
          <div className="space-y-1">
            {attackers.map((attacker) => {
              const atkInfo = getUnitDisplay(attacker.unitId);
              const blkIds = assignments[attacker.unitId] || [];
              const blkLabels = blkIds.map((id) => {
                const info = getUnitDisplay(id);
                return info.label;
              });

              return (
                <div key={attacker.unitId} className="flex items-center gap-1.5 text-zinc-800 font-mono text-xs">
                  <span className="font-bold text-zinc-950"><RichCardText text={atkInfo.label} /></span>
                  <span className="text-zinc-400">←</span>
                  {blkLabels.length > 0 ? (
                    <span className="font-bold text-zinc-950">
                      {blkLabels.map((lbl, idx) => (
                        <React.Fragment key={idx}>
                          {idx > 0 && " + "}
                          <RichCardText text={lbl} />
                        </React.Fragment>
                      ))}
                    </span>
                  ) : (
                    <span className="text-zinc-400 italic">ブロックなし</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 決定ボタンのみを下部固定 (スマホ・タブレットでもアタッカー一覧を隠さず常時アクセス確保) */}
      <div
        data-testid="block-assignment-sticky-confirm"
        className="sticky bottom-0 z-10 bg-white/95 backdrop-blur-sm pt-1.5 pb-0.5 border-t border-zinc-200"
      >
        <button
          disabled={exactPatternRef === null}
          onClick={handleSubmit}
          className={`w-full py-2 px-4 rounded font-bold text-xs transition shadow-sm flex items-center justify-center gap-2 font-mono ${
            exactPatternRef !== null
              ? "bg-zinc-950 hover:bg-zinc-800 active:scale-95 text-white cursor-pointer font-black"
              : "bg-zinc-100 text-zinc-400 border border-zinc-200 cursor-not-allowed"
          }`}
        >
          <span>この割当てで決定</span>
        </button>
      </div>
    </div>
  );
};


