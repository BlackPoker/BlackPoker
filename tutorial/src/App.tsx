import { useState } from "react";
import scenario from "./data/tutorials/entry16.json";
import { CardVisual } from "./components/CardVisual";
import { CurriculumPanel } from "./components/CurriculumPanel";
import { RuleLinks } from "./components/RuleLinks";
import { useTutorialProgress } from "./hooks/useTutorialProgress";
import type { TutorialScenario } from "./types";

const tutorial = scenario as TutorialScenario;

export default function App() {
  const progress = useTutorialProgress(tutorial.id, tutorial.steps.length);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const step = tutorial.steps[progress.stepIndex];
  const percent = Math.round(((progress.stepIndex + (progress.completed ? 1 : 0)) / tutorial.steps.length) * 100);
  const chapterSteps = tutorial.steps.filter((item) => item.chapter === step.chapter);
  const chapterPosition = chapterSteps.findIndex((item) => item.id === step.id) + 1;

  return (
    <div className="app-shell">
      <div className={`mobile-scrim ${menuOpen ? "show" : ""}`} onClick={() => setMenuOpen(false)} />
      <div className={`sidebar-wrap ${menuOpen ? "open" : ""}`}><CurriculumPanel steps={tutorial.steps} stepIndex={progress.stepIndex} onSelect={progress.goTo} onClose={() => setMenuOpen(false)} /></div>
      <main className="lesson-shell">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="学習メニューを開く">☰</button>
          <div className="mobile-brand"><span className="brand-mark">BP</span><strong>BLACKPOKER</strong></div>
          <div className="topbar-course"><span>COURSE 01</span><strong>ライト＋エントリー16</strong></div>
          <button className="restart-button" onClick={() => setRestartOpen(true)}>↻<span>最初からやり直す</span></button>
        </header>

        <section className="lesson-progress" aria-label={`全体の進捗 ${percent}%`}>
          <div><span>LEVEL 1</span><strong>{progress.stepIndex + 1} <small>/ {tutorial.steps.length}</small></strong><em>{percent}% COMPLETE</em></div>
          <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
        </section>

        <div className="lesson-scroll">
          <article className="lesson-card">
            <div className="step-meta"><span>{step.eyebrow}</span><span>{chapterPosition} / {chapterSteps.length}</span></div>
            <p className="now-label"><span />いまやること</p>
            <h1>{step.title}</h1>
            <p className="instruction">{step.instruction}</p>
            {step.visual && <CardVisual visual={step.visual} />}
            <button className="primary-button" onClick={() => { setDetailsOpen(false); progress.next(); }}>{progress.completed ? "もう一度確認する" : step.actionLabel}<span>→</span></button>

            <button className={`why-toggle ${detailsOpen ? "open" : ""}`} onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen}><span><i>?</i><b>なぜ？</b></span><span>{detailsOpen ? "−" : "+"}</span></button>
            {detailsOpen && <div className="why-content"><p>{step.explanation}</p><RuleLinks refs={step.ruleRefs} /></div>}
          </article>

          <div className="lesson-nav">
            <button onClick={progress.previous} disabled={progress.stepIndex === 0}>← 前へ</button>
            <span>{step.chapterTitle}</span>
            <button onClick={() => setMenuOpen(true)}>一覧を見る</button>
          </div>
          <p className="physical-note"><span>♠</span> 実物のカードは画面の指示があるまで動かさないでください</p>
        </div>
      </main>

      {restartOpen && <div className="dialog-backdrop" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="restart-title"><span className="brand-mark">BP</span><h2 id="restart-title">最初からやり直しますか？</h2><p>保存された進捗を消して、最初の説明へ戻ります。</p><div><button onClick={() => setRestartOpen(false)}>キャンセル</button><button className="danger" onClick={() => { progress.restart(); setRestartOpen(false); }}>やり直す</button></div></div></div>}
    </div>
  );
}
