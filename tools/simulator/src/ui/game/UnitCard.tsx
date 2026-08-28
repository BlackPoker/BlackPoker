import React from "react";
import { CardView } from "./CardView";
import type { UnitBattleDisplayInfo } from "./BattleRelationPresenter";

export interface UnitCardProps {
  unit: any;
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

  // サイズ合計の計算（兵士のみ）
  const isHiddenFromViewer = isFaceDown && !showCardDetails;
  const baseSize = Array.isArray(unit.cards) && !isHiddenFromViewer
    ? unit.cards.reduce((sum: number, c: any) => sum + (c.value || 0), 0)
    : 0;

  // Engine の calculateUnitSize 結果 (currentSize) があればそれを最優先
  const displaySize = unit.currentSize !== undefined
    ? unit.currentSize
    : (isHiddenFromViewer ? "?" : baseSize);

  // 防壁の記載数字（本人には見える、相手には秘匿）
  const bulwarkRank = Array.isArray(unit.cards) && unit.cards.length > 0 && !isHiddenFromViewer
    ? unit.cards[0].rank || unit.cards[0].code || ""
    : "";

  const isClickable = !!onClick && !!selectionMarker;

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      title={`Debug ID: ${unit.unitId}`}
      className={`relative flex flex-col items-center p-1.5 rounded border transition-all select-none ${
        isClickable ? "cursor-pointer hover:border-white hover:scale-[1.02] active:scale-[0.98]" : ""
      } ${
        selectionMarker?.isSelected
          ? "bg-[#1f1f1f] border-white ring-2 ring-white shadow-lg"
          : selectionMarker
          ? "bg-[#181818] border-zinc-400 ring-1 ring-zinc-400"
          : isBulwark
          ? isDrive
            ? "bg-[#121212] border-2 border-zinc-600 border-dashed opacity-75"
            : "bg-[#161616] border-2 border-zinc-300 shadow"
          : isDrive
          ? "bg-[#121212] border border-zinc-700 opacity-75"
          : "bg-[#161616] border border-zinc-700 shadow-sm"
      }`}
      style={{
        minWidth: "104px",
      }}
    >
      {/* 選択可能・選択中バッジ (①, ②) */}
      {selectionMarker && (
        <div className="absolute -top-2.5 -left-1.5 z-10">
          <span
            className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-mono font-black shadow border ${
              selectionMarker.isSelected
                ? "bg-white border-zinc-950 text-zinc-950 ring-2 ring-white"
                : "bg-zinc-800 border-zinc-400 text-zinc-100"
            }`}
          >
            {selectionMarker.badge}
          </span>
        </div>
      )}


      {/* ユニット種別 & 状態バッジ */}
      <div className="flex items-center justify-between w-full mb-1 gap-1">
        <span
          className={`text-[9px] font-mono font-black px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase tracking-wider ${
            isBulwark
              ? "bg-white text-zinc-950 font-black border border-zinc-300"
              : "bg-zinc-800 text-zinc-200 border border-zinc-700"
          }`}
        >
          {battleDisplayInfo ? `${battleDisplayInfo.badge} ` : ""}{isBulwark ? "防壁" : "兵士"}
        </span>

        <span
          className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
            isDrive
              ? "bg-zinc-800/90 text-zinc-400 border-zinc-700"
              : "bg-zinc-100 text-zinc-900 border-zinc-300 font-black"
          }`}
        >
          {isDrive ? "DRIVE" : "CHARGE"}
        </span>
      </div>

      {/* バトルロールマーカー */}
      {battleRole === "attacker" && (
        <div className="w-full bg-white text-zinc-950 text-[9px] font-mono font-black text-center py-0.5 rounded mb-1 shadow-sm flex items-center justify-center gap-1 border border-zinc-300">
          <span>ATTACK 攻撃中</span>
          {battleDisplayInfo?.blockedByBadges && battleDisplayInfo.blockedByBadges.length > 0 && (
            <span className="bg-zinc-900 text-zinc-100 px-1 rounded text-[8px] font-mono font-bold">
              ← {battleDisplayInfo.blockedByBadges.join(" ")}
            </span>
          )}
        </div>
      )}
      {battleRole === "blocker" && (
        <div className="w-full bg-zinc-800 text-zinc-100 text-[9px] font-mono font-black text-center py-0.5 rounded mb-1 shadow-sm flex items-center justify-center gap-1 border border-zinc-600">
          <span>BLOCK 防御中</span>
          {battleDisplayInfo?.targetBadge && (
            <span className="bg-zinc-950 text-zinc-300 px-1 rounded text-[8px] font-mono font-bold border border-zinc-700">
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
        {showCardDetails || !isFaceDown ? (
          Array.isArray(unit.cards) && unit.cards.length > 0 ? (
            unit.cards.map((card: any, idx: number) => (
              <CardView key={card.id || idx} card={card} faceDown={isFaceDown && !showCardDetails} size="sm" />
            ))
          ) : (
            <div className="text-xs text-zinc-500 italic py-2">カードなし</div>
          )
        ) : (
          <CardView faceDown={true} size="sm" />
        )}
      </div>

      {/* Fog バッジ一覧表示 (兵士のみ) */}
      {!isBulwark && fogs && fogs.length > 0 && (
        <div className="w-full my-1 flex flex-col gap-0.5">
          {fogs.map((f, idx) => {
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
              <div
                key={f.fogId || idx}
                className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center justify-between border bg-zinc-950/80 border-zinc-700 text-zinc-200"
                title={`Fog: ${isUp ? "アップ" : "ダウン"} (${amount >= 0 ? `+${amount}` : amount}) ${ownerLabel ? `by Player ${ownerLabel}` : ""}`}
              >
                <span className="flex items-center gap-0.5">
                  <span className="font-extrabold">{isUp ? "↑" : "↓"}</span>
                  <span className="font-black">{amount >= 0 ? `+${amount}` : amount}</span>
                  {formattedCard && <span className="font-bold ml-0.5 text-zinc-300">[{formattedCard}]</span>}
                </span>
                {ownerLabel && (
                  <span className="text-[8px] text-zinc-400 font-mono">
                    {ownerLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 下部情報表示: 兵士にはSIZE、防壁には防壁数字を表示 */}
      <div className="mt-1 pt-1 border-t border-zinc-800 w-full flex items-center justify-between text-[11px] font-mono">
        {isBulwark ? (
          <>
            <span className="text-zinc-400 text-[10px] font-bold">防壁数字:</span>
            <span className="font-black text-white text-xs">
              {isHiddenFromViewer ? "?" : bulwarkRank || "—"}
            </span>
          </>
        ) : (
          <>
            <span className="text-zinc-400 text-[10px] font-bold">SIZE:</span>
            <span className="font-black text-white text-xs">
              {isHiddenFromViewer ? "?" : displaySize}
            </span>
          </>
        )}
      </div>

    </div>
  );
};

