import React, { useState, useMemo } from "react";
import { PlaytestMatchMode } from "../../engine/playtest/PlaytestSeatController";
import {
  CardOccurrenceSelection,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  ScenarioHandSelectionService,
  ScenarioHandCandidate,
} from "../../engine/regulation/ScenarioHandSelectionService";
import { formatOfficialSuitSymbol, isRedSuit } from "../../engine/rules/cardUtils";

export interface ScenarioHandSetupPanelProps {
  /** デッキプロファイル (SSOT) */
  readonly deckProfile: SimulatorDeckProfile;
  /** 必要シナリオ手札枚数 */
  readonly scenarioHandCount: number;
  /** 対戦モード */
  readonly matchMode: PlaytestMatchMode;
  /** 確定済みのシナリオ手札選択 */
  readonly confirmedSelections: {
    readonly p1?: readonly CardOccurrenceSelection[];
    readonly p2?: readonly CardOccurrenceSelection[];
  };
  /** シナリオ手札確定コールバック */
  readonly onConfirmSelections: (selections: {
    readonly p1?: readonly CardOccurrenceSelection[];
    readonly p2?: readonly CardOccurrenceSelection[];
  }) => void;
  /** リセットコールバック */
  readonly onResetSelections: () => void;
}

type SetupStep = "p1_selecting" | "handoff" | "p2_selecting";

export const ScenarioHandSetupPanel: React.FC<ScenarioHandSetupPanelProps> = ({
  deckProfile,
  scenarioHandCount,
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
    () => ScenarioHandSelectionService.enumerateCandidates(deckProfile),
    [deckProfile]
  );

  // 確定完了フラグ
  const isP1Confirmed = (confirmedSelections.p1?.length ?? 0) === scenarioHandCount;
  const isP2Confirmed =
    matchMode === "humanVsAi" || (confirmedSelections.p2?.length ?? 0) === scenarioHandCount;
  const isAllConfirmed = isP1Confirmed && isP2Confirmed;
  const isSelectionComplete = selectedCandidateIds.length === scenarioHandCount;

  // 候補カードのスート別グループ化
  const groupedCandidates = useMemo(() => {
    const groups: { suit: string; label: string; cards: ScenarioHandCandidate[] }[] = [
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

  // トグル選択ハンドラ (上限 scenarioHandCount 枚、選択済みは解除)
  const handleToggleCandidate = (candidateId: string) => {
    setSelectedCandidateIds((prev) => {
      if (prev.includes(candidateId)) {
        return prev.filter((id) => id !== candidateId);
      }
      if (prev.length >= scenarioHandCount) {
        return prev; // 4枚目は追加不可
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
        data-testid="scenario-setup-completed"
        className="p-4 rounded-xl border border-blue-300 bg-blue-50 flex flex-col gap-3 font-mono"
      >
        <div className="flex items-center justify-between border-b border-blue-200 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-blue-700 text-sm font-black">✓</span>
            <span className="text-xs font-bold text-blue-950">
              シナリオ手札設定完了 (Scenario Hand Ready)
            </span>
          </div>
          <button
            type="button"
            data-testid="reset-scenario-button"
            onClick={handleReset}
            className="text-[11px] font-bold text-zinc-600 hover:text-zinc-950 px-2 py-1 rounded border border-zinc-300 bg-white hover:bg-zinc-50 transition min-h-[36px] cursor-pointer"
          >
            選択をやり直す
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-lg bg-white border border-blue-200 flex items-center justify-between">
            <span className="font-bold text-zinc-800">
              {matchMode === "humanVsHuman" ? "Player A:" : "Player:"}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-blue-700 font-bold">シナリオ手札選択済み</span>
              <span className="text-[11px] text-blue-600">{`(${scenarioHandCount}枚)`}</span>
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-blue-200 flex items-center justify-between">
            <span className="font-bold text-zinc-800">
              {matchMode === "humanVsHuman" ? "Player B:" : "AI:"}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-blue-700 font-bold">
                {matchMode === "humanVsHuman" ? "シナリオ手札選択済み" : "自動選択（非公開）"}
              </span>
              <span className="text-[11px] text-blue-600">{`(${scenarioHandCount}枚)`}</span>
            </div>
          </div>
        </div>

        <p className="text-[10px] text-blue-800 leading-relaxed">
          ※シナリオ手札はゲーム開始時に最初の手札へ入ります。対戦相手のシナリオ手札は非公開情報として保護されています。
        </p>
      </div>
    );
  }

  // 2. Human vs Human: Handoff 画面 (プライバシー保護: P1のカード情報を一切表示しない)
  if (matchMode === "humanVsHuman" && internalStep === "handoff") {
    return (
      <div
        data-testid="scenario-setup-handoff"
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
            Player A のシナリオ手札は保護されました。画面を Player B に渡し、準備ができたら進んでください。
          </p>
        </div>
        <button
          type="button"
          data-testid="proceed-p2-scenario-button"
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
    ? `Player B: シナリオ手札選択 (2/2)`
    : matchMode === "humanVsHuman"
    ? `Player A: シナリオ手札選択 (1/2)`
    : "シナリオ手札選択 (Player)";

  const stepPrompt = `デッキから最初の手札に入れるカードを${scenarioHandCount}枚選んでください（非公開情報）`;

  return (
    <div
      data-testid="scenario-setup-panel"
      className="p-4 rounded-xl border border-zinc-300 bg-zinc-50 flex flex-col gap-3 font-mono"
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
        <div>
          <h3 className="text-xs sm:text-sm font-black text-zinc-950 flex items-center gap-1.5">
            <span>📜</span>
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
                const isRed = isRedSuit(candidate.suit);
                const isJoker = candidate.suit === "J";
                const suitSymbol = isJoker ? "★" : formatOfficialSuitSymbol(candidate.suit);

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
                      className={`bp-card-suit text-[16px] leading-none ${
                        isSelected
                          ? "text-white"
                          : isRed
                          ? "text-[#a22041] bp-card-suit-red"
                          : "text-zinc-900"
                      }`}
                    >
                      {suitSymbol}
                    </span>
                    <span
                      className={`bp-card-rank text-[12px] font-bold leading-none ${
                        isSelected ? "text-white" : "text-zinc-900"
                      }`}
                    >
                      {candidate.rank}
                    </span>
                    {candidate.occurrence > 0 && (
                      <span className="text-[8px] font-sans opacity-75 leading-none mt-0.5">#{candidate.occurrence + 1}</span>
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
            {`選択中: ${selectedCandidateIds.length} / ${scenarioHandCount} 枚`}
          </span>
          {selectedCandidateIds.length < scenarioHandCount && (
            <span className="text-zinc-500 ml-2">（あと {scenarioHandCount - selectedCandidateIds.length} 枚選択してください）</span>
          )}
        </div>

        <button
          type="button"
          data-testid="confirm-scenario-button"
          disabled={!isSelectionComplete}
          onClick={isP2Step ? handleConfirmP2 : handleConfirmP1}
          className={`px-5 py-2 text-xs font-bold rounded-lg shadow-sm transition flex items-center justify-center min-h-[44px] cursor-pointer ${
            isSelectionComplete
              ? "bg-zinc-950 hover:bg-zinc-800 text-white"
              : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
          }`}
        >
          <span>このシナリオ手札で確定</span>
        </button>
      </div>
    </div>
  );
};
