import { PlayingCard } from "./PlayingCard";

function BoardPreview() {
  return (
    <figure className="intro-board" aria-label="兵士、防壁、ライフを配置した対戦盤面のイメージ">
      <div className="intro-board-player opponent">
        <strong>PLAYER B</strong>
        <div><small>ライフ</small><span className="intro-stack"><PlayingCard code="SA" face="down" className="intro-card" /><PlayingCard code="SA" face="down" className="intro-card" /></span></div>
        <div><small>防壁</small><span><PlayingCard code="SA" face="down" className="intro-card" /><PlayingCard code="SA" face="down" className="intro-card" /></span></div>
        <div><small>兵士</small><span><PlayingCard code="H7" className="intro-card" /></span></div>
      </div>
      <div className="intro-battle-line"><span>対戦フィールド</span></div>
      <div className="intro-board-player">
        <strong>PLAYER A</strong>
        <div><small>兵士</small><span><PlayingCard code="C6" className="intro-card" /><PlayingCard code="S3" className="intro-card" /></span></div>
        <div><small>防壁</small><span><PlayingCard code="SA" face="down" className="intro-card" /><PlayingCard code="SA" face="down" className="intro-card" /></span></div>
        <div><small>ライフ</small><span className="intro-stack"><PlayingCard code="SA" face="down" className="intro-card" /><PlayingCard code="SA" face="down" className="intro-card" /></span></div>
      </div>
    </figure>
  );
}

function WinFlow() {
  return (
    <div className="intro-win-flow" aria-label="アタックからライフが減るまでの流れ">
      <div>
        <span className="intro-flow-icon attack"><PlayingCard code="C6" state="drive" className="intro-card" /><b>→</b></span>
        <strong>兵士でアタック</strong>
        <small>兵士を横向きにして攻撃</small>
      </div>
      <b className="intro-flow-arrow" aria-hidden="true">↓</b>
      <div>
        <span className="intro-flow-icon"><PlayingCard code="H7" className="intro-card" /><PlayingCard code="SA" face="down" className="intro-card" /></span>
        <strong>兵士・防壁でブロック</strong>
        <small>相手はどちらかで守る</small>
      </div>
      <b className="intro-flow-arrow" aria-hidden="true">↓</b>
      <div>
        <span className="intro-flow-icon life"><PlayingCard code="SA" face="down" className="intro-card" /><i>−1</i></span>
        <strong>守れないとライフが減る</strong>
        <small>0枚になったプレイヤーの負け</small>
      </div>
    </div>
  );
}


/** 導入も通常の本文。ページ切替や独自の進捗は持たない。 */
export function IntroContent({ kind }: { kind: "about" | "game-purpose" | "entry16" }) {
  return <div className="book-intro">{kind === "about" && (
          <div className="intro-page">
            <p className="intro-kicker">BLACKPOKERを知る</p>

            <p className="intro-lead">トランプだけで、<br className="intro-mobile-break" />TCGみたいに対戦。</p>
            <BoardPreview />
            <div className="intro-facts" aria-label="ゲームの特徴">
              <span><b>2人用</b></span>
              <span><b>1人1セット</b>の普通のトランプ</span>
              <span><b>専用カード不要</b></span>
            </div>
            <p className="intro-caption">兵士を出して攻撃したり、魔法を使ったりして戦います。</p>
          </div>
        )}

        {kind === "game-purpose" && (
          <div className="intro-page">
            <p className="intro-kicker">勝ちかたを知る</p>

            <p className="intro-lead">相手のライフを<br className="intro-mobile-break" /><strong>0枚</strong>にしたら勝ち。</p>
            <p className="intro-term"><b>ライフ</b><span>BlackPokerでは山札を「ライフ」と呼びます。</span></p>
            <WinFlow />
          </div>
        )}

        {kind === "entry16" && (
          <div className="intro-page">
            <p className="intro-kicker">最初のコース</p>

            <div className="intro-course-card">
              <small>今回使うルール</small>
              <strong>ライト＋エントリー16</strong>
              <p>普通のトランプから16枚だけを使って、BlackPokerの基本を学ぶ初心者向けルールです。</p>
            </div>
            <div className="intro-levels" aria-label="段階的な遊び方">
              <span className="current">LIGHT<small>いまここ</small></span>
              <i>→</i><span>STANDARD</span><i>→</i><span>PRO</span><i>→</i><span>MASTER</span>
            </div>
            <p className="intro-reassurance">最初から、すべてのルールを覚える必要はありません。</p>
            <div className="intro-no-cards">
              <span aria-hidden="true">▣</span>
              <p><strong>実物カードは、まだ用意しなくてOK。</strong>まず画面のカードを操作して戦い方を体験し、その後で実際のトランプを使います。</p>
            </div>
          </div>
        )}

        </div>;
}
