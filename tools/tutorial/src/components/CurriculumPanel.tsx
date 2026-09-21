import { curriculum } from "../data/curriculum";
import type { TutorialStep } from "../types";

export function CurriculumPanel({ steps, stepIndex, onSelect, onClose }: { steps: TutorialStep[]; stepIndex: number; onSelect: (index: number) => void; onClose?: () => void }) {
  const chapters = steps.reduce<Array<{ id: string; title: string; firstIndex: number }>>((result, step, index) => {
    if (!result.some((item) => item.id === step.chapter)) result.push({ id: step.chapter, title: step.chapterTitle, firstIndex: index });
    return result;
  }, []);
  const currentChapter = steps[stepIndex].chapter;
  return (
    <aside className="curriculum" aria-label="チュートリアル全体の進捗">
      <div className="curriculum-head"><div><span className="brand-mark">BP</span><strong>BlackPoker</strong><small>TUTORIAL</small></div>{onClose && <button className="icon-button" onClick={onClose} aria-label="メニューを閉じる">×</button>}</div>
      <nav>
        <p className="nav-label">LEARNING PATH</p>
        <div className="course active-course"><div><span>01</span><div><strong>入門</strong><small>ライト＋エントリー16</small></div></div><div className="chapter-list">{chapters.map((chapter, index) => {
          const done = chapter.firstIndex < stepIndex && chapter.id !== currentChapter;
          const active = chapter.id === currentChapter;
          return <button key={chapter.id} className={active ? "current" : ""} onClick={() => { onSelect(chapter.firstIndex); onClose?.(); }}><span>{done ? "✓" : String(index + 1).padStart(2, "0")}</span><b>{chapter.title}</b>{active && <em>NOW</em>}</button>;
        })}</div></div>
        <p className="nav-label next-label">NEXT LEVELS</p>
        {curriculum.slice(1).map((course, index) => <div className="course locked" key={course.id}><div><span>{String(index + 2).padStart(2, "0")}</span><div><strong>{course.title}</strong><small>{course.subtitle}</small></div><i>LOCK</i></div></div>)}
      </nav>
    </aside>
  );
}
