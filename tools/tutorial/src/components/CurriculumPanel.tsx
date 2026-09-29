import { formatDifferences, learningCourses } from "../data/curriculum";
import blackPokerLogo from "../assets/blackpoker-logo.svg";
import { learningPath } from "../data/lessons";
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
    <aside className="curriculum" aria-label="チュートリアル全体の進捗">
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
        <p className="nav-label">Lesson一覧 · 復習はどこからでも</p>
        <div className="course active-course">
          <div>
            <span>01</span>
            <div>
              <strong>Entry16基礎コース</strong>
              <small>見る → 触る → 理解する</small>
            </div>
          </div>
          {learningPath.categories.map((chapter, i) => {
            const items = learningPath.lessons.filter((lesson) => lesson.category === chapter.id);
            const active = items.some((lesson) => lesson.id === lessonId);
            return (
              <details className="chapter-group" key={chapter.id} open={active}>
                <summary>
                  {chapter.id === "extra" ? "＋" : `${i + 1}.`} {chapter.title}
                  <small>{items.length} Lesson</small>
                </summary>
                <div className="chapter-list">
                  {items.map((s) => (
                    <button
                      key={s.id}
                      className={s.id === lessonId ? "current" : ""}
                      aria-current={s.id === lessonId ? "step" : undefined}
                      onClick={() => onSelect(s.id)}
                    >
                      <span>{completedIds.includes(s.id) ? "✓" : "・"}</span>
                      <b>{s.title}<small>{s.status === "pending" ? "準備中" : s.status === "reading" ? "ミニ解説" : s.optional ? "任意の復習" : "操作できます"}</small></b>
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
