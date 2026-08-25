import React, { useState } from "react";
import { CardView } from "./CardView";
import { UnitCard } from "./UnitCard";

export interface PlayerBoardProps {
  playerKey: string;
  player: any;
  isCurrentDecisionPlayer: boolean;
  isTurnPlayer: boolean;
  isChancePlayer: boolean;
  showPrivateInfo: boolean;
  unitSelectionMarkers?: Map<string, { badge: string; isSelected: boolean }>;
  onUnitClick?: (unitId: string) => void;
}

export const PlayerBoard: React.FC<PlayerBoardProps> = ({
  playerKey,
  player,
  isCurrentDecisionPlayer,
  isTurnPlayer,
  isChancePlayer,
  showPrivateInfo,
  unitSelectionMarkers,
  onUnitClick,
}) => {
  const [showGraveModal, setShowGraveModal] = useState(false);
  const [showLifeCards, setShowLifeCards] = useState(false);

  const lifeCount = Array.isArray(player.life) ? player.life.length : Number(player.life || 0);
  const handCards = Array.isArray(player.hand) ? player.hand : [];
  const fieldUnits = Array.isArray(player.field) ? player.field : [];
  const graveCards = Array.isArray(player.grave) ? player.grave : [];

  return (
    <div
      className={`flex flex-col p-3 rounded-xl border-2 transition-all ${
        isChancePlayer
          ? "bg-amber-50/60 border-amber-500 shadow-md dark:bg-amber-950/20 dark:border-amber-500"
          : "bg-slate-50 border-slate-200 dark:bg-slate-900/60 dark:border-slate-800"
      }`}
    >
      {/* プレイヤーヘッダー */}
      <div className="flex items-center justify-between border-b pb-2 mb-2 border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-base font-extrabold text-slate-800 dark:text-slate-100">
            {player.name || (playerKey === "p1" ? "Player A" : "Player B")}
          </span>
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
            {playerKey}
          </span>
          {isTurnPlayer && (
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-600 text-white">
              手番
            </span>
          )}
          {isChancePlayer && (
            <span className="text-xs font-extrabold px-2 py-0.5 rounded bg-amber-500 text-slate-900 animate-pulse">
              ★ チャンス中
            </span>
          )}
        </div>

        {/* ライフ表示 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-red-100 dark:bg-red-950/60 px-3 py-1 rounded-lg border border-red-300 dark:border-red-800">
            <span className="text-sm">❤️</span>
            <span className="text-xs font-bold text-red-800 dark:text-red-300">LIFE:</span>
            <span className="text-sm font-black text-red-600 dark:text-red-400">{lifeCount}</span>
          </div>

          <button
            onClick={() => setShowGraveModal(!showGraveModal)}
            className="text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            🪦 墓地 ({graveCards.length})
          </button>
        </div>
      </div>

      {/* フィールド (Units) */}
      <div className="mb-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex items-center justify-between">
          <span>FIELD (ユニット: {fieldUnits.length}体)</span>
        </div>

        <div className="flex flex-wrap gap-2 min-h-[120px] p-2 rounded-lg bg-slate-100/70 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800">
          {fieldUnits.length > 0 ? (
            fieldUnits.map((unit: any) => (
              <UnitCard
                key={unit.unitId}
                unit={unit}
                showCardDetails={showPrivateInfo || unit.face !== "down"}
                selectionMarker={unitSelectionMarkers?.get(unit.unitId)}
                onClick={onUnitClick ? () => onUnitClick(unit.unitId) : undefined}
              />
            ))
          ) : (
            <div className="flex items-center justify-center w-full text-xs text-slate-400 italic">
              ユニットなし
            </div>
          )}
        </div>
      </div>

      {/* 手札 (Hand) */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex items-center justify-between">
          <span>HAND (手札: {handCards.length}枚)</span>
          {!showPrivateInfo && <span className="text-[10px] text-amber-500">※ 非公開情報 (裏向き)</span>}
        </div>

        <div className="flex flex-wrap gap-1.5 min-h-[60px] p-2 rounded-lg bg-slate-100/50 dark:bg-slate-950/30 border border-slate-200 dark:border-slate-800">
          {handCards.length > 0 ? (
            handCards.map((card: any, idx: number) => (
              <CardView key={card.id || idx} card={card} faceDown={!showPrivateInfo} size="sm" />
            ))
          ) : (
            <div className="flex items-center justify-center w-full text-xs text-slate-400 italic">
              手札なし
            </div>
          )}
        </div>
      </div>

      {/* 墓地モーダル */}
      {showGraveModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl p-4 max-w-md w-full shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <span>🪦</span>
                <span>{player.name || playerKey} の墓地 ({graveCards.length}枚)</span>
              </h3>
              <button
                onClick={() => setShowGraveModal(false)}
                className="text-slate-400 hover:text-white text-sm font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto p-2 bg-slate-950/60 rounded-xl border border-slate-800">
              {graveCards.length > 0 ? (
                graveCards.map((c: any, idx: number) => (
                  <CardView key={c.id || idx} card={c} size="sm" />
                ))
              ) : (
                <div className="text-xs text-slate-500 py-4 text-center w-full italic">
                  墓地にカードはありません
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
