import React, { useState } from "react";

export interface TraceEntry {
  seq: number;
  stateVersion: number;
  timestamp: string;
  category: string;
  actionId?: string;
  requestId?: string;
  controller?: string;
  turnPlayer?: string;
  chancePlayer?: string;
  stageDepth?: number;
  message: string;
}

export interface DebugPanelProps {
  state: any;
  currentDecisionRequest?: any;
  rulePackage?: any;
  logs: any[];
  traces?: TraceEntry[];
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  state,
  currentDecisionRequest,
  rulePackage,
  logs,
  traces = [],
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"trace" | "state" | "stage" | "buffer" | "decision">("trace");

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
      traces,
      logs,
    };

    navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const env = (import.meta as any).env || {};
  const buildSha = env.VITE_BUILD_SHA ? String(env.VITE_BUILD_SHA).slice(0, 7) : "local";
  const buildRef = env.VITE_BUILD_REF ? String(env.VITE_BUILD_REF) : "local";
  const bufferCount = state?.requestBuffer?.requests?.length || 0;

  return (
    <div className="flex flex-col h-full p-2.5 bg-white text-zinc-800 rounded border border-zinc-200 shadow-sm font-mono text-xs">
      <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 border-zinc-200">
        <div className="flex items-center gap-2">
          <span className="font-bold text-zinc-950">Raw Debug</span>
          <span className="text-[9px] text-zinc-500">
            Build: {buildSha} ({buildRef}) | Ver: {state?.stateVersion}
          </span>
        </div>

        <button
          onClick={handleCopy}
          className="px-2 py-0.5 text-[10px] font-bold rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-300 transition flex items-center gap-1"
        >
          {copied ? "✓ COPIED" : "COPY"}
        </button>
      </div>

      {/* タブナビゲーション */}
      <div className="flex flex-wrap gap-1 mb-1.5 border-b border-zinc-200 pb-1 text-[10px]">
        <button
          onClick={() => setActiveTab("trace")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "trace" ? "bg-zinc-950 text-white font-bold" : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          TRACE ({traces.length})
        </button>
        <button
          onClick={() => setActiveTab("state")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "state" ? "bg-zinc-950 text-white font-bold" : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          Full State
        </button>
        <button
          onClick={() => setActiveTab("stage")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "stage" ? "bg-zinc-950 text-white font-bold" : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          Stage ({state?.stage?.requests?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("buffer")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "buffer" ? "bg-zinc-950 text-white font-bold" : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          Buffer ({bufferCount})
        </button>
        <button
          onClick={() => setActiveTab("decision")}
          className={`px-2 py-0.5 rounded transition ${
            activeTab === "decision" ? "bg-zinc-950 text-white font-bold" : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          Decision ({currentDecisionRequest?.patterns?.length || 0})
        </button>
      </div>

      {/* コンテンツ表示エリア */}
      <div className="flex-1 overflow-auto bg-zinc-50 p-2 rounded border border-zinc-200 text-[11px] leading-relaxed">
        {activeTab === "trace" && (
          <div className="flex flex-col gap-1">
            {traces.length === 0 ? (
              <div className="text-zinc-400 italic py-2">トレースログはまだありません</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[10px]">
                  <thead>
                    <tr className="border-b border-zinc-300 text-zinc-600 bg-zinc-100">
                      <th className="py-1 px-1">Seq</th>
                      <th className="py-1 px-1">Ver</th>
                      <th className="py-1 px-1">Time</th>
                      <th className="py-1 px-1">Category</th>
                      <th className="py-1 px-1">TP/CP</th>
                      <th className="py-1 px-1">Stage</th>
                      <th className="py-1 px-1">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traces.map((t) => (
                      <tr key={t.seq} className="border-b border-zinc-200 hover:bg-zinc-100">
                        <td className="py-0.5 px-1 font-bold text-zinc-900">#{t.seq}</td>
                        <td className="py-0.5 px-1 text-zinc-500">v{t.stateVersion}</td>
                        <td className="py-0.5 px-1 text-zinc-400">{t.timestamp}</td>
                        <td className="py-0.5 px-1">
                          <span className="px-1 py-0.2 rounded bg-zinc-200 text-zinc-800 text-[9px] font-bold">
                            {t.category}
                          </span>
                        </td>
                        <td className="py-0.5 px-1 text-zinc-700">
                          {t.turnPlayer || "-"}/{t.chancePlayer || "-"}
                        </td>
                        <td className="py-0.5 px-1 text-zinc-600">{t.stageDepth ?? 0}</td>
                        <td className="py-0.5 px-1 text-zinc-950 font-sans break-all">{t.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {activeTab === "state" && (
          <pre className="text-zinc-800">{JSON.stringify(state, null, 2)}</pre>
        )}
        {activeTab === "stage" && (
          <pre className="text-zinc-800">
            {JSON.stringify(state?.stage || { requests: [] }, null, 2)}
          </pre>
        )}
        {activeTab === "buffer" && (
          <pre className="text-zinc-800">
            {JSON.stringify(state?.requestBuffer || { requests: [] }, null, 2)}
          </pre>
        )}
        {activeTab === "decision" && (
          <pre className="text-zinc-800">
            {JSON.stringify(currentDecisionRequest || "No Decision Pending", null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};



