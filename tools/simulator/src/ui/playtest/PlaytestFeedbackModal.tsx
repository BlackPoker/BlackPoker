import React, { useState } from "react";
import {
  HumanFeedbackCategory,
  HUMAN_FEEDBACK_CATEGORY_LABELS,
  PlaytestHumanFeedbackEntryV1,
  createHumanFeedbackEntry,
  exportSanitizedPlaytestFeedbackBundle,
} from "./PlaytestFeedbackTypes";
import { PlaytestDecisionTranscriptEntryV1 } from "./PlaytestDecisionTranscript";
import { PlaytestDiagnosticBundleV1 } from "./PlaytestDiagnosticBundle";
import { downloadJsonFile } from "../utils/downloadJson";

export interface PlaytestFeedbackModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly transcript: readonly PlaytestDecisionTranscriptEntryV1[];
  readonly feedbacks: readonly PlaytestHumanFeedbackEntryV1[];
  readonly onAddFeedback: (feedback: PlaytestHumanFeedbackEntryV1) => void;
  readonly onDeleteFeedback: (feedbackId: string) => void;
  readonly diagnosticBundle: PlaytestDiagnosticBundleV1 | null;
  readonly matchSeed?: number;
  readonly aiGenomeId?: string;
  readonly aiDnaDigest?: string;
}

