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
    <div className="flex flex-col h-full p-2.5 bg-[#141414] text-zinc-300 rounded border border-zinc-800 shadow-md font-mono text-xs">
      <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white">Raw Debug</span>
          <span className="text-[9px] text-zinc-500">
            Build: {buildSha} ({buildRef}) | Ver: {state?.stateVersion}
          </span>
        </div>


        <button
          onClick={handleCopy}
          className="px-2 py-0.5 text-[10px] font-bold rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition flex items-center gap-1"
        >
          {copied ? "✓ COPIED" : "COPY"}
        </button>

      </div>

      {/* タブナビゲーション */}
      <div className="flex gap-1 mb-1.5 border-b border-zinc-800/80 pb-1 text-[10px]">
        <button
          onClick={() => setActiveTab("state")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "state" ? "bg-zinc-800 text-white font-bold" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Full State
        </button>
        <button
          onClick={() => setActiveTab("stage")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "stage" ? "bg-zinc-800 text-white font-bold" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Stage ({state?.stage?.requests?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("buffer")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "buffer" ? "bg-zinc-800 text-white font-bold" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Buffer ({state?.requestBuffer?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("decision")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "decision" ? "bg-zinc-800 text-white font-bold" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Decision ({currentDecisionRequest?.patterns?.length || 0})
        </button>
      </div>

      {/* コンテンツ表示エリア */}
      <div className="flex-1 overflow-auto bg-zinc-950 p-2 rounded border border-zinc-900 text-[11px] leading-relaxed">
        {activeTab === "state" && (
          <pre className="text-zinc-300">{JSON.stringify(state, null, 2)}</pre>
        )}
        {activeTab === "stage" && (
          <pre className="text-zinc-300">
            {JSON.stringify(state?.stage || { requests: [] }, null, 2)}
          </pre>
        )}
        {activeTab === "buffer" && (
          <pre className="text-zinc-300">
            {JSON.stringify(state?.requestBuffer || [], null, 2)}
          </pre>
        )}
        {activeTab === "decision" && (
          <pre className="text-zinc-300">
            {JSON.stringify(currentDecisionRequest || "No Decision Pending", null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

