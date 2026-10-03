import { useCallback, useEffect, useState } from "react";
import { entryScenario } from "./data/lessons";
import { bookSections, nextSection, publishedSections, sectionById, sectionFromHash, unlockThrough } from "./data/book";
import { loadBookProgress, saveBookProgress, emptyBook } from "./lib/book-storage";
import { lessonStorageKey } from "./lib/lesson-storage";
import { clearIntroComplete, resolveBrowserStorage } from "./lib/storage";
import { scrollToSection } from "./lib/book-scroll";
import { useTutorialProgress } from "./hooks/useTutorialProgress";
import { CurriculumPanel } from "./components/CurriculumPanel";
import { HowToSection } from "./components/HowToSection";
import { IntroContent } from "./components/TutorialIntro";
import { CardOrientation } from "./components/CardOrientation";
import { LessonPractice } from "./components/LessonPractice";
import { RealPractice } from "./components/RealPractice";
import { ConceptSlide, ActionDefinition, LessonMedia } from "./components/LessonExplainer";
import { RuleLinks } from "./components/RuleLinks";
import { ActionHelp } from "./components/ActionHelp";
import blackPokerLogo from "./assets/blackpoker-logo.svg";

export default function App() {
  const storage = resolveBrowserStorage();
  const legacy = useTutorialProgress(entryScenario.id, entryScenario.steps.length);
  const [book, setBook] = useState(() => {
    const saved = loadBookProgress(storage, legacy.stepIndex);
    const target = sectionFromHash(window.location.hash);
    return target ? { ...saved, lastSectionId: target.id, unlockedIds: unlockThrough(target.id, saved.unlockedIds) } : saved;
  });
  const [scrollRequest, setScrollRequest] = useState({ id: book.lastSectionId, serial: 0, smooth: false });
  const [edition, setEdition] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  useEffect(() => saveBookProgress(storage, book), [storage, book]);
  const activate = useCallback((id: string) => {
    setBook((previous) => previous.lastSectionId === id ? previous : { ...previous, lastSectionId: id });
    const hash = id === "cover" ? "" : "#" + sectionById(id)!.anchor;
    if (window.location.hash !== hash) window.history.replaceState(null, "", window.location.pathname + window.location.search + hash);
  }, []);
  const openSection = useCallback((id: string) => {
    if (!sectionById(id)) return;
    setBook((previous) => ({ ...previous, lastSectionId: id, unlockedIds: unlockThrough(id, previous.unlockedIds) }));
    setMenuOpen(false);
    setScrollRequest((previous) => ({ id, serial: previous.serial + 1, smooth: true }));
  }, []);
  const complete = useCallback((id: string) => setBook((previous) => previous.completedIds.includes(id) ? previous
    : { ...previous, completedIds: [...previous.completedIds, id] }), []);
  const continueFrom = (id: string) => {
    complete(id);
    const next = nextSection(id);
    if (next) openSection(next.id);
  };
  useEffect(() => {
    const id = scrollRequest.id;
    activate(id);
    // DOM追加とdrawer閉鎖の後にジャンプ。focusもスクロールを上書きしない。
    scrollToSection(sectionById(id)?.anchor || "cover", scrollRequest.smooth);
  }, [scrollRequest, activate]);
  useEffect(() => {
    const hashChanged = () => {
      const target = sectionFromHash(window.location.hash);
      if (target) openSection(target.id);
    };
    window.addEventListener("hashchange", hashChanged);
    return () => window.removeEventListener("hashchange", hashChanged);
  }, [openSection]);
  const count = publishedSections.filter((section) => book.completedIds.includes(section.id)).length;
  return <div className="app-shell book-shell">
    <button aria-label="目次を閉じる" className={`mobile-scrim ${menuOpen ? "show" : ""}`} onClick={() => setMenuOpen(false)} />
    <div className={`sidebar-wrap ${menuOpen ? "open" : ""}`}>
      <CurriculumPanel lessonId={book.lastSectionId} completedIds={book.completedIds} onSelect={openSection} onClose={() => setMenuOpen(false)} />
    </div>
    <main className="lesson-shell">
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="目次を開く" aria-expanded={menuOpen}>☰</button>
        <div className="topbar-course"><span>BlackPoker</span><strong>Interactive HowTo</strong></div>
        <button className="help-button" onClick={() => setHelpOpen(true)}>ルール早見</button>
        <button className="restart-button" aria-label="最初からやり直す" onClick={() => setRestartOpen(true)}>↻<span>最初からやり直す</span></button>
      </header>
      <div className="book-body" key={edition}>
        <section id="cover" className="book-cover" aria-label="Interactive HowToの表紙" onFocusCapture={() => activate("cover")}>
          <img src={blackPokerLogo} alt="" /><h1>BlackPoker<small>Interactive HowTo</small></h1>
          <p>トランプだけで遊ぶ、2人用対戦カードゲーム。<br />読み進めながら、画面のカードを触って覚えましょう。</p>
          <button className="primary-button" onClick={() => openSection("about")}>はじめる ↓</button>
          <p className="book-progress" aria-label="全体の進捗">{count} / {publishedSections.length} Section完了 · 前の説明は上へスクロールして読めます</p>
        </section>
        {bookSections.filter((section) => book.unlockedIds.includes(section.id)).map((section) => {
          const lesson = section.lesson;
          const next = nextSection(section.id);
          return <HowToSection key={section.id} section={section} number={bookSections.indexOf(section) + 1}
            completed={book.completedIds.includes(section.id)} onActivate={() => activate(section.id)}>
            {section.kind === "intro" && <><IntroContent kind={section.id as "about" | "game-purpose" | "entry16"} />
              <button className="primary-button section-next" onClick={() => continueFrom(section.id)}>次へ →</button></>}
            {section.kind === "orientation" && <><p className="section-summary">縦と横で、カードの状態を表します。</p><CardOrientation />
              <p className="section-summary">このあと兵士を横向きにして、アタックしてみましょう。</p>
              <button className="primary-button section-next" onClick={() => continueFrom(section.id)}>次へ →</button></>}
            {lesson?.status === "ready" && lesson.sceneIds.length > 0 && <LessonPractice lesson={lesson}
              active={book.lastSectionId === section.id} completed={book.completedIds.includes(section.id)}
              onComplete={complete} onNext={() => continueFrom(section.id)} />}
            {lesson?.realStepIds && <RealPractice progress={legacy} onComplete={() => { complete(section.id); setHelpOpen(true); }} />}
            {lesson && lesson.status !== "ready" && <>
              <p className="section-summary">{lesson.shortDescription}</p>
              {lesson.status === "pending" ? <p className="pending-notice">このSectionのカード操作は準備中です。</p>
                : lesson.explainer && <ConceptSlide explainer={lesson.explainer} />}
              <details className="lesson-definitions"><summary>解説と公式ルールを見る</summary>
                {lesson.status === "pending" && lesson.explainer && <ConceptSlide explainer={lesson.explainer} />}
                {[...new Set([...lesson.actionIds, ...lesson.reviewActionIds, ...lesson.ruleRefs.filter((ref) => ref.startsWith("action.")).map((ref) => ref.slice(7))])].map((id) => <ActionDefinition id={id} key={id} />)}
                <RuleLinks refs={lesson.ruleRefs} />
              </details>
              {next && <button className="primary-button section-next" onClick={() => lesson.status === "pending" ? openSection(next.id) : continueFrom(section.id)}>
                {lesson.status === "pending" ? "公開済みの続きへ" : "読み終えて次へ"} →
              </button>}
            </>}
            {lesson && <LessonMedia media={lesson.media} />}
            {lesson && lesson.prerequisites.length > 0 && <details className="lesson-prerequisites"><summary>先に読むと分かりやすいSection（移動は自由）</summary>
              {lesson.prerequisites.map((id) => <button key={id} onClick={() => openSection(id)}>{sectionById(id)?.title}</button>)}
            </details>}
          </HowToSection>;
        })}
      </div>
    </main>
    {helpOpen && <ActionHelp onClose={() => setHelpOpen(false)} />}
    {restartOpen && <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="restart-title">
      <h2 id="restart-title">最初からやり直しますか？</h2><p>本文の進捗と先攻の選択を消し、表紙から始めます。</p>
      <div><button onClick={() => setRestartOpen(false)}>キャンセル</button><button className="danger" onClick={() => {
        legacy.restart();
        clearIntroComplete(storage);
        try { storage?.removeItem(lessonStorageKey); } catch { /* 保存なしでもやり直せる */ }
        setBook(emptyBook()); setEdition((value) => value + 1); setMenuOpen(false); setRestartOpen(false);
        setScrollRequest((previous) => ({ id: "cover", serial: previous.serial + 1, smooth: false }));
      }}>やり直す</button></div>
    </div></div>}
  </div>;
}
