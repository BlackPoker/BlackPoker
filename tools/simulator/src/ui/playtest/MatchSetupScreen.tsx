import React from "react";
import {
  EnvironmentOption,
  SetupNotice,
  isOfficialEnvironment,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  PlaytestMatchMode,
  PlaytestPolicyId,
  PLAYTEST_POLICY_OPTIONS,
} from "../../engine/playtest/PlaytestSeatController";

export interface MatchSetupScreenProps {
  /** 利用可能な環境オプション一覧 */
  readonly environmentOptions: readonly EnvironmentOption[];
  /** 選択中の Pending 環境 ID */
  readonly selectedEnvironmentId: string;
  /** 環境変更コールバック */
  readonly onSelectEnvironment: (envId: string) => void;

  /** 選択中の対戦モード */
  readonly matchMode: PlaytestMatchMode;
  /** 対戦モード変更コールバック */
  readonly onSelectMatchMode: (mode: PlaytestMatchMode) => void;

  /** 人間席 (p1: Player A / p2: Player B) */
  readonly humanSeat: "p1" | "p2";
  /** 人間席変更コールバック */
  readonly onSelectHumanSeat: (seat: "p1" | "p2") => void;

  /** AI Policy ID */
  readonly policyId: PlaytestPolicyId;
  /** AI Policy 変更コールバック */
  readonly onSelectPolicyId: (policyId: PlaytestPolicyId) => void;

  /** 対戦 Seed 入力文字列 */
  readonly seedInput: string;
  /** 対戦 Seed 入力コールバック */
  readonly onSeedInputChange: (seed: string) => void;

  /** セットアップ結果通知 (VALIDATION_ERROR 等) */
  readonly setupNotice?: SetupNotice | null;
  /** 共有 URL 通知 (警告・情報など) */
  readonly shareNotice?: {
    readonly type: "success" | "error" | "warning" | "info";
    readonly message: string;
  } | null;
  /** プリセット検証エラー */
  readonly presetValidationErrors?: readonly string[];

  /** 対戦開始ボタン押下時のハンドラ */
  readonly onStartMatch: () => void;
  /** Replay検証ボタン押下時のハンドラ */
  readonly onOpenReplayVerify: () => void;
}

