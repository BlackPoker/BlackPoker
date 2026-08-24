import React from "react";

export interface LogEntry {
  id: string;
  level: "info" | "event" | "action" | "trigger" | "system";
  message: string;
  timestamp: string;
}

export interface GameLogProps {
  logs: LogEntry[];
}

export const GameLog: React.FC<GameLogProps> = ({ logs = [] }) => {
  const levelStyles = {
    info: "text-slate-700 dark:text-slate-300",
    event: "text-blue-600 dark:text-blue-400 font-medium",
    action: "text-indigo-700 dark:text-indigo-300 font-bold",
    trigger: "text-amber-600 dark:text-amber-400 font-bold",
    system: "text-slate-500 dark:text-slate-400 italic",
  };

  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <div className="flex items-center justify-between border-b pb-2 mb-2 border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">
            📜 対戦ログ (Game Log)
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {logs.length} 件
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition"
        >
          {copied ? "✓ コピー完了" : "📋 コピー"}
        </button>
      </div>

      <div className="flex flex-col-reverse gap-1.5 overflow-y-auto flex-1 text-xs pr-1 font-sans">
        {logs.length === 0 ? (
          <div className="text-center text-slate-400 py-4">ログはありません</div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-2 p-1.5 rounded bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 transition leading-relaxed"
            >
              <span className="text-[10px] text-slate-400 font-mono mt-0.5 shrink-0">
                {log.timestamp}
              </span>
              <span className={`flex-1 break-words ${levelStyles[log.level] || levelStyles.info}`}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
