import React from "react";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { SheetMode } from "../game/MobileBottomSheet";

export interface MobileDecisionDockProps {
  readonly request: DecisionRequest | null;
  readonly onOpenSheet: () => void;
  readonly onSubmit: (response: DecisionResponse, options?: { autoPass?: boolean }) => void;
  readonly sheetMode: SheetMode;
}

export const MobileDecisionDock: React.FC<MobileDecisionDockProps> = ({
  request,
  onOpenSheet,
  onSubmit,
  sheetMode,
}) => {
  if (!request) {
    return null;
  }

  const isEffectResolution = request.source.type === "EFFECT_RESOLUTION";
  const playerName = request.playerId === "p1" ? "Player A" : "Player B";

  // PASS パターンの検索（UI独自判定ではなく、request.patterns内のkind === "PASS"のみ使用）
  const passPatternIndex = request.patterns.findIndex((p) => p.kind === "PASS");
  const hasPass = passPatternIndex !== -1;

  const handlePassClick = () => {
    if (passPatternIndex === -1) return;
    onSubmit({
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: passPatternIndex,
    });
  };

  const isSheetOpen = sheetMode !== "collapsed";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-zinc-300 shadow-2xl p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <div className="max-w-md mx-auto flex flex-col gap-1.5">
        {/* サマリーバー */}
        <div className="flex items-center justify-between text-[11px] font-mono px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-zinc-950 animate-pulse" />
            <span className="font-bold text-zinc-950">
              {playerName} の{isEffectResolution ? "効果選択" : "行動選択"}
            </span>
          </div>
          <span className="text-zinc-500 text-[10px]">
            {isEffectResolution ? "EFFECT" : `${request.patterns.length} 選択肢`}
          </span>
        </div>

        {/* アクションボタン群 (min-h-[44px] 確保) */}
        <div className="flex items-center gap-2">
          {/* PASS ボタン (PASS が可能な場合のみ表示・有効化) */}
          {hasPass && (
            <button
              onClick={handlePassClick}
              className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border-2 border-zinc-400 bg-white hover:bg-zinc-100 active:bg-zinc-200 text-zinc-950 font-mono font-black text-xs shadow-sm transition flex items-center justify-center gap-1"
            >
              <span>PASS</span>
            </button>
          )}

          {/* 行動・効果選択ボタン（collapsed 時は「選択を続ける」「行動を選ぶ」） */}
          <button
            onClick={onOpenSheet}
            className={`flex-[2] min-h-[44px] px-4 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 active:scale-98 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5 font-serif tracking-wide ${
              isSheetOpen ? "ring-2 ring-zinc-950" : ""
            }`}
          >
            <span>
              {isEffectResolution
                ? "効果・割当てを選択"
                : isSheetOpen
                ? "選択中..."
                : "行動を選ぶ"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
