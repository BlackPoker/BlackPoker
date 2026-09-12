import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  parseDiagnosticJson,
  ReplayVerificationOutcome,
} from "../playtest/ReplayVerificationService";

export interface ReplayVerifyModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onVerify: (bundle: unknown) => ReplayVerificationOutcome;
  readonly currentBuildSha: string;
}

export const ReplayVerifyModal: React.FC<ReplayVerifyModalProps> = ({
  isOpen,
  onClose,
  onVerify,
  currentBuildSha,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<{
    readonly name: string;
    readonly size: number;
  } | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<unknown | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<ReplayVerificationOutcome | null>(null);

  const resetState = useCallback(() => {
    setSelectedFile(null);
    setSelectedBundle(null);
    setParseError(null);
    setIsVerifying(false);
    setOutcome(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // モーダルオープン時に状態を初期化
  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  // Escape キーによるモーダルクローズ
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isVerifying) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isVerifying, onClose]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同一ファイルを再選択できるように直ちにリセット
    e.target.value = "";
    if (!file) return;

    setOutcome(null);
    setParseError(null);

    try {
      const text = await file.text();
      const parseResult = parseDiagnosticJson(text);
      if (parseResult.type === "SUCCESS") {
        setSelectedBundle(parseResult.value);
        setSelectedFile({ name: file.name, size: file.size });
      } else {
        setSelectedBundle(null);
        setSelectedFile({ name: file.name, size: file.size });
        setParseError(parseResult.message);
      }
    } catch {
      setSelectedBundle(null);
      setSelectedFile({ name: file.name, size: file.size });
      setParseError("JSONとして読み込めませんでした。ファイル形式を確認してください。");
    }
  };

  const handleVerify = async () => {
    if (!selectedBundle || isVerifying) return;
    setIsVerifying(true);
    setOutcome(null);

    // 1描画 yield を挟み、VERIFYING 状態の確実な画面描画を保証
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });

    try {
      const result = onVerify(selectedBundle);
      setOutcome(result);
    } catch (err: any) {
      setOutcome({
        type: "TECHNICAL_ERROR",
        message: err?.message || "Replay検証中に技術的エラーが発生しました。",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  if (!isOpen) return null;

  const shortCurrentSha =
    currentBuildSha === "local" ? "local" : currentBuildSha.slice(0, 7);

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in cursor-default"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isVerifying) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="replay-verify-modal-title"
      data-testid="replay-verify-modal-backdrop"
    >
      <div
        className="w-full max-w-lg bg-white rounded-xl border border-zinc-300 shadow-2xl p-5 flex flex-col gap-4 font-mono max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
          <div className="flex items-center gap-2">
            <h3
              id="replay-verify-modal-title"
              className="text-base font-bold text-zinc-950 font-serif"
            >
              Replay検証
            </h3>
            <span
              className="text-[10px] font-bold py-0.5 px-2 rounded bg-zinc-100 text-zinc-600 border border-zinc-300"
              title={`現在の Simulator Build SHA: ${currentBuildSha}`}
            >
              {`Current: ${shortCurrentSha}`}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={isVerifying}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-mono transition disabled:opacity-40 min-h-[44px] min-w-[44px]"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        {/* 説明文 */}
        <p className="text-xs text-zinc-600 leading-relaxed">
          Playtest Diagnostic Bundle v1を読み込み、同じ初期条件と判断列から同じ状態を再計算できるか検証します。
        </p>

        {/* 秘密情報非送信の警告 */}
        <div className="bg-amber-50/70 border border-amber-200 rounded p-2.5 text-[11px] text-amber-900 leading-normal">
          <span className="font-bold">※ 注意:</span> Diagnostic JSONには手札・Life等の非公開情報が含まれる可能性があります。検証はこのブラウザ内だけで行い、外部には送信しません。
        </div>

        {/* ファイル選択エリア */}
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
            id="diagnostic-file-input"
            aria-label="Diagnostic JSON ファイルを選択"
          />

          {!selectedFile ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 px-4 rounded border-2 border-dashed border-zinc-300 hover:border-zinc-500 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 font-bold text-xs transition flex flex-col items-center justify-center gap-1 min-h-[56px] cursor-pointer"
            >
              <span>📁 Diagnostic JSON を選択</span>
              <span className="text-[10px] text-zinc-400 font-normal">
                .json ファイルを選択してください
              </span>
            </button>
          ) : (
            <div className="flex items-center justify-between p-2.5 rounded border border-zinc-300 bg-zinc-50 text-xs">
              <div className="flex flex-col truncate pr-2">
                <span className="font-bold text-zinc-900 truncate">
                  {selectedFile.name}
                </span>
                <span className="text-[10px] text-zinc-500">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isVerifying}
                className="px-2.5 py-1 text-[11px] font-bold rounded border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-700 transition shrink-0 min-h-[36px]"
              >
                別ファイル選択
              </button>
            </div>
          )}
        </div>

        {/* JSON パースエラー表示 */}
        {parseError && (
          <div className="p-3 rounded border border-red-200 bg-red-50 text-xs text-red-800 flex flex-col gap-1">
            <span className="font-bold">✕ JSONパースエラー</span>
            <span className="text-[11px] leading-relaxed">{parseError}</span>
          </div>
        )}

        {/* 検証実行ボタン（ファイル選択済みかつ未検証時） */}
        {selectedBundle && !outcome && !parseError && (
          <button
            onClick={handleVerify}
            disabled={isVerifying}
            className="w-full py-2.5 px-4 rounded bg-zinc-950 hover:bg-zinc-800 disabled:opacity-50 text-white font-bold text-xs transition shadow-sm min-h-[44px] flex items-center justify-center gap-2 cursor-pointer"
          >
            {isVerifying ? (
              <span>検証中...</span>
            ) : (
              <span>検証する</span>
            )}
          </button>
        )}

        {/* 結果表示 */}
        {outcome && (
          <div className="flex flex-col gap-3 pt-1">
            {outcome.type === "VERIFIED" && (
              <div className="p-3 rounded-lg border border-emerald-300 bg-emerald-50/70 text-xs text-emerald-950 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 font-bold text-emerald-800 text-sm">
                  <span>✓</span>
                  <span>VERIFIED (再現成功)</span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-[11px] bg-white/80 p-2.5 rounded border border-emerald-200">
                  <div>
                    <span className="text-zinc-500">Environment: </span>
                    <span className="font-bold">{outcome.summary.environmentId}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Seed: </span>
                    <span className="font-bold">
                      {outcome.summary.seed !== undefined ? outcome.summary.seed : "(なし)"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Decisions: </span>
                    <span className="font-bold">{outcome.summary.decisionCount} 件</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Final Status: </span>
                    <span className="font-bold">{outcome.summary.finalStatus}</span>
                  </div>
                  <div className="col-span-2 truncate">
                    <span className="text-zinc-500">Source Build: </span>
                    <span className="font-bold" title={outcome.summary.sourceBuildSha}>
                      {outcome.summary.sourceBuildSha.slice(0, 7)}
                    </span>
                    {outcome.summary.sourceBuildSha === "local" && currentBuildSha === "local" && (
                      <span className="text-[10px] text-zinc-500 ml-1">
                        (local build同士の検証)
                      </span>
                    )}
                  </div>
                  {outcome.summary.rulePackageId && (
                    <div className="col-span-2 truncate">
                      <span className="text-zinc-500">RulePackage: </span>
                      <span className="font-bold">
                        {outcome.summary.rulePackageId}@{outcome.summary.rulePackageVersion}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {outcome.type === "INCOMPATIBLE" && (
              <div className="p-3 rounded-lg border border-amber-300 bg-amber-50/70 text-xs text-amber-950 flex flex-col gap-2">
                <div className="flex items-center gap-2 font-bold text-amber-800 text-sm">
                  <span>⚠</span>
                  <span>検証できません (INCOMPATIBLE)</span>
                </div>
                <div className="text-[11px] bg-white/80 p-2.5 rounded border border-amber-200 flex flex-col gap-1.5">
                  <div>
                    <span className="text-zinc-500">Code: </span>
                    <span className="font-bold text-amber-900">{outcome.code}</span>
                  </div>
                  <div className="text-zinc-700 leading-relaxed">{outcome.message}</div>
                  {outcome.code === "BUILD_MISMATCH" && (
                    <div className="mt-1 pt-1.5 border-t border-amber-100 flex flex-col gap-1 text-[10px]">
                      <div>
                        <span className="text-zinc-500">Source Build: </span>
                        <span className="font-bold">{outcome.sourceBuildSha || "(不明)"}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Current Build: </span>
                        <span className="font-bold">{outcome.currentBuildSha}</span>
                      </div>
                      <div className="text-zinc-500 mt-0.5">
                        ※ Replay Phase 1.0/1.1 は同一 Build のみ対応しています。
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {outcome.type === "DIVERGED" && (
              <div className="p-3 rounded-lg border border-red-300 bg-red-50/70 text-xs text-red-950 flex flex-col gap-2">
                <div className="flex items-center gap-2 font-bold text-red-800 text-sm">
                  <span>✕</span>
                  <span>Replay DIVERGED (状態不一致)</span>
                </div>
                <div className="text-[11px] bg-white/80 p-2.5 rounded border border-red-200 flex flex-col gap-1.5">
                  <div>
                    <span className="text-zinc-500">Code: </span>
                    <span className="font-bold text-red-900">{outcome.code}</span>
                  </div>
                  {outcome.decisionSeq !== undefined && (
                    <div>
                      <span className="text-zinc-500">Decision Seq: </span>
                      <span className="font-bold">{outcome.decisionSeq}</span>
                    </div>
                  )}
                  {outcome.differencePath && (
                    <div>
                      <span className="text-zinc-500">Difference Path: </span>
                      <span className="font-bold font-mono text-red-800">
                        {outcome.differencePath}
                      </span>
                    </div>
                  )}
                  <div className="text-zinc-700 leading-relaxed">{outcome.message}</div>
                </div>
              </div>
            )}

            {outcome.type === "TECHNICAL_ERROR" && (
              <div className="p-3 rounded-lg border border-red-300 bg-red-50/70 text-xs text-red-950 flex flex-col gap-2">
                <div className="flex items-center gap-2 font-bold text-red-800 text-sm">
                  <span>✕</span>
                  <span>技術的エラー (TECHNICAL_ERROR)</span>
                </div>
                <div className="text-[11px] bg-white/80 p-2.5 rounded border border-red-200">
                  {outcome.message}
                </div>
              </div>
            )}

            {/* 再検証・リセットボタン */}
            <button
              onClick={resetState}
              className="w-full py-2 px-3 rounded border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-700 font-bold text-xs transition min-h-[44px]"
            >
              別の Diagnostic JSON を検証
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modalContent;
  }
  return createPortal(modalContent, document.body);
};
