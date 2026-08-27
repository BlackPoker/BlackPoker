import React, { useState } from "react";
import { CardView } from "./CardView";
import { UnitCard } from "./UnitCard";
import { FogDetailPopover } from "./FogDetailPopover";
import type { UnitBattleDisplayInfo } from "./BattleRelationPresenter";

export interface PlayerBoardProps {
  playerKey: string;
  player: any;
  allPlayersFog?: any[];
  isCurrentDecisionPlayer: boolean;
  isTurnPlayer: boolean;
  isChancePlayer: boolean;
  showPrivateInfo: boolean;
  unitSelectionMarkers?: Map<string, { badge: string; isSelected: boolean }>;
  battleRelationMap?: Map<string, UnitBattleDisplayInfo>;
  onUnitClick?: (unitId: string) => void;
}

export const PlayerBoard: React.FC<PlayerBoardProps> = ({
  playerKey,
  player,
  allPlayersFog = [],
  isCurrentDecisionPlayer,
  isTurnPlayer,
  isChancePlayer,
  showPrivateInfo,
  unitSelectionMarkers,
  battleRelationMap,
  onUnitClick,
}) => {
  const [showGraveModal, setShowGraveModal] = useState(false);
  const [showLifeCards, setShowLifeCards] = useState(false);
  const [showFogModal, setShowFogModal] = useState(false);

  const lifeCount = Array.isArray(player.life) ? player.life.length : Number(player.life || 0);
  const handCards = Array.isArray(player.hand) ? player.hand : [];
  const fieldUnits = Array.isArray(player.field) ? player.field : [];
  const graveCards = Array.isArray(player.grave) ? player.grave : [];
  const playerFog = Array.isArray(player.fog) ? player.fog : [];

  return (
    <div
      className={`flex flex-col p-2.5 rounded-xl border-2 transition-all ${
        isChancePlayer
          ? "bg-amber-50/60 border-amber-500 shadow-md dark:bg-amber-950/20 dark:border-amber-500"
          : "bg-slate-50 border-slate-200 dark:bg-slate-900/60 dark:border-slate-800"
      }`}
    >
      {/* プレイヤーヘッダー */}
      <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
            {player.name || (playerKey === "p1" ? "Player A" : "Player B")}
          </span>
          <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
            {playerKey}
          </span>
          {isTurnPlayer && (
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-600 text-white">
              手番
            </span>
          )}
          {isChancePlayer && (
            <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-amber-500 text-slate-900 animate-pulse">
              ★ チャンス
            </span>
          )}
        </div>

        {/* ライフ・Fog・墓地表示 */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 bg-red-100 dark:bg-red-950/60 px-2 py-0.5 rounded-lg border border-red-300 dark:border-red-800">
            <span className="text-xs">❤️</span>
            <span className="text-[10px] font-bold text-red-800 dark:text-red-300">LIFE:</span>
            <span className="text-xs font-black text-red-600 dark:text-red-400">{lifeCount}</span>
          </div>

          <button
            onClick={() => setShowFogModal(true)}
            title="クリックして Fog 詳細を確認"
            className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/80 px-2 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold text-indigo-900 dark:text-indigo-300 cursor-pointer transition"
          >
            <span>🌫</span>
            <span>FOG: {playerFog.length}</span>
            <span className="text-[9px] opacity-60">🔍</span>
          </button>

          <button
            onClick={() => setShowGraveModal(!showGraveModal)}
            className="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            🪦 墓地 ({graveCards.length})
          </button>
        </div>
      </div>

      {/* Fog 詳細モーダル */}
      {showFogModal && (
        <FogDetailPopover
          playerKey={playerKey}
          playerName={player.name || (playerKey === "p1" ? "Player A" : "Player B")}
          fogs={playerFog}
          unitNumberMap={battleRelationMap}
          onClose={() => setShowFogModal(false)}
        />
      )}

      {/* フィールド (Units) */}
      <div className="mb-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 flex items-center justify-between">
          <span>FIELD (ユニット: {fieldUnits.length}体)</span>
        </div>

        <div className="flex flex-wrap gap-1.5 min-h-[90px] p-1.5 rounded-lg bg-slate-100/70 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800">
          {fieldUnits.length > 0 ? (
            fieldUnits.map((unit: any) => {
              // 全プレイヤーの Fog からこのユニットを対象とするものを集約
              const unitFogs = allPlayersFog.filter(
                (f: any) => f.bindings && f.bindings.target === unit.unitId
              );

              return (
                <UnitCard
                  key={unit.unitId}
                  unit={unit}
                  fogs={unitFogs}
                  showCardDetails={showPrivateInfo || unit.face !== "down"}
                  selectionMarker={unitSelectionMarkers?.get(unit.unitId)}
                  battleDisplayInfo={battleRelationMap?.get(unit.unitId)}
                  onClick={onUnitClick ? () => onUnitClick(unit.unitId) : undefined}
                />
              );
            })
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
        </div>

        <div className="flex flex-wrap gap-2 min-h-[80px] p-2 rounded-lg bg-slate-100/70 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 items-center">
          {handCards.length > 0 ? (
            handCards.map((card: any, idx: number) => (
              <CardView
                key={card.id || card.cardInstanceId || idx}
                card={card}
                faceDown={!showPrivateInfo}
                size="md"
              />
            ))
          ) : (
            <div className="text-xs text-slate-400 italic py-2 pl-1">手札なし</div>
          )}
        </div>
      </div>

      {/* 墓地モーダル */}
      {showGraveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border-2 border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <h3 className="font-extrabold text-sm text-slate-100">
                🪦 {player.name} の墓地 ({graveCards.length}枚)
              </h3>
              <button
                onClick={() => setShowGraveModal(false)}
                className="text-xs font-bold text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
              >
                ✕ 閉じる
              </button>
            </div>

            <div className="flex flex-wrap gap-2 max-h-[300px] overflow-y-auto p-2">
              {graveCards.length > 0 ? (
                graveCards.map((card: any, idx: number) => (
                  <CardView key={card.id || idx} card={card} faceDown={false} size="sm" />
                ))
              ) : (
                <div className="text-xs text-slate-500 italic py-4 text-center w-full">
                  墓地は空です
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
