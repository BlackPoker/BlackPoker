import { useEffect, useState } from "react";
import scenario from "./data/tutorials/entry16.json";
import { TutorialBoard, cardName } from "./components/TutorialBoard";
import { ActionHelp } from "./components/ActionHelp";
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
  const [helpOpen, setHelpOpen] = useState(false);
  const step = tutorial.steps[progress.stepIndex];
  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [progress.stepIndex]);
  const chapterSteps = tutorial.steps.filter((s) => s.chapter === step.chapter);
  const position = chapterSteps.findIndex((s) => s.id === step.id) + 1;
  const percent = Math.round(
    ((progress.maxReachedStepIndex +
      (progress.stepIndex === progress.maxReachedStepIndex && progress.applied
        ? 1
        : 0)) /
      tutorial.steps.length) *
      100,
  );
  const actor =
    step.id === "free-play" && progress.applied
      ? "both"
      : step.actor === "first"
        ? progress.firstPlayer
        : step.actor;
  const board = step.board[progress.applied ? "after" : "before"];
  const selectedBoard =
    step.id === "start-draw"
      ? { ...board, turn: progress.firstPlayer || null }
      : board;
  const select = (index: number) => {
    progress.goTo(index);
    setDetailsOpen(false);
    setMenuOpen(false);
  };
  return (
    <div className="app-shell">
      <button
        aria-label="学習メニューを閉じる"
        className={`mobile-scrim ${menuOpen ? "show" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <div className={`sidebar-wrap ${menuOpen ? "open" : ""}`}>
        <CurriculumPanel
          steps={tutorial.steps}
          stepIndex={progress.stepIndex}
          maxReachedStepIndex={progress.maxReachedStepIndex}
          onSelect={select}
          onClose={() => setMenuOpen(false)}
        />
      </div>
      <main className="lesson-shell">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="学習メニューを開く"
          >
            ☰
          </button>
          <button
            className="top-back"
            disabled={progress.stepIndex === 0}
            onClick={() => {
              progress.previous();
              setDetailsOpen(false);
            }}
          >
            ← 戻る
          </button>
          <div className="topbar-course">
            <span>BLACKPOKER TUTORIAL</span>
            <strong>ライト＋エントリー16</strong>
          </div>
          <button className="help-button" onClick={() => setHelpOpen(true)}>
            ルール早見
          </button>
          <button
            className="restart-button"
            aria-label="最初からやり直す"
            onClick={() => setRestartOpen(true)}
          >
            ↻<span>最初からやり直す</span>
          </button>
        </header>
        <section
          className="lesson-progress"
          aria-label={`全体の進捗 ${percent}%`}
        >
          <div>
            <span>{step.chapterTitle}</span>
            <strong>
              {position}
              <small> / {chapterSteps.length}</small>
            </strong>
            <em>全体 {percent}%</em>
          </div>
          <div className="progress-track">
            <span style={{ width: percent + "%" }} />
          </div>
        </section>
        <div className="lesson-scroll">
          <article className="lesson-card">
            <div className="actor-banner" data-testid="actor">
              <small>操作する人</small>
              <strong>
                {actor === "both"
                  ? "PLAYER A ＋ PLAYER B"
                  : actor
                    ? "PLAYER " + actor
                    : "先攻を選んでください"}
              </strong>
              <span>
                {selectedBoard.turn
                  ? "ターン：PLAYER " + selectedBoard.turn
                  : step.mode === "real"
                    ? "実物でターンを確認"
                    : "練習の準備"}
              </span>
            </div>
            <p className="now-label">
              <span />
              いまやること
            </p>
            {(step.sequenceLabel || step.actionName) && (
              <div className="step-context">
                {step.actionName && <span>今回のアクション：{step.actionName}</span>}
                {step.sequenceLabel && <strong>{step.sequenceLabel}</strong>}
              </div>
            )}
            <h1>{step.title}</h1>
            <p className="instruction">{step.instruction}</p>
            <div className={`mode-notice mode-${step.mode}`}>
              {step.mode === "fixed" ? (
                <><b>画面だけで練習</b><span>実物カードはまだ使いません</span></>
              ) : (
                <><b>ここから実物カード</b><span>薄いカード枠を置き場にしてください</span></>
              )}
            </div>
            {step.checklist && (
              <details className="deck-check">
                <summary>
                  {step.mode === "fixed" ? "画面に出る16枚を確認" : "用意する16枚を確認"}
                </summary>
                <div>
                  {step.checklist.map((c) => (
                    <span key={c}>{cardName(c)}</span>
                  ))}
                </div>
              </details>
            )}
            {(step.chooseFirst ||
              (step.actor === "first" && !progress.firstPlayer)) && (
              <fieldset className="first-choice">
                <legend>実物のカードで決まった先攻</legend>
                {(["A", "B"] as const).map((p) => (
                  <label key={p}>
                    <input
                      type="radio"
                      name="firstPlayer"
                      checked={progress.firstPlayer === p}
                      onChange={() => progress.chooseFirst(p)}
                    />
                    PLAYER {p}
                  </label>
                ))}
              </fieldset>
            )}
            <TutorialBoard
              board={selectedBoard}
              after={step.board.after}
              operations={step.operations}
              applied={progress.applied}
              real={step.mode === "real"}
              stepId={step.id}
            />
            {!progress.applied && (
              <div
                className="operation-guide"
                aria-label={step.mode === "fixed" ? "画面で変わるカード" : "動かすカードと移動先"}
              >
                {step.operations.map((o, i) => (
                  <p key={i}>
                    <b>PLAYER {o.player}</b> {o.label}
                  </p>
                ))}
                {step.id === "start-draw" && progress.firstPlayer && (
                  <p>
                    <b>PLAYER {progress.firstPlayer}</b> ライフ → 手札（1枚）
                  </p>
                )}
              </div>
            )}
            {progress.applied && (
              <div className="learned" role="status">
                <strong>✓ 操作を確認しました</strong>
                <p>{step.learned}</p>
              </div>
            )}
            <button
              className="primary-button"
              disabled={
                (step.chooseFirst || step.actor === "first") &&
                !progress.firstPlayer
              }
              onClick={() => {
                if (step.id === "free-play") {
                  progress.apply();
                  setHelpOpen(true);
                } else if (progress.applied) {
                  progress.next();
                  setDetailsOpen(false);
                } else progress.apply();
              }}
            >
              {step.id === "free-play"
                ? step.actionLabel
                : progress.applied
                  ? "次の操作へ"
                  : step.actionLabel}
              <span>→</span>
            </button>
            <button
              className="why-toggle"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
            >
              <span>
                <i>?</i>
                <b>なぜ？</b>
              </span>
              <span>{detailsOpen ? "−" : "＋"}</span>
            </button>
            {detailsOpen && (
              <div className="why-content">
                <p>{step.explanation}</p>
                <RuleLinks refs={step.ruleRefs} />
                {step.chapter === "setup" && (
                  <a
                    href="https://blackpoker.github.io/BlackPoker/master/common/common.html#common-gamestart"
                    target="_blank"
                    rel="noreferrer"
                  >
                    公式の共通ゲーム開始手順 ↗
                  </a>
                )}
              </div>
            )}
          </article>
          <div className="lesson-nav">
            <button
              disabled={progress.stepIndex === 0}
              onClick={() => {
                progress.previous();
                setDetailsOpen(false);
              }}
            >
              ← 戻る
            </button>
            <span>{step.chapterTitle}</span>
            <button onClick={() => setMenuOpen(true)}>一覧を見る</button>
          </div>
          <p className="physical-note">
            {step.mode === "fixed"
              ? "画面で動きを見る → ボタンを押す → 操作後を確認"
              : "実物を動かす → ボタンを押す → 配置を確認"}
          </p>
        </div>
      </main>
      {helpOpen && <ActionHelp onClose={() => setHelpOpen(false)} />}
      {restartOpen && (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restart-title"
          >
            <h2 id="restart-title">最初からやり直しますか？</h2>
            <p>保存された進捗と先攻の選択を消します。</p>
            <div>
              <button onClick={() => setRestartOpen(false)}>キャンセル</button>
              <button
                className="danger"
                onClick={() => {
                  progress.restart();
                  setRestartOpen(false);
                  setDetailsOpen(false);
                }}
              >
                やり直す
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
