import React from "react";
import { CardView } from "./CardView";

export interface UnitCardProps {
  unit: any;
  showCardDetails?: boolean;
}

export const UnitCard: React.FC<UnitCardProps> = ({ unit, showCardDetails = true }) => {
  const isBulwark = unit.componentId === "character.bulwark" || unit.kind === "防壁";
  const isFaceDown = unit.face === "down";
  const isDrive = unit.state === "drive";
  const battleRole = unit.battle?.role;
  const blocksUnitId = unit.battle?.blocksUnitId;

  // サイズ合計の計算
  const totalSize = Array.isArray(unit.cards)
    ? unit.cards.reduce((sum: number, c: any) => sum + (c.value || 0), 0)
    : 0;

  return (
    <div
      className={`relative flex flex-col items-center p-2 rounded-xl border-2 transition-all shadow-sm ${
        isBulwark
          ? isDrive
            ? "bg-amber-100/50 border-amber-400/60 opacity-80 dark:bg-amber-950/30 dark:border-amber-700"
            : "bg-amber-50/90 border-amber-500 dark:bg-amber-950/40 dark:border-amber-400 shadow-md ring-1 ring-amber-400/30"
          : isDrive
          ? "bg-slate-200/80 border-slate-400 opacity-75 dark:bg-slate-800/80 dark:border-slate-600"
          : "bg-white border-indigo-400 dark:bg-slate-700 dark:border-indigo-500 shadow-md"
      }`}
      style={{
        minWidth: "110px",
      }}
    >
      {/* ユニット種別 & 状態バッジ */}
      <div className="flex items-center justify-between w-full mb-1">
        <span
          className={`text-[10px] font-black px-1.5 py-0.5 rounded shadow-sm ${
            isBulwark
              ? "bg-amber-500 text-slate-900 font-extrabold"
              : "bg-indigo-600 text-white"
          }`}
        >
          {isBulwark ? "🛡 防壁" : "⚔ 兵士"}
        </span>

        <span
          className={`text-[9px] font-bold px-1 py-0.5 rounded ${
            isDrive
              ? "bg-slate-400 text-slate-900 dark:bg-slate-600 dark:text-slate-200"
              : "bg-emerald-500 text-white animate-pulse"
          }`}
        >
          {isDrive ? "DRIVE (横)" : "CHARGE (縦)"}
        </span>
      </div>

      {/* バトルロールマーカー */}
      {battleRole === "attacker" && (
        <div className="w-full bg-red-600 text-white text-[11px] font-extrabold text-center py-0.5 rounded mb-1 shadow animate-bounce">
          ⚔ ATTACKER
        </div>
      )}
      {battleRole === "blocker" && (
        <div className="w-full bg-blue-600 text-white text-[10px] font-extrabold text-center py-0.5 rounded mb-1 shadow">
          🛡 BLOCKER {blocksUnitId ? `→ ${blocksUnitId.slice(-4)}` : ""}
        </div>
      )}

      {/* 構成カード描画 */}
      <div className={`flex gap-1 my-1 transition-transform ${isDrive ? "rotate-12 scale-90" : ""}`}>
        {Array.isArray(unit.cards) && unit.cards.length > 0 ? (
          unit.cards.map((c: any, idx: number) => (
            <CardView
              key={c.id || idx}
              card={c}
              faceDown={isBulwark && isFaceDown && !showCardDetails}
              size="md"
            />
          ))
        ) : (
          <div className="w-12 h-16 border-dashed border-2 border-slate-300 rounded flex items-center justify-center text-xs text-slate-400">
            空
          </div>
        )}
      </div>

      {/* ユニット情報フッター */}
      <div className="w-full flex items-center justify-between text-[10px] font-mono mt-1 pt-1 border-t border-slate-200 dark:border-slate-600">
        <span className="text-slate-500" title={`ID: ${unit.unitId}`}>
          #{unit.unitId.slice(-5)}
        </span>
        <span className="font-bold text-slate-800 dark:text-slate-200">
          {isBulwark && isFaceDown && !showCardDetails ? "Size: ?" : `Size: ${totalSize}`}
        </span>
      </div>
    </div>
  );
};
