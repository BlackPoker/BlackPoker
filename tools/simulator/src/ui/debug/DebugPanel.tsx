import React, { useState } from "react";

export interface DebugPanelProps {
  state: any;
  currentDecisionRequest?: any;
  rulePackage?: any;
  logs: any[];
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  state,
  currentDecisionRequest,
  rulePackage,
  logs,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"state" | "stage" | "buffer" | "decision">("state");

  const handleCopy = () => {
    const env = (import.meta as any).env || {};
    const debugInfo = {
      buildSha: env.VITE_BUILD_SHA || "local",
      buildRef: env.VITE_BUILD_REF || "local",
      presetId: state?.presetId || "CORE-BATTLE-001",
      rulePackageId: rulePackage?.id,
      rulePackageVersion: rulePackage?.version,
      stateVersion: state?.stateVersion,
      turnPlayer: state?.turnPlayer,
      chancePlayer: state?.chancePlayer,
      currentDecision: currentDecisionRequest,
      stage: state?.stage,
      requestBuffer: state?.requestBuffer,
      playersSummary: {
        p1: {
          lifeCount: state?.players?.p1?.life?.length,
          handCount: state?.players?.p1?.hand?.length,
          fieldCount: state?.players?.p1?.field?.length,
          graveCount: state?.players?.p1?.grave?.length,
        },
        p2: {
          lifeCount: state?.players?.p2?.life?.length,
          handCount: state?.players?.p2?.hand?.length,
          fieldCount: state?.players?.p2?.field?.length,
          graveCount: state?.players?.p2?.grave?.length,
        },
      },
      logs,
    };

    navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const env = (import.meta as any).env || {};
  const buildSha = env.VITE_BUILD_SHA ? String(env.VITE_BUILD_SHA).slice(0, 7) : "local";
  const buildRef = env.VITE_BUILD_REF ? String(env.VITE_BUILD_REF) : "local";

  return (
    <div className="flex flex-col h-full p-3 bg-slate-900 text-slate-200 rounded-xl border border-slate-700 shadow-md font-mono text-xs">
      <div className="flex items-center justify-between border-b pb-2 mb-2 border-slate-700">
        <div className="flex items-center gap-2">
          <span className="font-bold text-emerald-400">🔧 Raw Debug Panel</span>
          <span className="text-[10px] text-slate-400">
            Build: {buildSha} ({buildRef}) | StateVer: {state?.stateVersion}
          </span>
        </div>

        <button
          onClick={handleCopy}
          className="px-2.5 py-1 text-[11px] font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-100 transition flex items-center gap-1"
        >
          {copied ? "✓ コピー完了" : "📋 デバッグ情報をコピー"}
        </button>
      </div>

      {/* タブナビゲーション */}
      <div className="flex gap-1 mb-2 border-b border-slate-800 pb-1">
        <button
          onClick={() => setActiveTab("state")}
          className={`px-2 py-1 rounded text-[11px] ${
            activeTab === "state" ? "bg-slate-700 text-emerald-400 font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Full State
        </button>
        <button
          onClick={() => setActiveTab("stage")}
          className={`px-2 py-1 rounded text-[11px] ${
            activeTab === "stage" ? "bg-slate-700 text-emerald-400 font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Stage ({state?.stage?.requests?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("buffer")}
          className={`px-2 py-1 rounded text-[11px] ${
            activeTab === "buffer" ? "bg-slate-700 text-emerald-400 font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          RequestBuffer ({state?.requestBuffer?.requests?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("decision")}
          className={`px-2 py-1 rounded text-[11px] ${
            activeTab === "decision" ? "bg-slate-700 text-emerald-400 font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Current Decision
        </button>
      </div>

      {/* タブコンテンツ */}
      <div className="flex-1 overflow-auto bg-slate-950 p-2 rounded border border-slate-800 font-mono text-[11px] leading-tight">
        {activeTab === "state" && (
          <pre className="text-slate-300">{JSON.stringify(state, null, 2)}</pre>
        )}
        {activeTab === "stage" && (
          <div>
            <div className="text-emerald-400 font-bold mb-1">// Active Requests:</div>
            <pre className="text-slate-300 mb-3">{JSON.stringify(state?.stage?.requests || [], null, 2)}</pre>
            <div className="text-amber-400 font-bold mb-1">// Resolved History:</div>
            <pre className="text-slate-400">{JSON.stringify(state?.stage?.history || [], null, 2)}</pre>
          </div>
        )}
        {activeTab === "buffer" && (
          <div>
            <div className="text-emerald-400 font-bold mb-1">// Buffer Requests:</div>
            <pre className="text-slate-300 mb-3">{JSON.stringify(state?.requestBuffer?.requests || [], null, 2)}</pre>
            <div className="text-amber-400 font-bold mb-1">// Buffer History:</div>
            <pre className="text-slate-400">{JSON.stringify(state?.requestBuffer?.history || [], null, 2)}</pre>
          </div>
        )}
        {activeTab === "decision" && (
          <pre className="text-slate-300">{JSON.stringify(currentDecisionRequest || "No Decision Pending", null, 2)}</pre>
        )}
      </div>
    </div>
  );
};
