import React from "react";
import { CardView } from "./CardView";

export interface MultiCardUnitStackProps {
  readonly cards: readonly any[];
  readonly faceDown?: boolean;
  readonly isDrive?: boolean;
  readonly onOpenDetail?: (e: React.MouseEvent) => void;
}

/**
 * 複数枚カード構成ユニットの汎用スタック表示コンポーネント。
 * 1枚の場合は通常のコンパクト表示、2枚以上の場合はFan/Stack表示と枚数バッジを表示します。
 * カード枚数が10枚等に増えても、UnitCardの高さが比例して増大しないよう固定フットプリントを保ちます。
 */
export const MultiCardUnitStack: React.FC<MultiCardUnitStackProps> = ({
  cards = [],
  faceDown = false,
  isDrive = false,
  onOpenDetail,
}) => {
  const cardCount = cards.length;

  if (cardCount === 0) {
    return <div className="text-xs text-zinc-400 italic py-2">カードなし</div>;
  }

  // 1枚のみの場合: 従来の通常コンパクト表示
  if (cardCount === 1) {
    return (
      <div className="flex flex-col items-center justify-center">
        <CardView card={cards[0]} faceDown={faceDown} size="sm" />
      </div>
    );
  }

  // 2枚以上の場合: スタック / ファン表示
  // 前面に cards[0] を完全に表示し、背後に1〜2枚のカード端をオフセット配置してスタック感を演出
  const hasSecondLayer = cardCount >= 2;
  const hasThirdLayer = cardCount >= 3;

  return (
    <div className="flex flex-col items-center justify-center py-1">
      <div
        className="relative flex items-center justify-center cursor-pointer group"
        style={{
          width: "44px",
          height: "46px",
        }}
        onClick={(e) => {
          if (onOpenDetail) {
            e.stopPropagation();
            onOpenDetail(e);
          }
        }}
        title={`複数枚構成ユニット (${cardCount}枚) - クリックで詳細を表示`}
        data-testid="multi-card-stack"
      >
        {/* 最背面レイヤー (3枚以上の場合) */}
        {hasThirdLayer && (
          <div
            className="absolute rounded border border-zinc-400 bg-zinc-200 shadow-xs pointer-events-none transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5"
            style={{
              width: "32px",
              height: "40px",
              left: "-4px",
              top: "-4px",
              zIndex: 1,
            }}
          />
        )}

        {/* 中間レイヤー (2枚以上の場合) */}
        {hasSecondLayer && (
          <div
            className="absolute rounded border border-zinc-400 bg-zinc-100 shadow-xs pointer-events-none transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5"
            style={{
              width: "32px",
              height: "40px",
              left: "-2px",
              top: "-2px",
              zIndex: 2,
            }}
          >
            {/* 2枚目のスーツ・ランクがチラ見えする演出 */}
            {!faceDown && cards[1] && (
              <span className="text-[8px] font-mono font-bold text-zinc-500 pl-0.5 leading-none">
                {cards[1].rank || ""}
              </span>
            )}
          </div>
        )}

        {/* 前面メインカード (cards[0]) */}
        <div className="relative z-10">
          <CardView card={cards[0]} faceDown={faceDown} size="sm" />
        </div>

        {/* 枚数バッジ (×N) */}
        <div className="absolute -bottom-1 -right-2 z-20">
          <span
            className="px-1 py-0.2 rounded-full bg-zinc-950 text-white text-[9px] font-mono font-black border border-white shadow-sm"
            data-testid="multi-card-count-badge"
          >
            {`×${cardCount}`}
          </span>
        </div>
      </div>

      {/* 詳細確認ボタン (タップしやすい導線・ユニット選択イベント伝播を防止) */}
      {onOpenDetail && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail(e);
          }}
          className="mt-1 px-1.5 py-0.2 text-[8px] font-mono font-bold rounded bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 border border-zinc-300 transition flex items-center gap-0.5"
          title="カード構成の詳細を確認"
          data-testid="multi-card-detail-button"
        >
          <span>詳細</span>
        </button>
      )}
    </div>
  );
};
