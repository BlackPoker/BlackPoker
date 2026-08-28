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
  const [showFogModal, setShowFogModal] = useState(false);

  const lifeCount = Array.isArray(player.life) ? player.life.length : Number(player.life || 0);
  const handCards = Array.isArray(player.hand) ? player.hand : [];
  const fieldUnits = Array.isArray(player.field) ? player.field : [];
  const graveCards = Array.isArray(player.grave) ? player.grave : [];
  const playerFog = Array.isArray(player.fog) ? player.fog : [];

  return (
    <div
      className={`flex flex-col p-2 rounded-xl border transition-all ${
        isChancePlayer
          ? "bg-[#141418] border-zinc-300 shadow-md ring-1 ring-zinc-400/40"
          : isTurnPlayer
          ? "bg-[#121215] border-zinc-600 shadow-sm"
          : "bg-[#0e0e12] border-zinc-800/80"
      }`}
    >
      {/* プレイヤーヘッダー */}
      <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 border-zinc-800">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-serif font-black text-white tracking-wide">
            {player.name || (playerKey === "p1" ? "Player A" : "Player B")}
          </span>
          <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
            {playerKey.toUpperCase()}
          </span>
          {isTurnPlayer && (
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-zinc-700 text-zinc-100 border border-zinc-600">
              TURN
            </span>
          )}
          {isChancePlayer && (
            <span className="text-[9px] font-mono font-black px-1.5 py-0.2 rounded bg-white text-zinc-950 shadow-sm">
              ★ CHANCE
            </span>
          )}
        </div>

        {/* ライフ・Fog・墓地表示 */}
        <div className="flex items-center gap-1.5 font-mono">
          <div className="flex items-center gap-1 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700 text-white">
            <span className="text-[10px] font-bold text-zinc-400">LIFE:</span>
            <span className="text-xs font-black text-white">{lifeCount}</span>
          </div>

          <button
            onClick={() => setShowFogModal(true)}
            title="クリックして Fog 詳細を確認"
            className="flex items-center gap-1 bg-zinc-900 hover:bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700 text-[10px] font-bold text-zinc-200 cursor-pointer transition"
          >
            <span>FOG: {playerFog.length}</span>
          </button>

          <button
            onClick={() => setShowGraveModal(!showGraveModal)}
            className="text-[10px] font-bold px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
          >
            墓地 ({graveCards.length})
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

      {/* 墓地一覧モーダル */}
      {showGraveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-600 rounded-xl p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
              <h3 className="text-sm font-bold text-white font-serif">
                {player.name || playerKey} の墓地 ({graveCards.length}枚)
              </h3>

              <button
                onClick={() => setShowGraveModal(false)}
                className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 text-zinc-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-60 overflow-y-auto p-2 bg-zinc-950 rounded border border-zinc-800">
              {graveCards.length > 0 ? (
                graveCards.map((c: any, i: number) => (
                  <CardView key={c.id || i} card={c} size="sm" />
                ))
              ) : (
                <div className="text-xs text-zinc-500 italic py-4 w-full text-center">墓地は空です</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* フィールド (Units) */}
      <div className="mb-1.5">
        <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-0.5 flex items-center justify-between">
          <span>FIELD (ユニット: {fieldUnits.length}体)</span>
        </div>

        <div className="flex flex-wrap gap-1.5 min-h-[75px] p-1.5 rounded-lg bg-zinc-950/60 border border-zinc-800/80 items-center">
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
            <div className="flex items-center justify-center w-full text-xs text-zinc-600 italic py-1">
              ユニットなし
            </div>
          )}
        </div>
      </div>

      {/* 手札 (Hand) */}
      <div>
        <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-0.5 flex items-center justify-between">
          <span>HAND (手札: {handCards.length}枚)</span>
        </div>

        <div className="flex flex-wrap gap-1.5 min-h-[65px] p-1.5 rounded-lg bg-zinc-950/60 border border-zinc-800/80 items-center">
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
            <div className="text-xs text-zinc-600 italic py-1 pl-1">手札なし</div>
          )}
        </div>
      </div>
    </div>
  );
};

