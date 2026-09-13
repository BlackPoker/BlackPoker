import React, { useState } from "react";
import { CardView } from "./CardView";
import { UnitCard } from "./UnitCard";
import { FogDetailPopover } from "./FogDetailPopover";
import { PlayerZoneStrip, ZoneSummaryItem } from "./PlayerZoneStrip";
import { PlayerBoardViewModel } from "./PlayerObservationPresenter";
import type { UnitBattleDisplayInfo } from "./BattleRelationPresenter";

export interface PlayerBoardProps {
  readonly playerKey: string;
  readonly viewModel: PlayerBoardViewModel;
  readonly allPlayersFog?: readonly any[];
  readonly unitSelectionMarkers?: Map<string, { badge: string; isSelected: boolean }>;
  readonly battleRelationMap?: Map<string, UnitBattleDisplayInfo>;
  readonly onUnitClick?: (unitId: string) => void;
  readonly position?: "top" | "bottom";
}

function formatSuit(suit?: string): string {
  if (!suit) return "";
  switch (suit) {
    case "S": return "♠";
    case "H": return "♡";
    case "D": return "♢";
    case "C": return "♣";
    default: return suit;
  }
}

/**
 * プレイヤー盤面コンポーネント。
 * 通常盤面の入力は PlayerBoardViewModel のみを唯一の正とし、Raw GameState へのフォールバックは行いません。
 */