export const PlaytestFeedbackModal: React.FC<PlaytestFeedbackModalProps> = ({
  isOpen,
  onClose,
  transcript,
  feedbacks,
  onAddFeedback,
  onDeleteFeedback,
  diagnosticBundle,
  matchSeed,
  aiGenomeId,
  aiDnaDigest,
}) => {
  if (!isOpen) return null;

  // AI (policy) の行動のみをフィルタ
  const aiEntries = transcript.filter((t) => t.actor === "policy");
  const latestAiEntry = aiEntries.length > 0 ? aiEntries[aiEntries.length - 1] : null;

  const [selectedDecisionId, setSelectedDecisionId] = useState<string>(
    latestAiEntry?.decisionId || ""
  );
  const [selectedCategory, setSelectedCategory] = useState<HumanFeedbackCategory>("WHY_NO_ATTACK");
  const [note, setNote] = useState<string>("");

  const targetEntry = aiEntries.find((t) => t.decisionId === selectedDecisionId) || latestAiEntry;

  const handleAdd = () => {
    if (!targetEntry) return;

    const newFeedback = createHumanFeedbackEntry({
      category: selectedCategory,
      note,
      transcriptEntry: targetEntry,
      matchSeed,
      aiGenomeId,
      aiDnaDigest,
    });

    onAddFeedback(newFeedback);
    setNote("");
  };

  const handleExportSanitized = () => {
    if (!diagnosticBundle) return;
    const sanitizedBundle = exportSanitizedPlaytestFeedbackBundle(diagnosticBundle, feedbacks);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `blackpoker-feedback-share-${diagnosticBundle.match.environmentName ?? "match"}-${ts}.json`;
    downloadJsonFile(filename, sanitizedBundle);
  };

  const categories: HumanFeedbackCategory[] = [
    "WHY_NO_ATTACK",
    "WHY_NO_SUMMON",
    "WHY_PASS",
    "WHY_THROWING",
    "OTHER_UNNATURAL",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-zinc-300 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-zinc-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🤔</span>
            <h3 className="font-bold text-sm font-mono">AI違和感フィードバック</h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white font-mono text-sm px-2 py-1 rounded"
          >
            ✕ 閉じる
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex flex-col gap-4 text-xs font-mono">
          <p className="text-zinc-600 leading-relaxed">
            AI（相手プレイヤー）の行動で「なぜその手を選んだのか」「なぜこの手を打たなかったのか」と感じた違和感を記録できます。
          </p>

          {/* AIの行動選択 */}
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-zinc-800">対象のAI行動 (Decision):</label>
            {aiEntries.length === 0 ? (
              <p className="text-zinc-500 italic p-2 bg-zinc-50 rounded border border-zinc-200">
                まだAIの意思決定履歴がありません。
              </p>
            ) : (
              <select
                value={selectedDecisionId}
                onChange={(e) => setSelectedDecisionId(e.target.value)}
                className="w-full py-2 px-3 rounded-lg border border-zinc-300 bg-white text-zinc-900 font-mono"
              >
                {aiEntries.map((entry) => (
                  <option key={entry.decisionId} value={entry.decisionId}>
                    Seq {entry.seq} | {entry.playerId} | PatternRef #{entry.response.selectedPatternRef} (Ver {entry.stateVersion})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* フィードバックカテゴリ選択 */}
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-zinc-800">違和感の種類:</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`py-2 px-2.5 rounded-lg border text-left font-bold transition flex items-center gap-1.5 ${
                    selectedCategory === cat
                      ? "bg-zinc-900 text-white border-zinc-900 shadow-sm"
                      : "bg-zinc-50 hover:bg-zinc-100 text-zinc-800 border-zinc-300"
                  }`}
                >
                  <span className="text-sm">
                    {cat === "WHY_NO_ATTACK" ? "⚔️" : cat === "WHY_NO_SUMMON" ? "🎴" : cat === "WHY_PASS" ? "⏸️" : cat === "WHY_THROWING" ? "🎯" : "❓"}
                  </span>
                  <span className="truncate">{HUMAN_FEEDBACK_CATEGORY_LABELS[cat]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 補足コメント入力 */}
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-zinc-800">補足コメント (任意):</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例: このターンで敵ライフ1だったのに直接攻撃せずPASSした、等"
              className="w-full p-2.5 rounded-lg border border-zinc-300 font-mono text-xs focus:ring-1 focus:ring-zinc-900 focus:outline-none min-h-[60px]"
            />
          </div>

          {/* 追加ボタン */}
          <div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!targetEntry}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 text-white font-bold rounded-lg shadow-sm transition"
            >
              ＋ 違和感フィードバックを記録
            </button>
          </div>

          {/* 記録済みフィードバック一覧 */}
          {feedbacks.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <label className="font-bold text-zinc-800 flex items-center justify-between">
                <span>記録済みフィードバック ({feedbacks.length}件):</span>
              </label>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {feedbacks.map((fb) => (
                  <div
                    key={fb.feedbackId}
                    className="p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 flex items-start justify-between gap-2"
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-blue-900 bg-blue-100 px-1.5 py-0.5 rounded text-[10px]">
                          {fb.categoryLabel}
                        </span>
                        <span className="text-zinc-500 text-[10px]">
                          Decision: {fb.decisionId.slice(0, 8)}... (Pattern #{fb.selectedPatternRef})
                        </span>
                      </div>
                      {fb.note && <p className="text-zinc-700 mt-0.5">{fb.note}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteFeedback(fb.feedbackId)}
                      className="text-red-500 hover:text-red-700 text-xs px-1"
                      title="削除"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 共有用保存案内 */}
          <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-950 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 font-bold">
              <span>🛡️</span>
              <span>非公開情報の保護について</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              下記の「共有用フィードバック保存」からエクスポートされるJSONは、相手の手札・未公開山札などの非公開情報が完全に除去されています。GitHub Issueや外部チャットで安全に共有可能です。
            </p>
            <button
              type="button"
              onClick={handleExportSanitized}
              disabled={!diagnosticBundle}
              className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white font-bold rounded shadow-sm transition text-xs flex items-center justify-center gap-1.5"
            >
              <span>💾</span>
              <span>フィードバック共有用 JSON 保存 (非公開情報除去済み)</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-zinc-100 border-t border-zinc-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-zinc-900 text-white font-bold rounded-lg text-xs font-mono"
          >
            完了
          </button>
        </div>
      </div>
    </div>
  );
};
