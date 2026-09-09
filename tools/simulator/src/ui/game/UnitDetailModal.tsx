import React from "react";
import { CardView } from "./CardView";

export interface UnitDetailModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly unit: any;
  readonly unitDisplayName: string;
  readonly isBulwark: boolean;
  readonly isDrive: boolean;
  readonly displaySize: number | string;
  readonly bulwarkRank?: string;
  readonly showCardDetails: boolean;
  readonly isFaceDown: boolean;
  readonly fogs?: readonly any[];
}

/**
 * ユニットの構成カードおよび状態の詳細を表示するモーダルコンポーネント。
 * 複数枚構成ユニット（装備兵、巨人、魔王など）の構成カード全件を閲覧できます。
 */
export const UnitDetailModal: React.FC<UnitDetailModalProps> = ({
  isOpen,
  onClose,
  unit,
  unitDisplayName,
  isBulwark,
  isDrive,
  displaySize,
  bulwarkRank,
  showCardDetails,
  isFaceDown,
  fogs = [],
}) => {
  if (!isOpen) return null;

  const isHiddenFromViewer = isFaceDown && !showCardDetails;
  const cards: readonly any[] = Array.isArray(unit?.cards) ? unit.cards : [];
  const cardCount = cards.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in cursor-default"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      data-testid="unit-detail-modal-backdrop"
    >
      <div
        className="w-full max-w-sm bg-white border border-zinc-300 rounded-xl p-4 shadow-2xl flex flex-col gap-3 font-sans select-text text-zinc-950"
        onClick={(e) => e.stopPropagation()}
        data-testid="unit-detail-modal-container"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold font-serif">{unitDisplayName}</span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-zinc-100 border border-zinc-300 text-zinc-700 font-bold">
              {isBulwark ? "防壁" : "兵士"}
            </span>
            <span
              className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                isDrive
                  ? "bg-zinc-100 text-zinc-500 border border-zinc-300"
                  : "bg-zinc-950 text-white"
              }`}
            >
              {isDrive ? "DRIVE" : "CHARGE"}
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-xs font-mono transition"
            title="閉じる"
            data-testid="unit-detail-modal-close-btn"
          >
            ✕
          </button>
        </div>

        {/* 状態・SIZEサマリー */}
        <div className="flex items-center justify-between bg-zinc-50 p-2 rounded border border-zinc-200 text-xs font-mono">
          <div>
            <span className="text-zinc-500 font-bold mr-1">状態:</span>
            <span className="font-black text-zinc-900">
              {isDrive ? "DRIVE (行動済)" : "CHARGE (未行動)"}
            </span>
          </div>
          <div>
            <span className="text-zinc-500 font-bold mr-1">{isBulwark ? "防壁数字:" : "SIZE:"}</span>
            <span className="font-black text-zinc-950 text-sm">
              {isBulwark ? (isHiddenFromViewer ? "?" : bulwarkRank || "—") : (isHiddenFromViewer ? "?" : displaySize)}
            </span>
          </div>
        </div>

        {/* 構成カード一覧 */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-between">
            <span>{`構成カード (${cardCount}枚)`}</span>
            {isHiddenFromViewer && <span className="text-[9px] text-amber-600">※ 相手には非公開</span>}
          </div>
          <div className="flex flex-wrap gap-2 p-2.5 bg-zinc-50 rounded border border-zinc-200 min-h-[50px] items-center">
            {cardCount === 0 ? (
              <div className="text-xs text-zinc-400 italic">カードなし</div>
            ) : (
              cards.map((c: any, i: number) => (
                <div key={c.id || i} className="flex flex-col items-center gap-0.5">
                  <CardView card={c} faceDown={isHiddenFromViewer} size="md" />
                  <span className="text-[8px] font-mono text-zinc-400">{isHiddenFromViewer ? "???" : `#${i + 1}`}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 付与 Fog 一覧 */}
        {!isBulwark && fogs.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">
              {`付与 Fog (${fogs.length}件)`}
            </div>
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto p-1.5 bg-zinc-50 rounded border border-zinc-200 text-xs font-mono">
              {fogs.map((f, i) => {
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
                  <div key={f.fogId || i} className="flex items-center justify-between p-1 rounded bg-white border border-zinc-200">
                    <span className="flex items-center gap-1 font-bold">
                      <span className={isUp ? "text-emerald-700" : "text-rose-700"}>
                        {isUp ? "↑ アップ" : "↓ ダウン"}
                      </span>
                      <span className="font-black">{`(${amount >= 0 ? `+${amount}` : amount})`}</span>
                      {formattedCard && <span className="text-zinc-600 font-medium">[{formattedCard}]</span>}
                    </span>
                    {ownerLabel && <span className="text-[9px] text-zinc-400">{`by ${ownerLabel}`}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 閉じるボタン */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="w-full py-1.5 bg-zinc-950 hover:bg-zinc-800 active:scale-98 text-white font-mono font-bold text-xs rounded transition min-h-[36px]"
        >
          閉じる
        </button>
      </div>
    </div>
  );
};
