import type { StepVisual } from "../types";

const suits: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

function PlayingCard({ code, small = false }: { code: string; small?: boolean }) {
  const suit = suits[code[0]] ?? code[0];
  const rank = code.slice(1);
  const red = code[0] === "H" || code[0] === "D";
  return (
    <span className={`playing-card ${red ? "red" : ""} ${small ? "small" : ""}`} aria-label={`${suit}${rank}`}>
      <span>{rank}</span><span>{suit}</span>
    </span>
  );
}

export function CardVisual({ visual }: { visual: StepVisual }) {
  if (visual.type === "cards") {
    return <figure className="visual cards-visual"><div>{visual.cards.map((card) => <PlayingCard key={card} code={card} small={visual.cards.length > 8} />)}</div>{visual.caption && <figcaption>{visual.caption}</figcaption>}</figure>;
  }
  if (visual.type === "turn") {
    return <figure className="visual turn-visual"><PlayingCard code="H7" /><span className="turn-arrow">→</span><span className={`turned-card ${visual.state}`}><PlayingCard code="H7" /></span><figcaption>{visual.state === "drive" ? "横向き＝ドライブ（使用済み）" : "縦向き＝チャージ（未使用）"}</figcaption></figure>;
  }
  if (visual.type === "duel") {
    return <figure className="visual duel-visual"><div><span className="duel-label">アタッカー</span><PlayingCard code={visual.attacker} /></div><span className="duel-vs">VS</span><div><span className="duel-label">{visual.blocker ? "ブロッカー" : `${visual.damage ?? 0}点ダメージ`}</span>{visual.blocker ? <PlayingCard code={visual.blocker} /> : <span className="damage-burst">−{visual.damage}</span>}</div></figure>;
  }
  const labels = { life: "ライフ", grave: "墓地", hand: "手札", field: "場", bulwark: "防壁" };
  return <figure className="visual board-visual"><div className="board-player"><span className={visual.focus === "life" ? "focus" : ""}>ライフ</span><span className={visual.focus === "grave" ? "focus" : ""}>墓地</span><span className={visual.focus === "field" || visual.focus === "bulwark" ? "focus wide" : "wide"}>場 {visual.focus === "bulwark" ? "／ 防壁" : ""}</span><span className={visual.focus === "hand" ? "focus wide" : "wide"}>手札</span></div><figcaption>{labels[visual.focus]}の場所を確認</figcaption></figure>;
}
