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
      className={`relative flex flex-col items-center p-2 rounded-xl border-2 transition-all shadow-sm ${
        isClickable ? "cursor-pointer hover:scale-105 active:scale-95" : ""
      } ${
        selectionMarker?.isSelected
          ? "bg-amber-100 border-amber-500 ring-4 ring-amber-400/80 shadow-lg dark:bg-amber-950/60 dark:border-amber-400"
          : selectionMarker
          ? "bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400/50 hover:border-amber-400 dark:bg-emerald-950/30 dark:border-emerald-500"
          : isBulwark
          ? isDrive
            ? "bg-amber-950/30 border-amber-500/80 opacity-85 shadow"
            : "bg-amber-500/10 border-amber-500 shadow-md ring-1 ring-amber-400/50 dark:bg-amber-950/50 dark:border-amber-400"
          : isDrive
          ? "bg-slate-200/80 border-slate-400 opacity-75 dark:bg-slate-800/80 dark:border-slate-600"
          : "bg-white border-indigo-400 dark:bg-slate-700 dark:border-indigo-500 shadow-md"
      }`}
      style={{
        minWidth: "112px",
      }}
    >
      {/* 選択可能・選択中バッジ (①, ②) */}
      {selectionMarker && (
        <div className="absolute -top-3 -left-2 z-10">
          <span
            className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-black shadow-md border ${
              selectionMarker.isSelected
                ? "bg-amber-400 border-amber-300 text-slate-950 ring-2 ring-amber-300 animate-bounce"
                : "bg-emerald-500 border-emerald-300 text-white"
            }`}
          >
            {selectionMarker.badge}
          </span>
        </div>
      )}

      {/* ユニット種別 & 状態バッジ */}
      <div className="flex items-center justify-between w-full mb-1 gap-1">
        <span
          className={`text-[10px] font-black px-1.5 py-0.5 rounded shadow-sm flex items-center gap-0.5 ${
            isBulwark
              ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black border border-amber-300"
              : "bg-indigo-600 text-white"
          }`}
        >
          {battleDisplayInfo ? `${battleDisplayInfo.badge} ` : ""}{isBulwark ? "🛡 防壁" : "⚔ 兵士"}
        </span>

        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
            isDrive
              ? "bg-amber-600/80 text-white font-bold"
              : "bg-emerald-600 text-white font-bold"
          }`}
        >
          {isDrive ? "🔄 DRIVE" : "⚡ CHARGE"}
        </span>
      </div>

      {/* バトルロールマーカー */}
      {battleRole === "attacker" && (
        <div className="w-full bg-red-600 text-white text-[10px] font-black text-center py-0.5 rounded mb-1 shadow-sm flex items-center justify-center gap-1">
          <span>⚔ 攻撃中</span>
          {battleDisplayInfo?.blockedByBadges && battleDisplayInfo.blockedByBadges.length > 0 && (
            <span className="bg-red-950/80 px-1 rounded text-red-200 font-mono">
              ← {battleDisplayInfo.blockedByBadges.join(" ")}
            </span>
          )}
        </div>
      )}
      {battleRole === "blocker" && (
        <div className="w-full bg-blue-600 text-white text-[10px] font-black text-center py-0.5 rounded mb-1 shadow-sm flex items-center justify-center gap-1">
          <span>🛡 防御中</span>
          {battleDisplayInfo?.targetBadge && (
            <span className="bg-blue-950/80 px-1 rounded text-blue-200 font-mono">
              → {battleDisplayInfo.targetBadge}
            </span>
          )}
        </div>
      )}

      {/* カード本体表示 (DRIVE時は横向き rotate-90 & scale-95) */}
      <div
        className={`flex flex-col items-center justify-center transition-transform duration-200 ${
          isDrive ? "rotate-90 scale-95 my-3.5" : "my-1"
        }`}
      >
        {showCardDetails || !isFaceDown ? (
          Array.isArray(unit.cards) && unit.cards.length > 0 ? (
            unit.cards.map((card: any, idx: number) => (
              <CardView key={card.id || idx} card={card} faceDown={isFaceDown && !showCardDetails} size="sm" />
            ))
          ) : (
            <div className="text-xs text-slate-400 italic py-2">カードなし</div>
          )
        ) : (
          <CardView faceDown={true} size="sm" />
        )}
      </div>

      {/* Fog バッジ一覧表示 (兵士のみ) */}
      {!isBulwark && fogs && fogs.length > 0 && (
        <div className="w-full my-1 flex flex-col gap-1">
          {fogs.map((f, idx) => {
            const amount = f.bindings?.amount || 0;
            const isUp = amount > 0;
            const cardCode = f.card?.code || (f.card?.suit && f.card?.rank ? `${f.card.suit}${f.card.rank}` : "");
            const formattedCard = cardCode
              .replace(/S/g, "♠")
              .replace(/H/g, "♡")
              .replace(/D/g, "♢")
              .replace(/C/g, "♣");
            const ownerLabel = f.ownerPlayerId === "p1" ? "Player A" : f.ownerPlayerId === "p2" ? "Player B" : "";

            return (
              <div
                key={f.fogId || idx}
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center justify-between border ${
                  isUp
                    ? "bg-rose-950/40 border-rose-500/60 text-rose-300 dark:bg-rose-950/60 dark:border-rose-400"
                    : "bg-cyan-950/40 border-cyan-500/60 text-cyan-300 dark:bg-cyan-950/60 dark:border-cyan-400"
                }`}
                title={`Fog: ${isUp ? "アップ" : "ダウン"} (${amount >= 0 ? `+${amount}` : amount}) ${ownerLabel ? `by ${ownerLabel}` : ""}`}
              >
                <span className="flex items-center gap-0.5">
                  <span>{isUp ? "↑" : "↓"}</span>
                  <span className="font-extrabold">{amount >= 0 ? `+${amount}` : amount}</span>
                  {formattedCard && <span className="font-mono ml-0.5 font-bold">[{formattedCard}]</span>}
                </span>
                {ownerLabel && (
                  <span className="text-[8px] opacity-75 font-sans">
                    {ownerLabel === "Player A" ? "A" : "B"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 下部情報表示: 兵士にはSIZE、防壁にはSIZEを出さず数字のみまたは防壁バッジを表示 */}
      <div className="mt-1 pt-1 border-t border-slate-200 dark:border-slate-700 w-full flex items-center justify-between text-[11px]">
        {isBulwark ? (
          <>
            <span className="text-amber-500 dark:text-amber-400 font-bold">防壁数字:</span>
            <span className="font-extrabold text-amber-600 dark:text-amber-300 font-mono">
              {isHiddenFromViewer ? "🂠" : bulwarkRank || "—"}
            </span>
          </>
        ) : (
          <>
            <span className="text-slate-500 dark:text-slate-400 font-bold">SIZE:</span>
            <span className="font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">
              {isHiddenFromViewer ? "?" : displaySize}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
