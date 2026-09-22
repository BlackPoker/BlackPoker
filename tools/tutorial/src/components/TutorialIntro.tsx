import { useEffect, useState } from "react";
import blackPokerLogo from "../assets/blackpoker-logo.svg";

const INTRO_COUNT = 3;

function MiniCard({ children, down = false }: { children?: string; down?: boolean }) {
  return (
    <span className={`intro-card ${down ? "down" : ""}`} aria-hidden="true">
      {down ? "BP" : children}
    </span>
  );
}

function BoardPreview() {
  return (
    <figure className="intro-board" aria-label="兵士、防壁、ライフを配置した対戦盤面のイメージ">
      <div className="intro-board-player opponent">
        <strong>PLAYER B</strong>
        <div><small>ライフ</small><span className="intro-stack"><MiniCard down /><MiniCard down /></span></div>
        <div><small>防壁</small><span><MiniCard down /><MiniCard down /></span></div>
        <div><small>兵士</small><span><MiniCard>♥7</MiniCard></span></div>
      </div>
      <div className="intro-battle-line"><span>対戦フィールド</span></div>
      <div className="intro-board-player">
        <strong>PLAYER A</strong>
        <div><small>兵士</small><span><MiniCard>♣6</MiniCard><MiniCard>♠3</MiniCard></span></div>
        <div><small>防壁</small><span><MiniCard down /><MiniCard down /></span></div>
        <div><small>ライフ</small><span className="intro-stack"><MiniCard down /><MiniCard down /></span></div>
      </div>
    </figure>
  );
}

function WinFlow() {
  return (
    <div className="intro-win-flow" aria-label="アタックからライフが減るまでの流れ">
      <div>
        <span className="intro-flow-icon attack"><MiniCard>♣6</MiniCard><b>→</b></span>
        <strong>兵士でアタック</strong>
        <small>兵士を横向きにして攻撃</small>
      </div>
      <b className="intro-flow-arrow" aria-hidden="true">↓</b>
      <div>
        <span className="intro-flow-icon"><MiniCard>♥7</MiniCard><MiniCard down /></span>
        <strong>兵士・防壁でブロック</strong>
        <small>相手はどちらかで守る</small>
      </div>
      <b className="intro-flow-arrow" aria-hidden="true">↓</b>
      <div>
        <span className="intro-flow-icon life"><MiniCard down /><i>−1</i></span>
        <strong>守れないとライフが減る</strong>
        <small>0枚になったプレイヤーの負け</small>
      </div>
    </div>
  );
}

export function TutorialIntro({ onComplete }: { onComplete: () => void }) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [page]);

  return (
    <main className="intro-shell">
      <header className="intro-header">
        <div className="intro-brand">
          <img src={blackPokerLogo} alt="" />
          <span><strong>BlackPoker</strong><small>Tutorial</small></span>
        </div>
        <span className="intro-count">INTRO {page + 1} / {INTRO_COUNT}</span>
      </header>

      <section className="intro-panel" aria-live="polite">
        <div className="intro-progress" aria-label={`導入 ${page + 1} / ${INTRO_COUNT}`}>
          {Array.from({ length: INTRO_COUNT }, (_, index) => (
            <span key={index} className={index <= page ? "active" : ""} />
          ))}
        </div>

        {page === 0 && (
          <div className="intro-page">
            <p className="intro-kicker">BLACKPOKERを知る</p>
            <h1>BlackPokerって<br className="intro-mobile-break" />どんなゲーム？</h1>
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

        {page === 1 && (
          <div className="intro-page">
            <p className="intro-kicker">勝ちかたを知る</p>
            <h1>どうなったら勝ち？</h1>
            <p className="intro-lead">相手のライフを<br className="intro-mobile-break" /><strong>0枚</strong>にしたら勝ち。</p>
            <p className="intro-term"><b>ライフ</b><span>BlackPokerでは山札を「ライフ」と呼びます。</span></p>
            <WinFlow />
          </div>
        )}

        {page === 2 && (
          <div className="intro-page">
            <p className="intro-kicker">最初のコース</p>
            <h1>まずは一番簡単な<br className="intro-mobile-break" />ルールから</h1>
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
              <p><strong>実物カードは、まだ用意しなくてOK。</strong>まず画面だけで1ターンを体験し、その後で実際のトランプを使います。</p>
            </div>
          </div>
        )}

        <nav className="intro-actions" aria-label="導入画面の操作">
          {page > 0 ? (
            <button className="intro-back" onClick={() => setPage((value) => value - 1)}>← 戻る</button>
          ) : <span />}
          {page < INTRO_COUNT - 1 ? (
            <button className="intro-next" onClick={() => setPage((value) => value + 1)}>次へ <span>→</span></button>
          ) : (
            <button className="intro-next intro-start" onClick={onComplete}>画面で練習してみる <span>→</span></button>
          )}
        </nav>
      </section>
    </main>
  );
}
