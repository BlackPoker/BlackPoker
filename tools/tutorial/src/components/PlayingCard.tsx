import { cardName, suits } from "../lib/cards";
import type { BoardCard } from "../types";

/** 表示だけの共通部品。操作・座標・ゲームの判定には依存しない。 */
export function CardFace({ code, face = "up" }: { code: string; face?: BoardCard["face"] }) {
  if (face === "down") return <span className="card-back-mark">BP</span>;
  return <span className={`card-face ${/^[HD]/.test(code) ? "red-suit" : "black-suit"}`}>
    <span className="card-rank">{suits[code[0]] ? code.slice(1) : code}</span>
    {suits[code[0]] && <span className="card-suit">{suits[code[0]]}</span>}
  </span>;
}

export function PlayingCard({ code, face = "up", state = "charge", className = "" }: {
  code: string; face?: BoardCard["face"]; state?: BoardCard["state"]; className?: string;
}) {
  return <span className={`playing-card ${state} ${face === "down" ? "face-down" : ""} ${className}`}
    role="img" aria-label={`${face === "down" ? "裏向きカード" : cardName(code)} ${state === "drive" ? "横向き" : "縦向き"}`}>
    <span aria-hidden="true"><CardFace code={code} face={face} /></span>
  </span>;
}
