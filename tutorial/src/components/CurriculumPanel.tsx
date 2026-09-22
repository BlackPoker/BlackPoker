import { formatDifferences, learningCourses } from "../data/curriculum";
import type { TutorialStep } from "../types";
export function CurriculumPanel({
  steps,
  stepIndex,
  onSelect,
  onClose,
}: {
  steps: TutorialStep[];
  stepIndex: number;
  onSelect: (index: number) => void;
  onClose?: () => void;
}) {
  const chapters = [...new Set(steps.map((s) => s.chapter))];
  return (
    <aside className="curriculum" aria-label="チュートリアル全体の進捗">
      <div className="curriculum-head">
        <div>
          <span className="brand-mark">BP</span>
          <strong>BlackPoker</strong>
          <small>TUTORIAL</small>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="メニューを閉じる"
        >
          ×
        </button>
      </div>
      <nav>
        <p className="nav-label">4つの章で、最初の1戦へ</p>
        <div className="course active-course">
          <div>
            <span>01</span>
            <div>
              <strong>入門</strong>
              <small>ライト＋エントリー16</small>
            </div>
          </div>
          {chapters.map((chapter, i) => {
            const items = steps
              .map((s, index) => ({ ...s, index }))
              .filter((s) => s.chapter === chapter);
            const active = steps[stepIndex].chapter === chapter;
            return (
              <details className="chapter-group" key={chapter} open={active}>
                <summary>
                  {i + 1}. {items[0].chapterTitle}
                  <small>{items.length}操作</small>
                </summary>
                <div className="chapter-list">
                  {items.map((s) => (
                    <button
                      key={s.id}
                      className={s.index === stepIndex ? "current" : ""}
                      aria-current={s.index === stepIndex ? "step" : undefined}
                      onClick={() => onSelect(s.index)}
                    >
                      <span>{s.index < stepIndex ? "✓" : "・"}</span>
                      <b>{s.title}</b>
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
        <section className="learning-roadmap" aria-labelledby="roadmap-title">
          <div className="roadmap-heading">
            <strong id="roadmap-title">学習ロードマップ</strong>
            <small>8つのコースを順に学びます</small>
          </div>
          <ol>
            {learningCourses.map((course, index) => (
              <li className={course.status} key={course.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{course.title}</strong>
                <small>{course.status === "available" ? "学習中" : "LOCK"}</small>
              </li>
            ))}
          </ol>
        </section>
        <details className="format-differences">
          <summary>フォーマット差分</summary>
          <p className="format-intro">
            学習コースとは別に、フォーマットが上がると使えるアクションが増えます。
          </p>
          {formatDifferences.map((c) => (
            <p key={c.id}>
              <strong>{c.title}で追加</strong>
              <small>{c.addedActions.join("・") || "追加なし"}</small>
            </p>
          ))}
          <p>
            追加アクションは正規ルールの対応フォーマットから表示しています。
          </p>
        </details>
      </nav>
    </aside>
  );
}
