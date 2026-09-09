import React from "react";

export interface LogEntry {
  id: string;
  level: "info" | "event" | "action" | "trigger" | "system";
  message: string;
  timestamp: string;
  seq?: number;
  stateVersion?: number;
}

export interface GameLogProps {
  logs: LogEntry[];
}

export const GameLog: React.FC<GameLogProps> = ({ logs = [] }) => {
  const levelStyles = {
    info: "text-zinc-700 font-normal",
    event: "text-zinc-950 font-medium",
    action: "text-zinc-950 font-bold",
    trigger: "text-zinc-900 font-semibold",
    system: "text-zinc-500 italic",
  };

  const [copied, setCopied] = React.useState(false);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isNearBottomRef = React.useRef<boolean>(true);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // 最下部から48px以内を「最下部付近」と判定
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distance <= 48;
  };

  // マウント時 / ログモーダルオープン時: 最新ログ（最下部）へ即座にスクロール
  React.useEffect(() => {
    scrollToBottom();
  }, []);

  // 新規ログ追加時: ユーザーが最下部付近にいる場合のみ自動スクロール追従
  React.useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [logs]);

  const handleCopy = () => {
    // 古い順（時系列順）を保ったままクリップボードにコピー
    const text = logs.map((l) => `[${l.timestamp}] ${l.seq ? `#${l.seq} ` : ""}${l.message}`).join("\n");
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-2.5 bg-white rounded border border-zinc-200 shadow-sm font-sans">
      <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 border-zinc-200 shrink-0">
        <div className="flex items-center gap-1.5 font-mono">
          <span className="text-xs font-bold text-zinc-950">
            LOG 対戦履歴
          </span>
          <span className="text-[10px] text-zinc-400 font-mono">
            ({logs.length})
          </span>
        </div>

        <button
          onClick={handleCopy}
          className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-300 transition"
        >
          {copied ? "✓ COPIED" : "COPY"}
        </button>
      </div>

      {/* 上から順（時系列順: 過去→現在）に表示し、最下部までスクロール */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        data-testid="game-log-scroll-container"
        className="flex flex-col gap-1 overflow-y-auto min-h-0 flex-1 text-xs pr-1 font-mono"
      >
        {logs.length === 0 ? (
          <div className="text-center text-zinc-400 py-3 text-[11px] italic">ログはありません</div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-1.5 p-1 rounded bg-zinc-50 hover:bg-zinc-100 transition leading-snug border border-zinc-200"
            >
              <div className="flex items-center gap-1 text-[9px] text-zinc-400 font-mono shrink-0 mt-0.5">
                {log.seq !== undefined && (
                  <span className="text-zinc-600 font-bold">#{log.seq}</span>
                )}
                <span>{log.timestamp}</span>
              </div>
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



