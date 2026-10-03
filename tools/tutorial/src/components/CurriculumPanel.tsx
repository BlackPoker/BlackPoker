import { formatDifferences, learningCourses } from "../data/curriculum";
import blackPokerLogo from "../assets/blackpoker-logo.svg";
import { learningPath } from "../data/lessons";
import { bookSections } from "../data/book";
export function CurriculumPanel({
  lessonId,
  completedIds,
  onSelect,
  onClose,
}: {
  lessonId: string;
  completedIds: string[];
  onSelect: (id: string) => void;
  onClose?: () => void;
}) {
  return (
    <aside className="curriculum" aria-label="HowToの目次">
      <div className="curriculum-head">
        <div>
          <img className="brand-logo" src={blackPokerLogo} alt="" />
          <strong>BlackPoker</strong>
          <small>Interactive HowTo</small>
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
        <p className="nav-label">目次 · 読みたいところへスクロール</p>
        <div className="course active-course">
          <div>
            <span>01</span>
            <div>
              <strong>Entry16基礎コース</strong>
              <small>見る → 触る → 理解する</small>
            </div>
          </div>
          {[{ id: "intro", title: "BlackPokerを知る" }, ...learningPath.categories].map((chapter, i) => {
            const items = bookSections.filter((section) => section.category === chapter.id);
            const active = items.some((lesson) => lesson.id === lessonId);
            return (
              <details className="chapter-group" key={chapter.id} open={active || chapter.id === "intro" || chapter.id === "combat"}>
                <summary>
                  {chapter.id === "extra" ? "＋" : `${i + 1}.`} {chapter.title}
                  <small>{items.length} 項目</small>
                </summary>
                <div className="chapter-list">
                  {items.map((s) => (
                    <button
                      key={s.id}
                      className={s.id === lessonId ? "current" : ""}
                      aria-current={s.id === lessonId ? "step" : undefined}
                      onClick={() => onSelect(s.id)}
                    >
                      <span>{completedIds.includes(s.id) ? "✓" : String(bookSections.indexOf(s) + 1).padStart(2, "0")}</span>
                      <b>{s.title}<small>{s.lesson?.status === "pending" ? "準備中" : s.lesson?.status === "reading" || s.kind !== "lesson" ? "読む" : s.lesson?.optional ? "任意の復習" : "触ってみる"}</small></b>
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
