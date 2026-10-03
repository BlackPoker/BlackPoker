import React, { useState, useMemo } from "react";
import { PlaytestMatchMode } from "../../engine/playtest/PlaytestSeatController";
import {
  CardOccurrenceSelection,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  RareCardSelectionService,
  RareCardCandidate,
} from "../../engine/regulation/RareCardSelectionService";

export interface RareCardSetupPanelProps {
  /** デッキプロファイル (SSOT) */
  readonly deckProfile: SimulatorDeckProfile;
  /** 必要レアカード枚数 */
  readonly rareCardCount: number;
  /** 対戦モード */
  readonly matchMode: PlaytestMatchMode;
  /** 確定済みのレアカード選択 */
  readonly confirmedSelections: {
    readonly p1?: readonly CardOccurrenceSelection[];
    readonly p2?: readonly CardOccurrenceSelection[];
  };
  /** レアカード確定コールバック */
  readonly onConfirmSelections: (selections: {
    readonly p1?: readonly CardOccurrenceSelection[];
    readonly p2?: readonly CardOccurrenceSelection[];
  }) => void;
  /** リセットコールバック */
  readonly onResetSelections: () => void;
}

type SetupStep = "p1_selecting" | "handoff" | "p2_selecting";

export const RareCardSetupPanel: React.FC<RareCardSetupPanelProps> = ({
  deckProfile,
  rareCardCount,
  matchMode,
  confirmedSelections,
  onConfirmSelections,
  onResetSelections,
}) => {
  const [internalStep, setInternalStep] = useState<SetupStep>("p1_selecting");
  const [localP1Selection, setLocalP1Selection] = useState<CardOccurrenceSelection[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);

  // 全候補カードの列挙 (SSOT)
  const candidates = useMemo(
    () => RareCardSelectionService.enumerateCandidates(deckProfile),
    [deckProfile]
  );

  // 確定完了フラグ
  const isP1Confirmed = (confirmedSelections.p1?.length ?? 0) === rareCardCount;
  const isP2Confirmed =
    matchMode === "humanVsAi" || (confirmedSelections.p2?.length ?? 0) === rareCardCount;
  const isAllConfirmed = isP1Confirmed && isP2Confirmed;
  const isSelectionComplete = selectedCandidateIds.length === rareCardCount;

  // 候補カードのスート別グループ化
  const groupedCandidates = useMemo(() => {
    const groups: { suit: string; label: string; cards: RareCardCandidate[] }[] = [
      { suit: "S", label: "スペード (♠)", cards: [] },
      { suit: "H", label: "ハート (♥)", cards: [] },
      { suit: "D", label: "ダイヤ (♦)", cards: [] },
      { suit: "C", label: "クラブ (♣)", cards: [] },
      { suit: "J", label: "ジョーカー (★)", cards: [] },
    ];
    for (const c of candidates) {
      const g = groups.find((grp) => grp.suit === c.suit) || groups[4];
      g.cards.push(c);
    }
    return groups.filter((g) => g.cards.length > 0);
  }, [candidates]);

  // トグル選択ハンドラ (上限 rareCardCount まで、選択中カードは解除)
  const handleToggleCandidate = (candidateId: string) => {
    setSelectedCandidateIds((prev) => {
      if (prev.includes(candidateId)) {
        return prev.filter((id) => id !== candidateId);
      }
      if (prev.length >= rareCardCount) {
        return prev;
      }
      return [...prev, candidateId];
    });
  };

  // リセットハンドラ
  const handleReset = () => {
    setInternalStep("p1_selecting");
    setLocalP1Selection([]);
    setSelectedCandidateIds([]);
    onResetSelections();
  };

  // P1 確定ハンドラ
  const handleConfirmP1 = () => {
    if (!isSelectionComplete) return;
    const selections: CardOccurrenceSelection[] = [];
    for (const id of selectedCandidateIds) {
      const matched = candidates.find((c) => c.id === id);
      if (!matched) return;
      selections.push({
        suit: matched.suit,
        rank: matched.rank,
        occurrence: matched.occurrence,
      });
    }

    if (matchMode === "humanVsHuman") {
      setLocalP1Selection(selections);
      setSelectedCandidateIds([]);
      setInternalStep("handoff");
    } else {
      // Human vs AI
      onConfirmSelections({ p1: selections });
      setSelectedCandidateIds([]);
    }
  };

  // Handoff 完了ハンドラ (Player B へ)
  const handleProceedToP2 = () => {
    setInternalStep("p2_selecting");
    setSelectedCandidateIds([]);
  };

  // P2 確定ハンドラ
  const handleConfirmP2 = () => {
    if (!isSelectionComplete) return;
    const selections: CardOccurrenceSelection[] = [];
    for (const id of selectedCandidateIds) {
      const matched = candidates.find((c) => c.id === id);
      if (!matched) return;
      selections.push({
        suit: matched.suit,
        rank: matched.rank,
        occurrence: matched.occurrence,
      });
    }

    onConfirmSelections({
      p1: localP1Selection,
      p2: selections,
    });
    setSelectedCandidateIds([]);
  };

  // 1. 全確定済み完了ビュー (プライバシー保護: カード情報は一切DOMに含まない)
  if (isAllConfirmed) {
    return (
      <div
        data-testid="rare-setup-completed"
        className="p-4 rounded-xl border border-emerald-300 bg-emerald-50 flex flex-col gap-3 font-mono"
      >
        <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-emerald-700 text-sm font-black">✓</span>
            <span className="text-xs font-bold text-emerald-950">
              レアカード設定完了 (Rare Card Ready)
            </span>
          </div>
          <button
            type="button"
            data-testid="reset-rare-button"
            onClick={handleReset}
            className="text-[11px] font-bold text-zinc-600 hover:text-zinc-950 px-2 py-1 rounded border border-zinc-300 bg-white hover:bg-zinc-50 transition min-h-[36px] cursor-pointer"
          >
            選択をやり直す
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-lg bg-white border border-emerald-200 flex items-center justify-between">
            <span className="font-bold text-zinc-800">
              {matchMode === "humanVsHuman" ? "Player A:" : "Player:"}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-700 font-bold">レアカード選択済み</span>
              <span className="text-[11px] text-emerald-600">({rareCardCount}枚)</span>
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-emerald-200 flex items-center justify-between">
            <span className="font-bold text-zinc-800">
              {matchMode === "humanVsHuman" ? "Player B:" : "AI:"}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-700 font-bold">
                {matchMode === "humanVsHuman" ? "レアカード選択済み" : "自動選択（非公開）"}
              </span>
              <span className="text-[11px] text-emerald-600">({rareCardCount}枚)</span>
            </div>
          </div>
        </div>

        <p className="text-[10px] text-emerald-800 leading-relaxed">
          ※レアカードは伏せられた状態でゲームが開始されます。対戦相手のレアカードは非公開情報として保護されています。
        </p>
      </div>
    );
  }

  // 2. Human vs Human: Handoff 画面 (プライバシー保護: P1のカード情報を一切表示しない)
  if (matchMode === "humanVsHuman" && internalStep === "handoff") {
    return (
      <div
        data-testid="rare-setup-handoff"
        className="p-6 rounded-xl border border-amber-300 bg-amber-50 flex flex-col items-center justify-center gap-4 text-center font-mono"
      >
        <div className="w-12 h-12 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center text-xl">
          🔄
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-black text-amber-950 mb-1">
            Player B に画面を渡してください
          </h3>
          <p className="text-xs text-amber-800 leading-relaxed max-w-md">
            Player A のレアカード選択は保護されました。画面を Player B に渡し、準備ができたら進んでください。
          </p>
        </div>
        <button
          type="button"
          data-testid="proceed-p2-button"
          onClick={handleProceedToP2}
          className="mt-2 px-6 py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center min-h-[44px] cursor-pointer"
        >
          <span>Player B の選択へ進む</span>
        </button>
      </div>
    );
  }

  // 3. 選択画面 (P1 selecting or P2 selecting)
  const isP2Step = matchMode === "humanVsHuman" && internalStep === "p2_selecting";
  const stepTitle = isP2Step
    ? "Player B: レアカード選択 (2/2)"
    : matchMode === "humanVsHuman"
    ? "Player A: レアカード選択 (1/2)"
    : "レアカード選択 (Player)";

  const stepPrompt = `デッキからレアカードとして伏せるカードを${rareCardCount}枚選んでください（非公開情報）`;

  return (
    <div
      data-testid="rare-setup-panel"
      className="p-4 rounded-xl border border-zinc-300 bg-zinc-50 flex flex-col gap-3 font-mono"
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
        <div>
          <h3 className="text-xs sm:text-sm font-black text-zinc-950 flex items-center gap-1.5">
            <span>🎴</span>
            <span>{stepTitle}</span>
          </h3>
          <p className="text-[11px] text-zinc-600 mt-0.5">{stepPrompt}</p>
        </div>
        {matchMode === "humanVsAi" && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-200 text-zinc-700">
            AI: 自動選択
          </span>
        )}
      </div>

      {/* カード選択候補グリッド */}
      <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
        {groupedCandidates.map((group) => (
          <div key={group.suit} className="flex flex-col gap-1">
            <div className="text-[10px] font-bold text-zinc-500">{group.label}</div>
            <div className="grid grid-cols-7 sm:grid-cols-13 gap-1">
              {group.cards.map((candidate) => {
                const isSelected = selectedCandidateIds.includes(candidate.id);
                const isHeartOrDiamond = candidate.suit === "H" || candidate.suit === "D";
                const isJoker = candidate.suit === "J";

                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => handleToggleCandidate(candidate.id)}
                    aria-label={candidate.displayLabel}
                    className={`min-h-[44px] min-w-[36px] p-1 rounded-lg border text-xs font-bold transition flex flex-col items-center justify-center cursor-pointer select-none ${
                      isSelected
                        ? "bg-zinc-950 text-white border-zinc-950 shadow-md ring-2 ring-zinc-950 ring-offset-1"
                        : "bg-white hover:bg-zinc-100 text-zinc-900 border-zinc-200 shadow-sm"
                    }`}
                  >
                    <span
                      className={`text-[11px] font-black ${
                        isSelected
                          ? "text-white"
                          : isHeartOrDiamond
                          ? "text-red-600"
                          : isJoker
                          ? "text-purple-600"
                          : "text-zinc-900"
                      }`}
                    >
                      {candidate.suit === "S"
                        ? "♠"
                        : candidate.suit === "H"
                        ? "♥"
                        : candidate.suit === "D"
                        ? "♦"
                        : candidate.suit === "C"
                        ? "♣"
                        : "★"}
                    </span>
                    <span className="text-[10px] leading-none">{candidate.rank}</span>
                    {candidate.occurrence > 0 && (
                      <span className="text-[8px] opacity-75 leading-none">#{candidate.occurrence + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* アクションフッター */}
      <div className="pt-2 border-t border-zinc-200 flex items-center justify-between gap-3">
        <div className="text-[11px] text-zinc-600">
          <span className="font-bold text-zinc-900">
            {`選択中: ${selectedCandidateIds.length} / ${rareCardCount} 枚`}
          </span>
          {selectedCandidateIds.length === 0 && (
            <span className="text-zinc-500 ml-2">（カードをクリックして選択）</span>
          )}
        </div>

        <button
          type="button"
          data-testid="confirm-rare-button"
          disabled={!isSelectionComplete}
          onClick={isP2Step ? handleConfirmP2 : handleConfirmP1}
          className={`px-5 py-2 text-xs font-bold rounded-lg shadow-sm transition flex items-center justify-center min-h-[44px] cursor-pointer ${
            isSelectionComplete
              ? "bg-zinc-950 hover:bg-zinc-800 text-white"
              : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
          }`}
        >
          <span>このレアカードで確定</span>
        </button>
      </div>
    </div>
  );
};