export const PlayerBoard: React.FC<PlayerBoardProps> = ({
  playerKey,
  viewModel,
  allPlayersFog = [],
  unitSelectionMarkers,
  battleRelationMap,
  onUnitClick,
  position = "bottom",
}) => {
  const [showGraveModal, setShowGraveModal] = useState(false);
  const [showFogModal, setShowFogModal] = useState(false);

  // 全ての表示情報は ViewModel のみを正とする (fail-closed)
  const name = viewModel.name;
  const isTurnPlayer = viewModel.isTurnPlayer;
  const isChancePlayer = viewModel.isChancePlayer;
  const lifeDisplay = viewModel.lifeDisplay;
  const handCards = viewModel.handCards;
  const handCount = viewModel.handCount;
  const fieldUnits = viewModel.fieldUnits;
  const graveCards = viewModel.graveCards;
  const graveCount = viewModel.graveCount;
  const canViewFullGrave = viewModel.canViewFullGrave;
  const playerFog = viewModel.fog;
  const isViewer = viewModel.isViewer;

  // 墓地トップカードの表示用バッジ
  const graveTopBadge = viewModel.graveTopCard
    ? `TOP: ${formatSuit(viewModel.graveTopCard.suit)}${viewModel.graveTopCard.rank || ""}`
    : undefined;

  // ZoneStrip 用アイテム（将来の切札・Pack・Rare Card 拡張に対応）
  const zoneItems: ZoneSummaryItem[] = [
    {
      id: "fog",
      label: "FOG",
      count: playerFog.length,
      onClick: () => setShowFogModal(true),
    },
    {
      id: "grave",
      label: "墓地",
      count: graveCount,
      badge: graveTopBadge,
      onClick: () => setShowGraveModal(true),
    },
  ];

  // フィールドユニットの兵士・防壁分離
  const soldierUnits = fieldUnits.filter(
    (u: any) => u.componentId !== "character.bulwark" && u.kind !== "防壁"
  );
  const bulwarkUnits = fieldUnits.filter(
    (u: any) => u.componentId === "character.bulwark" || u.kind === "防壁"
  );

  const renderUnitCard = (unit: any) => {
    const unitFogs = allPlayersFog.filter(
      (f: any) => f.bindings && f.bindings.target === unit.unitId
    );

    return (
      <UnitCard
        key={unit.unitId}
        unit={unit}
        field={fieldUnits}
        fogs={unitFogs}
        showCardDetails={isViewer || unit.face !== "down"}
        selectionMarker={unitSelectionMarkers?.get(unit.unitId)}
        battleDisplayInfo={battleRelationMap?.get(unit.unitId)}
        onClick={onUnitClick ? () => onUnitClick(unit.unitId) : undefined}
      />
    );
  };

  // 兵士列 (中央寄り)
  const soldierRow = soldierUnits.length > 0 ? (
    <div className="flex flex-col gap-0.5">
      <div className="text-[9px] font-mono font-bold text-zinc-500 flex items-center justify-between">
        <span>兵士 ({soldierUnits.length}体)</span>
      </div>
      <div className="flex gap-1.5 p-1 rounded bg-zinc-50 border border-zinc-200 items-center overflow-x-auto no-scrollbar">
        {soldierUnits.map((u: any) => renderUnitCard(u))}
      </div>
    </div>
  ) : null;

  // 防壁列 (外側・右詰め / ライフ側から ①, ②...)
  // 画面表示を左→右で見ると [③] [②] [①] となり ① がライフ側(右端)
  const bulwarkRow = bulwarkUnits.length > 0 ? (
    <div className="flex flex-col gap-0.5">
      <div className="text-[9px] font-mono font-bold text-zinc-500 flex items-center justify-end">
        <span>防壁 ({bulwarkUnits.length}体・ライフ側 →)</span>
      </div>
      <div className="flex gap-1.5 p-1 rounded bg-zinc-50 border border-zinc-200 items-center justify-end overflow-x-auto no-scrollbar">
        {[...bulwarkUnits].reverse().map((u: any) => renderUnitCard(u))}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`flex flex-col p-2 rounded border transition-all ${
        isChancePlayer
          ? "bg-white border-zinc-950 shadow-md ring-2 ring-zinc-950"
          : isTurnPlayer
          ? "bg-white border-zinc-500 shadow-sm"
          : "bg-white border-zinc-200"
      }`}
    >
      {/* 1. プレイヤーサマリーヘッダー (PlayerSummary) */}
      <div className="flex flex-wrap items-center justify-between border-b pb-1.5 mb-1.5 border-zinc-200 gap-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-zinc-950 tracking-wide">
            {name}
          </span>
          <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-zinc-100 text-zinc-700 border border-zinc-300">
            {playerKey.toUpperCase()}
          </span>
          {isTurnPlayer && (
            <span className="text-[9px] font-mono font-black px-1.5 py-0.2 rounded bg-zinc-200 text-zinc-900 border border-zinc-400">
              TURN
            </span>
          )}
          {isChancePlayer && (
            <span className="text-[9px] font-mono font-black px-1.5 py-0.2 rounded bg-zinc-950 text-white shadow-sm">
              CHANCE
            </span>
          )}
        </div>

        {/* ライフ & 手札サマリー */}
        <div className="flex items-center gap-1.5 font-mono">
          <div className="flex items-center gap-1 bg-zinc-100 px-2 py-0.5 rounded border border-zinc-300 text-zinc-950 min-h-[26px]">
            <span className="text-[10px] font-bold text-zinc-500">LIFE:</span>
            <span className="text-xs font-black text-zinc-950">{lifeDisplay}</span>
          </div>

          <div className="flex items-center gap-1 bg-zinc-100 px-2 py-0.5 rounded border border-zinc-300 text-zinc-950 min-h-[26px]">
            <span className="text-[10px] font-bold text-zinc-500">HAND:</span>
            <span className="text-xs font-black text-zinc-950">{handCount}</span>
          </div>
        </div>
      </div>

      {/* 2. Zone Strip (Fog, 墓地, 将来の拡張Zone) */}
      <PlayerZoneStrip items={zoneItems} className="mb-1.5" />

      {/* Fog 詳細モーダル (公開情報) */}
      {showFogModal && (
        <FogDetailPopover
          playerKey={playerKey}
          playerName={name}
          fogs={playerFog}
          unitNumberMap={battleRelationMap}
          onClose={() => setShowFogModal(false)}
        />
      )}

      {/* 墓地一覧モーダル（自分の墓地: 全件、相手の墓地: 公開トップのみ） */}
      {showGraveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white border border-zinc-300 rounded-lg p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-2 mb-3">
              <h3 className="text-sm font-bold text-zinc-950 font-serif">
                {name} の墓地 ({canViewFullGrave ? `${graveCount}枚` : "公開情報"})
              </h3>

              <button
                onClick={() => setShowGraveModal(false)}
                className="w-7 h-7 flex items-center justify-center rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-mono transition active:scale-95 min-h-[32px] min-w-[32px]"
              >
                ✕
              </button>
            </div>

            {!canViewFullGrave ? (
              <div className="flex flex-col gap-2 p-2 bg-zinc-50 rounded border border-zinc-200">
                <div className="text-xs text-zinc-600 font-mono">
                  総枚数: <span className="font-bold text-zinc-950">{graveCount} 枚</span>（相手の墓地全体は非公開）
                </div>
                {viewModel.graveTopCard ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-zinc-700 font-mono">墓地トップ（公開）:</span>
                    <CardView card={viewModel.graveTopCard} size="sm" />
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400 italic py-2">墓地は空です</div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-60 overflow-y-auto p-2 bg-zinc-50 rounded border border-zinc-200">
                {graveCards.length > 0 ? (
                  graveCards.map((c: any, i: number) => (
                    <CardView key={c.id || i} card={c} size="sm" />
                  ))
                ) : (
                  <div className="text-xs text-zinc-500 italic py-4 w-full text-center">墓地は空です</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. フィールド (Units) - 兵士列 / 防壁列の分離 */}
      <div className="mb-1.5">
        <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-500 mb-0.5 flex items-center justify-between">
          <span>FIELD (ユニット: {fieldUnits.length}体)</span>
        </div>

        <div className="flex flex-col gap-1.5">
          {fieldUnits.length === 0 ? (
            <div className="flex items-center justify-center w-full text-xs text-zinc-400 italic py-2 rounded bg-zinc-50 border border-zinc-200">
              ユニットなし
            </div>
          ) : position === "top" ? (
            // Top (奥/相手側): 外側に防壁、中央(下)に兵士
            <>
              {bulwarkRow}
              {soldierRow}
            </>
          ) : (
            // Bottom (手前/操作側): 中央(上)に兵士、外側(下)に防壁
            <>
              {soldierRow}
              {bulwarkRow}
            </>
          )}
        </div>
      </div>

      {/* 4. 手札 (Hand) - 相手手札は枚数のみ、自分手札はカード内容表示 */}
      <div>
        {!isViewer ? (
          <div className="flex items-center justify-between px-2 py-1 rounded bg-zinc-50 border border-zinc-200 text-xs font-mono">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">HAND</span>
            <span className="text-xs font-black text-zinc-950 font-mono">手札 {handCount}枚</span>
          </div>
        ) : (
          <div>
            <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-500 mb-0.5 flex items-center justify-between">
              <span>HAND (手札: {handCount}枚)</span>
            </div>

            <div className="flex gap-1.5 min-h-[60px] p-1.5 rounded bg-zinc-50 border border-zinc-200 items-center overflow-x-auto no-scrollbar">
              {handCards.length > 0 ? (
                handCards.map((card: any, idx: number) => (
                  <CardView
                    key={card.id || card.cardInstanceId || idx}
                    card={card}
                    faceDown={Boolean(card.faceDown)}
                    size="md"
                  />
                ))
              ) : (
                <div className="text-xs text-zinc-400 italic py-1 pl-1">手札なし</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
