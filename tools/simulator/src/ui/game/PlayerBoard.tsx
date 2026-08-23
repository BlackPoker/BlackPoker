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
}

export const PlayerBoard: React.FC<PlayerBoardProps> = ({
  playerKey,
  player,
  isCurrentDecisionPlayer,
  isTurnPlayer,
  isChancePlayer,
  showPrivateInfo,
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
          <div
            onClick={() => setShowLifeCards(!showLifeCards)}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-100 border border-red-300 dark:bg-red-950/50 dark:border-red-800 rounded-lg cursor-pointer hover:bg-red-200 transition"
            title="クリックでライフカード一覧を展開"
          >
            <span className="text-sm font-bold text-red-700 dark:text-red-300">Playtest Life:</span>
            <span className="text-lg font-extrabold text-red-600 dark:text-red-400 font-mono">
              {lifeCount}
            </span>
            <span className="text-xs text-red-500">枚</span>
          </div>

          {/* 墓地ボタン */}
          <button
            onClick={() => setShowGraveModal(!showGraveModal)}
            className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700 transition"
          >
            墓地: {graveCards.length}
          </button>
        </div>
      </div>

      {/* ライフカード詳細 (折りたたみ) */}
      {showLifeCards && Array.isArray(player.life) && player.life.length > 0 && (
        <div className="mb-2 p-2 bg-red-50/50 dark:bg-red-950/20 rounded border border-red-200 dark:border-red-900/40">
          <div className="text-xs text-red-600 font-bold mb-1">ライフ山 (先頭が次ドロー/被弾):</div>
          <div className="flex flex-wrap gap-1">
            {player.life.map((c: any, i: number) => (
              <CardView key={c.id || i} card={c} faceDown={!showPrivateInfo} size="sm" />
            ))}
          </div>
        </div>
      )}

      {/* 墓地モーダル/ドロップダウン */}
      {showGraveModal && (
        <div className="mb-2 p-2 bg-slate-100 dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-700">
          <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            <span>墓地カード一覧 ({graveCards.length}枚):</span>
            <button
              onClick={() => setShowGraveModal(false)}
              className="text-slate-500 hover:text-slate-800 text-xs"
            >
              ✕ 閉じる
            </button>
          </div>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {graveCards.length === 0 ? (
              <span className="text-xs text-slate-400">墓地にカードはありません</span>
            ) : (
              graveCards.map((item: any, i: number) => {
                const cards = item.cards || (item.suit ? [item] : []);
                return cards.map((c: any, ci: number) => (
                  <CardView key={c.id || `${i}-${ci}`} card={c} size="sm" />
                ));
              })
            )}
          </div>
        </div>
      )}

      {/* フィールドエリア */}
      <div className="mb-3">
        <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
          フィールド (キャラクター):
        </div>
        <div className="flex flex-wrap gap-2 min-h-[90px] p-2 bg-white/70 dark:bg-slate-800/40 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
          {fieldUnits.length === 0 ? (
            <div className="w-full flex items-center justify-center text-xs text-slate-400 py-4">
              フィールドにユニットがいません
            </div>
          ) : (
            fieldUnits.map((u: any) => (
              <UnitCard key={u.unitId} unit={u} showCardDetails={showPrivateInfo} />
            ))
          )}
        </div>
      </div>

      {/* 手札エリア */}
      <div>
        <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
          <span>手札 ({handCards.length}枚):</span>
          {!showPrivateInfo && handCards.length > 0 && (
            <span className="text-[10px] text-slate-400 font-normal">※ 非公開 (枚数のみ表示)</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[50px] p-2 bg-white/70 dark:bg-slate-800/40 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
          {handCards.length === 0 ? (
            <div className="w-full flex items-center justify-center text-xs text-slate-400 py-2">
              手札なし
            </div>
          ) : (
            handCards.map((c: any, i: number) => (
              <CardView
                key={c.id || i}
                card={c}
                faceDown={!showPrivateInfo}
                size="md"
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
