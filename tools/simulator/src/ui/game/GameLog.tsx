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
    info: "text-zinc-300 font-normal",
    event: "text-white font-medium",
    action: "text-white font-bold",
    trigger: "text-zinc-200 font-semibold",
    system: "text-zinc-500 italic",
  };

  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full p-2.5 bg-[#141414] rounded border border-zinc-800 shadow-sm font-sans">
      <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 border-zinc-800">
        <div className="flex items-center gap-1.5 font-mono">
          <span className="text-xs font-bold text-zinc-200">
            LOG 対戦履歴
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            ({logs.length})
          </span>
        </div>

        <button
          onClick={handleCopy}
          className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition"
        >
          {copied ? "✓ COPIED" : "COPY"}
        </button>
      </div>


      <div className="flex flex-col-reverse gap-1 overflow-y-auto flex-1 text-xs pr-1 font-mono">
        {logs.length === 0 ? (
          <div className="text-center text-zinc-600 py-3 text-[11px] italic">ログはありません</div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-1.5 p-1 rounded bg-zinc-950/70 hover:bg-zinc-900 transition leading-snug border border-zinc-900"
            >
              <span className="text-[9px] text-zinc-500 font-mono mt-0.5 shrink-0">
                {log.timestamp}
              </span>
              <span className={`flex-1 break-words text-[11px] ${levelStyles[log.level] || levelStyles.info}`}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

