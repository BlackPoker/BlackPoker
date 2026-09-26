import React, { useState } from "react";
import { CardView } from "./CardView";
import { MultiCardUnitStack } from "./MultiCardUnitStack";
import { UnitDetailModal } from "./UnitDetailModal";
import type { UnitBattleDisplayInfo } from "./BattleRelationPresenter";
import { getUnitDisplayName } from "../../engine/rules/characterUtils";
import { formatSuitSymbol } from "../../engine/rules/cardUtils";


export interface UnitCardProps {
  unit: any;
  field?: readonly any[];
  fogs?: readonly any[];
  showCardDetails?: boolean;
  selectionMarker?: {
    badge: string; // "①", "②" 等
    isSelected: boolean;
  };
  battleDisplayInfo?: UnitBattleDisplayInfo;
  onClick?: () => void;
}

export const UnitCard: React.FC<UnitCardProps> = ({
  unit,
  field = [],
  fogs,
  showCardDetails = true,
  selectionMarker,
  battleDisplayInfo,
  onClick,
}) => {
  const isBulwark = unit.componentId === "character.bulwark" || unit.kind === "防壁";
  const isFaceDown = unit.face === "down";
  const isDrive = unit.state === "drive";
  const battleRole = battleDisplayInfo?.role || unit.battle?.role;
  const unitDisplayName = getUnitDisplayName(unit, field);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // サイズ合計の計算（兵士のみ）
  const isHiddenFromViewer = isFaceDown && !showCardDetails;
  const baseSize = Array.isArray(unit.cards) && !isHiddenFromViewer
    ? unit.cards.reduce((sum: number, c: any) => sum + (c.value || 0), 0)
    : 0;

  // Engine の calculateUnitSize 結果 (currentSize) や unit.size があればそれを優先
  const unitSizeVal = unit.currentSize !== undefined ? unit.currentSize : unit.size;
  const displaySize = unitSizeVal !== undefined
    ? unitSizeVal
    : (isHiddenFromViewer ? "?" : baseSize);

  // 防壁の記載数字（本人には見える、相手には秘匿）
  const bulwarkRank = Array.isArray(unit.cards) && unit.cards.length > 0 && !isHiddenFromViewer
    ? unit.cards[0].rank || unit.cards[0].code || ""
    : "";

  const isClickable = !!onClick && !!selectionMarker;

  const handleClick = () => {
    if (isClickable) {
      onClick?.();
    } else {
      setShowDetailModal(true);
    }
  };

  // 防壁の位置番号 (B①, B②...)
  const bulwarkPos = battleDisplayInfo?.bulwarkPosition;
  const bulwarkPosBadge = bulwarkPos ? `B${bulwarkPos}` : "B";

  // モバイル表示用: 1枚目カードのフォーマット
  const primaryCard = Array.isArray(unit.cards) && unit.cards.length > 0 ? unit.cards[0] : null;
  let mobileCardText = "—";
  if (isHiddenFromViewer) {
    mobileCardText = "🂠";
  } else if (primaryCard) {
    const sym = formatSuitSymbol(primaryCard.suit);
    const rk = primaryCard.rank !== undefined ? String(primaryCard.rank) : "";
    mobileCardText = `${sym}${rk}`;
  }
  const extraCardCount = Array.isArray(unit.cards) && unit.cards.length > 1 ? unit.cards.length - 1 : 0;

  return (
    <div
      onClick={handleClick}
      title={`Debug ID: ${unit.unitId}`}
      className={`relative flex flex-col items-center p-1 sm:p-1.5 rounded border transition-all select-none min-w-[76px] sm:min-w-[104px] ${
        isClickable
          ? "cursor-pointer hover:border-zinc-950 hover:scale-[1.02] active:scale-[0.98]"
          : "cursor-pointer sm:cursor-default"
      } ${
        selectionMarker?.isSelected
          ? "bg-zinc-100 border-zinc-950 ring-2 ring-zinc-950 shadow-md"
          : selectionMarker
          ? "bg-zinc-50 border-zinc-600 ring-1 ring-zinc-600"
          : isBulwark
          ? isDrive
            ? "bg-zinc-100 border border-dashed border-zinc-400 opacity-75 text-zinc-700"
            : "bg-zinc-50 border-2 border-zinc-800 shadow-sm text-zinc-950"
          : isDrive
          ? "bg-zinc-100 border-zinc-300 opacity-80"
          : "bg-white border border-zinc-300 shadow-sm"
      }`}
    >
      {/* 選択可能・選択中バッジ (①, ②) - モバイルでは内側に寄せ見切れ防止 (-top-2 -left-1, w-5 h-5) */}
      {selectionMarker && (
        <div className="absolute -top-2 -left-1 sm:-top-3.5 sm:-left-2.5 z-20">
          <span
            className={`flex items-center justify-center w-5 h-5 sm:w-7 sm:h-7 rounded-full text-[10px] sm:text-sm font-mono font-black shadow-md border-2 ${
              selectionMarker.isSelected
                ? "bg-zinc-950 border-zinc-950 text-white ring-2 ring-zinc-950 scale-110"
                : "bg-white border-zinc-950 text-zinc-950 hover:bg-zinc-100"
            }`}
          >
            {selectionMarker.badge}
          </span>
        </div>
      )}

      {/* ===================== DESKTOP 表示 (sm:以上) ===================== */}
      <div className="hidden sm:flex flex-col items-center w-full">
        {/* ユニット種別 & 状態バッジ */}
        <div className="flex items-center justify-between w-full mb-1 gap-1">
          {isBulwark ? (
            <div className="flex items-center gap-1">
              <span
                className="bg-zinc-950 text-white font-mono font-black text-[10px] px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1 uppercase tracking-wider"
                title={bulwarkPos ? `防壁配置: ライフ側から ${bulwarkPos}` : undefined}
              >
                <span>{bulwarkPosBadge}</span>
                <span>防壁</span>
              </span>
              {battleDisplayInfo?.badge && (
                <span
                  className="text-[8px] font-mono font-normal text-zinc-500 bg-zinc-100 border border-zinc-300 rounded px-1 py-0.2"
                  title="Target番号"
                >
                  <span>{battleDisplayInfo.badge}</span>
                </span>
              )}
            </div>
          ) : (
            <span className="text-[9px] font-mono font-black px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider bg-zinc-100 text-zinc-800 border border-zinc-300">
              {battleDisplayInfo ? <span>{battleDisplayInfo.badge}</span> : null}
              <span>{unitDisplayName}</span>
            </span>
          )}

          <span
            className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
              isDrive
                ? "bg-zinc-100 text-zinc-500 border-zinc-300"
                : "bg-zinc-950 text-white border-zinc-950 font-black"
            }`}
          >
            {isDrive ? "DRIVE" : "CHARGE"}
          </span>
        </div>

        {/* バトルロールマーカー */}
        {battleRole === "attacker" && (
          <div className="w-full bg-zinc-950 text-white text-[9px] font-mono font-black text-center py-0.5 rounded mb-1 shadow-sm flex items-center justify-center gap-1 border border-zinc-950">
            <span>ATTACK 攻撃中</span>
            {battleDisplayInfo?.blockedByBadges && battleDisplayInfo.blockedByBadges.length > 0 && (
              <span className="bg-white text-zinc-950 px-1 rounded text-[8px] font-mono font-bold">
                ← {battleDisplayInfo.blockedByBadges.join(" ")}
              </span>
            )}
          </div>
        )}
        {battleRole === "blocker" && (
          <div className="w-full bg-zinc-100 text-zinc-950 text-[9px] font-mono font-black text-center py-0.5 rounded mb-1 shadow-sm flex items-center justify-center gap-1 border border-zinc-400">
            <span>BLOCK 防御中</span>
            {battleDisplayInfo?.targetBadge && (
              <span className="bg-zinc-950 text-white px-1 rounded text-[8px] font-mono font-bold">
                → {battleDisplayInfo.targetBadge}
              </span>
            )}
          </div>
        )}

        {/* カード本体表示 (DRIVE時は横向き rotate-90 & scale-95) */}
        <div
          className={`flex flex-col items-center justify-center transition-transform duration-200 ${
            isDrive ? "rotate-90 scale-95 my-3" : "my-1"
          }`}
        >
          <MultiCardUnitStack
            cards={Array.isArray(unit.cards) ? unit.cards : []}
            faceDown={isFaceDown && !showCardDetails}
            isDrive={isDrive}
            onOpenDetail={() => setShowDetailModal(true)}
          />
        </div>

        {/* Fog 表示 */}
        {!isBulwark && fogs && fogs.length > 0 && (
          <div className="w-full my-0.5 flex flex-wrap items-center justify-center gap-0.5">
            {fogs.slice(0, 3).map((f, idx) => {
              const amount = f.bindings?.amount || 0;
              const isUp = amount > 0;
              const cardCode = f.card?.code || (f.card?.suit && f.card?.rank ? `${f.card.suit}${f.card.rank}` : "");
              const formattedCard = cardCode
                .replace(/S/g, "♠")
                .replace(/H/g, "♡")
                .replace(/D/g, "♢")
                .replace(/C/g, "♣");
              const ownerLabel = f.ownerPlayerId === "p1" ? "A" : f.ownerPlayerId === "p2" ? "B" : "";

              return (
                <span
                  key={f.fogId || idx}
                  className="text-[8px] font-mono font-medium px-1 py-0 rounded bg-zinc-100 border border-zinc-200 text-zinc-600 inline-flex items-center gap-0.5"
                  title={`Fog: ${isUp ? "アップ" : "ダウン"} (${amount >= 0 ? `+${amount}` : amount}) ${ownerLabel ? `by Player ${ownerLabel}` : ""}`}
                  data-testid="fog-chip"
                >
                  <span>{`${isUp ? "↑" : "↓"}${Math.abs(amount)}`}</span>
                  {formattedCard && <span className="text-zinc-500 font-normal">[{formattedCard}]</span>}
                </span>
              );
            })}
            {fogs.length > 3 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDetailModal(true);
                }}
                className="text-[8px] font-mono px-1 py-0 rounded bg-zinc-200/80 text-zinc-600 hover:bg-zinc-300"
                title="他Fogの詳細を表示"
              >
                {`+${fogs.length - 3}`}
              </button>
            )}
          </div>
        )}

        {/* 下部情報表示: 兵士にはSIZE、防壁には防壁数字を表示 */}
        <div className="mt-1 pt-1 border-t border-zinc-200 w-full flex items-center justify-between text-[11px] font-mono">
          {isBulwark ? (
            <>
              <span className="text-zinc-500 text-[10px] font-bold">防壁数字:</span>
              <span className="font-black text-zinc-950 text-xs">
                {isHiddenFromViewer ? "?" : bulwarkRank || "—"}
              </span>
            </>
          ) : (
            <>
              <span className="text-zinc-500 text-[10px] font-bold">SIZE:</span>
              <span className="font-black text-zinc-950 text-xs">
                {isHiddenFromViewer ? "?" : displaySize}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ===================== MOBILE 要約表示 (sm:未満) ===================== */}
      <div className="flex sm:hidden flex-col w-full justify-between gap-0.5">
        {/* 1行目: 識別子 + 状態(↑/→) */}
        <div className="flex items-center justify-between w-full gap-0.5">
          {isBulwark ? (
            <div className="flex items-center gap-0.5 truncate">
              <span
                className="bg-zinc-950 text-white font-mono font-black text-[9px] px-1 py-0.2 rounded shadow-sm shrink-0"
                title={bulwarkPos ? `防壁配置: ライフ側から ${bulwarkPos}` : undefined}
              >
                {bulwarkPosBadge}
              </span>
              <span className="text-[9px] font-bold text-zinc-900 font-sans">防壁</span>
              {battleDisplayInfo?.badge && (
                <span className="text-[7px] font-mono text-zinc-400 shrink-0">
                  <span>{battleDisplayInfo.badge}</span>
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-0.5 truncate">
              {battleDisplayInfo && (
                <span className="bg-zinc-100 text-zinc-800 border border-zinc-300 font-mono font-black text-[9px] px-1 py-0.2 rounded shrink-0">
                  <span>{battleDisplayInfo.badge}</span>
                </span>
              )}
              <span className="text-[9px] font-bold text-zinc-900 font-sans truncate">
                {unitDisplayName}
              </span>
            </div>
          )}

          <span
            className={`text-[8px] font-mono font-bold px-1 py-0.2 rounded shrink-0 ${
              isDrive
                ? "bg-zinc-100 text-zinc-500 border border-zinc-300"
                : "bg-zinc-950 text-white font-black"
            }`}
            title={isDrive ? "Drive (→)" : "Charge (↑)"}
          >
            {isDrive ? "→" : "↑"}
          </span>
        </div>

        {/* バトルロール表示 (モバイル) */}
        {battleRole === "attacker" && (
          <div className="w-full bg-zinc-950 text-white text-[7px] font-mono font-black text-center py-0.2 rounded my-0.5">
            ATK 攻撃中
          </div>
        )}
        {battleRole === "blocker" && (
          <div className="w-full bg-zinc-100 border border-zinc-400 text-zinc-950 text-[7px] font-mono font-black text-center py-0.2 rounded my-0.5">
            BLK 防御中
          </div>
        )}

        {/* 2行目: カードスート/数字 + SIZE/数字 */}
        <div className="flex items-center justify-between w-full mt-0.5 pt-0.5 border-t border-zinc-200 text-[10px] font-mono">
          <div className="flex items-center gap-0.5">
            <span className="font-bold text-zinc-950 bp-card-glyph text-[13px]">
              {mobileCardText}
            </span>
            {extraCardCount > 0 && !isHiddenFromViewer && (
              <span className="text-[7px] font-mono text-zinc-500 bg-zinc-100 px-0.5 rounded border border-zinc-300">
                {`+${extraCardCount}`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <span className="text-[8px] text-zinc-400 font-bold">
              {isBulwark ? "数:" : "S:"}
            </span>
            <span className="font-black text-zinc-950 text-[11px]">
              {isBulwark
                ? (isHiddenFromViewer ? "?" : bulwarkRank || "—")
                : (isHiddenFromViewer ? "?" : displaySize)}
            </span>
          </div>
        </div>

        {/* Fog サマリー (モバイル) */}
        {!isBulwark && fogs && fogs.length > 0 && (
          <div className="mt-0.5 flex items-center justify-end gap-0.5 text-[7px] font-mono text-zinc-500">
            {fogs.slice(0, 2).map((f, idx) => {
              const amount = f.bindings?.amount || 0;
              return (
                <span key={idx} className="bg-zinc-100 px-0.5 rounded border border-zinc-200">
                  {`${amount >= 0 ? "↑" : "↓"}${Math.abs(amount)}`}
                </span>
              );
            })}
            {fogs.length > 2 && <span>+{fogs.length - 2}</span>}
          </div>
        )}
      </div>

      {/* 複数枚構成/詳細モーダル */}
      <UnitDetailModal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        unit={unit}
        unitDisplayName={unitDisplayName}
        isBulwark={isBulwark}
        isDrive={isDrive}
        displaySize={displaySize}
        bulwarkRank={bulwarkRank}
        showCardDetails={showCardDetails}
        isFaceDown={isFaceDown}
        fogs={fogs}
      />
    </div>
  );
};


