import React from "react";

export interface ZoneSummaryItem {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
  readonly badge?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
}

export interface PlayerZoneStripProps {
  readonly items: ZoneSummaryItem[];
  readonly className?: string;
}

/**
 * プレイヤーの各種Zone（Fog, 墓地、将来の切札・Pack・Rare等）をコンパクトに並べるStripコンポーネント。
 * 将来のZone追加時にもアイテム定義を追加するだけで拡張可能。
 */
export const PlayerZoneStrip: React.FC<PlayerZoneStripProps> = ({
  items,
  className = "",
}) => {
  if (items.length === 0) return null;

  return (
    <div
      className={`flex items-center gap-1.5 overflow-x-auto py-1 font-mono text-[10px] no-scrollbar ${className}`}
    >
      {items.map((item) => {
        const isClickable = Boolean(item.onClick) && !item.disabled;
        const Component = isClickable ? "button" : "div";

        return (
          <Component
            key={item.id}
            onClick={isClickable ? item.onClick : undefined}
            disabled={item.disabled}
            className={`flex items-center gap-1 px-2 py-0.5 rounded border transition shrink-0 select-none ${
              isClickable
                ? "bg-zinc-100 border-zinc-300 text-zinc-800 hover:bg-zinc-200 active:bg-zinc-300 cursor-pointer min-h-[30px]"
                : "bg-zinc-50 border-zinc-200 text-zinc-600 min-h-[30px]"
            }`}
          >
            <span className="font-bold text-zinc-600">{item.label}</span>
            {item.count !== undefined && (
              <span className="font-black text-zinc-950 font-mono">
                {item.count}
              </span>
            )}
            {item.badge && (
              <span className="px-1 py-0.2 rounded bg-zinc-200 text-zinc-800 text-[9px] font-bold">
                {item.badge}
              </span>
            )}
          </Component>
        );
      })}
    </div>
  );
};