export const MatchSetupScreen: React.FC<MatchSetupScreenProps> = ({
  environmentOptions,
  selectedEnvironmentId,
  onSelectEnvironment,
  matchMode,
  onSelectMatchMode,
  humanSeat,
  onSelectHumanSeat,
  policyId,
  onSelectPolicyId,
  seedInput,
  onSeedInputChange,
  setupNotice,
  shareNotice,
  presetValidationErrors = [],
  onStartMatch,
  onOpenReplayVerify,
}) => {
  const isOfficial = isOfficialEnvironment(selectedEnvironmentId);
  const selectedPolicyOpt = PLAYTEST_POLICY_OPTIONS.find((opt) => opt.id === policyId);

  return (
    <div className="w-full max-w-2xl mx-auto p-4 sm:p-6 my-2 bg-white rounded-xl border border-zinc-200 shadow-md font-sans">
      {/* タイトルヘッダー */}
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-zinc-950 text-white flex items-center justify-center font-serif font-black text-sm">
            ♠
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-zinc-950 tracking-tight">
              対戦設定 (Match Setup)
            </h2>
            <p className="text-[11px] text-zinc-500 font-mono">
              対戦環境・モードを選択して「対戦開始」を押してください
            </p>
          </div>
        </div>

        {/* Secondary: Replay検証ボタン */}
        <button
          type="button"
          onClick={onOpenReplayVerify}
          title="Diagnostic JSON を読み込み、決定論的再シミュレーションを検証します"
          className="px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-700 transition flex items-center gap-1 min-h-[44px] cursor-pointer"
        >
          <span>🔍</span>
          <span>Replay検証</span>
        </button>
      </div>

      {/* セットアップ通知 / 警告バナー */}
      {setupNotice && (
        <div
          role="alert"
          className="p-3 mb-4 rounded-lg border font-mono bg-red-50 border-red-300 text-red-950 text-xs"
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            <span className="px-1.5 py-0.5 rounded text-[10px] text-white bg-red-600">
              {setupNotice.type}
            </span>
            <span>{setupNotice.title}</span>
          </div>
          <p className="leading-relaxed">{setupNotice.message}</p>
          {setupNotice.details && (
            <p className="text-[10px] text-zinc-600 mt-1">{setupNotice.details}</p>
          )}
        </div>
      )}

      {shareNotice && (
        <div
          role="alert"
          className={`p-3 mb-4 rounded-lg border font-mono text-xs ${
            shareNotice.type === "warning"
              ? "bg-amber-50 border-amber-300 text-amber-950"
              : shareNotice.type === "error"
              ? "bg-red-50 border-red-300 text-red-950"
              : "bg-blue-50 border-blue-300 text-blue-950"
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold mb-0.5">
            <span className="text-sm">
              {shareNotice.type === "warning" ? "⚠️" : shareNotice.type === "error" ? "❌" : "ℹ️"}
            </span>
            <span>共有URL通知</span>
          </div>
          <p className="leading-relaxed">{shareNotice.message}</p>
        </div>
      )}

      {presetValidationErrors.length > 0 && (
        <div role="alert" className="p-3 mb-4 rounded-lg border border-red-300 bg-red-50 text-xs font-mono text-red-950">
          <p className="font-bold mb-1">プリセット構成エラー:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {presetValidationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 設定フォーム群 */}
      <div className="flex flex-col gap-4">
        {/* A. 対戦環境選択 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold font-mono text-zinc-700 flex items-center gap-1.5">
            <span>対戦環境 (Environment):</span>
          </label>
          <select
            value={selectedEnvironmentId}
            onChange={(e) => onSelectEnvironment(e.target.value)}
            className="w-full text-xs sm:text-sm font-bold py-2 px-3 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:ring-2 focus:ring-zinc-950 focus:outline-none min-h-[44px] cursor-pointer"
          >
            {environmentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>
          {!isOfficial && (
            <p className="text-[11px] text-zinc-500 font-mono mt-0.5 bg-zinc-50 p-2 rounded border border-zinc-200">
              ※固定初期盤面による基本ルールの検証環境
            </p>
          )}
        </div>

        {/* B. 対戦モード */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold font-mono text-zinc-700">
            対戦モード (Match Mode):
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onSelectMatchMode("humanVsHuman")}
              className={`min-h-[44px] px-3 py-2 rounded-lg border text-xs font-bold font-mono transition flex items-center justify-center gap-1.5 ${
                matchMode === "humanVsHuman"
                  ? "bg-zinc-950 text-white border-zinc-950 shadow-sm"
                  : "bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border-zinc-300"
              }`}
            >
              <span>👥</span>
              <span>Human vs Human</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectMatchMode("humanVsAi")}
              className={`min-h-[44px] px-3 py-2 rounded-lg border text-xs font-bold font-mono transition flex items-center justify-center gap-1.5 ${
                matchMode === "humanVsAi"
                  ? "bg-zinc-950 text-white border-zinc-950 shadow-sm"
                  : "bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border-zinc-300"
              }`}
            >
              <span>🤖</span>
              <span>Human vs AI</span>
            </button>
          </div>
        </div>

        {/* C. Human vs AI 設定 (選択時のみ表示) */}
        {matchMode === "humanVsAi" && (
          <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 flex flex-col gap-3">
            <div className="text-xs font-bold font-mono text-zinc-800 border-b border-zinc-200 pb-1">
              Human vs AI 設定
            </div>

            {/* Human 席選択 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold font-mono text-zinc-600">
                プレイヤー席 (Human Seat):
              </label>
              <select
                value={humanSeat}
                onChange={(e) => onSelectHumanSeat(e.target.value as "p1" | "p2")}
                className="w-full text-xs font-bold py-2 px-3 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px] cursor-pointer"
              >
                <option value="p1">Player A (先攻)</option>
                <option value="p2">Player B (後攻)</option>
              </select>
            </div>

            {/* AI Policy 選択 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold font-mono text-zinc-600">
                AI Policy:
              </label>
              <select
                value={policyId}
                onChange={(e) => onSelectPolicyId(e.target.value as PlaytestPolicyId)}
                className="w-full text-xs font-bold py-2 px-3 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px] cursor-pointer"
              >
                {PLAYTEST_POLICY_OPTIONS.map((opt) => (
                  <option
                    key={opt.id}
                    value={opt.id}
                    disabled={opt.requiresSeed && !isOfficial}
                  >
                    {opt.label}
                    {opt.requiresSeed && !isOfficial ? " (Official環境専用)" : ""}
                  </option>
                ))}
              </select>

              {/* Policy 役割説明ボックス */}
              {selectedPolicyOpt && (
                <div className="mt-1 p-2 bg-white rounded border border-zinc-200 text-[11px] font-mono text-zinc-700">
                  <div className="font-bold text-zinc-900 mb-0.5">
                    {selectedPolicyOpt.label}
                  </div>
                  <div>{selectedPolicyOpt.description}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* D. 対戦SEED入力 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold font-mono text-zinc-700 flex items-center justify-between">
            <span>対戦SEED (Match Seed):</span>
            {isOfficial ? (
              <span className="text-[10px] text-zinc-500 font-normal">※非負整数</span>
            ) : (
              <span className="text-[10px] text-zinc-400 font-normal">※Core Battle専用</span>
            )}
          </label>

          {isOfficial ? (
            <div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={seedInput}
                onChange={(e) => onSeedInputChange(e.target.value)}
                placeholder="42"
                className="w-full text-xs sm:text-sm font-mono font-bold py-2 px-3 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:ring-2 focus:ring-zinc-950 focus:outline-none min-h-[44px]"
              />
              <p className="text-[11px] text-zinc-500 font-mono mt-1">
                初期山札シャッフルおよび初期配置を決定論的に再現します（AI DNAとは異なります）
              </p>
            </div>
          ) : (
            <div>
              <input
                type="text"
                value="42 (固定)"
                disabled
                className="w-full text-xs sm:text-sm font-mono font-bold py-2 px-3 rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed min-h-[44px]"
              />
              <p className="text-[11px] text-zinc-500 font-mono mt-1">
                ※Core Battleは固定盤面のため対戦SEEDは使用しません
              </p>
            </div>
          )}
        </div>
      </div>

      {/* F. プライマリ アクション: [対戦開始] */}
      <div className="mt-6 pt-4 border-t border-zinc-200 flex flex-col sm:flex-row items-center justify-end gap-3">
        <button
          type="button"
          onClick={onStartMatch}
          className="w-full sm:w-auto px-8 py-3 bg-zinc-950 hover:bg-zinc-800 active:scale-98 text-white font-black text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2 min-h-[48px] cursor-pointer tracking-wide font-mono"
        >
          <span>⚔️</span>
          <span>対戦開始</span>
        </button>
      </div>
    </div>
  );
};
