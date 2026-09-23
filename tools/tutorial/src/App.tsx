import { useEffect, useState } from "react";
import scenario from "./data/tutorials/entry16.json";
import { TutorialBoard } from "./components/TutorialBoard";
import { MoveGuide } from "./components/MoveGuide";
import { ActionHelp } from "./components/ActionHelp";
import { CurriculumPanel } from "./components/CurriculumPanel";
import { RuleLinks } from "./components/RuleLinks";
import { TutorialIntro } from "./components/TutorialIntro";
import { useTutorialProgress } from "./hooks/useTutorialProgress";
import { cardName } from "./lib/cards";
import {
  clearIntroComplete,
  loadIntroComplete,
  resolveBrowserStorage,
  saveIntroComplete,
} from "./lib/storage";
import type { Operation, TutorialScenario } from "./types";
const tutorial = scenario as TutorialScenario;
export default function App() {
  const storage = resolveBrowserStorage();
  const [introComplete, setIntroComplete] = useState(() =>
    loadIntroComplete(storage),
  );
  const progress = useTutorialProgress(tutorial.id, tutorial.steps.length);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [alternateOpen, setAlternateOpen] = useState(false);
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
  const guideOperations: Operation[] =
    step.id === "start-draw" && progress.firstPlayer
      ? [{
          player: progress.firstPlayer,
          from: "life",
          to: "hand",
          cards: [],
          label: "ライフから手札へ1枚動かす",
        }]
      : step.operations;
  const select = (index: number) => {
    progress.goTo(index);
    setDetailsOpen(false);
    setAlternateOpen(false);
    setMenuOpen(false);
  };
  if (!introComplete) {
    return (
      <TutorialIntro
        onComplete={() => {
          saveIntroComplete(storage);
          setIntroComplete(true);
        }}
      />
    );
  }
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
          <div className="topbar-course">
            <span>BlackPoker Tutorial</span>
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
              <small>{step.mode === "fixed" ? "注目する人" : "操作する人"}</small>
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
              {step.mode === "fixed" ? "盤面の変化" : "いまやること"}
            </p>
            {(step.sequenceLabel || step.actionName) && (
              <div className="step-context">
                {step.actionName && <span>今回のアクション：{step.actionName}</span>}
                {step.sequenceLabel && <strong>{step.sequenceLabel}</strong>}
              </div>
            )}
            <h1>{step.mode === "fixed" && !progress.applied && step.operations.length
              ? "次の盤面の変化を見てみましょう。"
              : step.title}</h1>
            <p className="instruction">
              {step.mode === "fixed" && step.operations.length
                ? progress.applied
                  ? "盤面でカードの変化を確認してください。"
                  : "「次へ」を押すと、カードの変化が盤面に表示されます。"
                : step.instruction}
            </p>
            <div className={`mode-notice mode-${step.mode}`}>
              {step.mode === "fixed" ? (
                <><b>画面だけで練習</b><span>実物カードはまだ使いません</span></>
              ) : (
                <><b>ここから実物カード</b><span>画面は実物カードの置き場ガイドです</span></>
              )}
            </div>
            {step.id === "preset-bulwark" && (
              <p className="preset-note">
                ゲーム開始時だけ、防壁は表向きで置きます。通常の「防壁設置」では裏向きです。
              </p>
            )}
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
              before={step.board.before}
              after={step.board.after}
              operations={guideOperations}
              applied={progress.applied}
              real={step.mode === "real"}
              stepId={step.id}
            />
            {step.mode === "real" && !progress.applied && (
              <MoveGuide
                operations={guideOperations}
                before={step.board.before}
                after={step.board.after}
              />
            )}
            {step.mode === "fixed" && progress.applied && (
              <div className="learned" role="status">
                <strong>盤面の変化を確認</strong>
                {step.cause && <p>{step.cause.text}</p>}
                {step.chapter === "prepare" && step.id !== "welcome" &&
                  <p>{step.instruction}</p>}
                <p>{step.learned}</p>
              </div>
            )}
            {step.mode === "fixed" && progress.applied && step.alternate && (
              <div className="alternate-example">
                <button
                  className="alternate-toggle"
                  aria-expanded={alternateOpen}
                  onClick={() => setAlternateOpen((value) => !value)}
                >
                  別の展開を見る <span aria-hidden="true">{alternateOpen ? "−" : "＋"}</span>
                </button>
                {alternateOpen && (
                  <div className="alternate-content">
                    <strong>{step.alternate.title}</strong>
                    <p>{step.alternate.text}</p>
                  </div>
                )}
              </div>
            )}
            <div className="step-actions">
              <button
                className="step-back"
                aria-label="← 戻る"
                disabled={progress.stepIndex === 0}
                onClick={() => {
                  progress.previous();
                  setDetailsOpen(false);
                  setAlternateOpen(false);
                }}
              >
                <span aria-hidden="true">←</span><span>戻る</span>
              </button>
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
                  } else if (step.mode === "real") {
                    progress.next();
                    setDetailsOpen(false);
                    setAlternateOpen(false);
                  } else if (progress.applied) {
                    progress.next();
                    setDetailsOpen(false);
                    setAlternateOpen(false);
                  } else progress.apply();
                }}
              >
                {step.id === "free-play" ? "対戦を始める" : "次へ"}
                <span>→</span>
              </button>
            </div>
            <button
              className="why-toggle"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
            >
              <span>
                <i>?</i>
                <b>解説を見る</b>
              </span>
              <span>{detailsOpen ? "−" : "＋"}</span>
            </button>
            {detailsOpen && (
              <div className="why-content">
                {step.cause && (
                  <p className="cause-phase">
                    {step.cause.phase === "request" ? "リクエスト時" :
                      step.cause.phase === "resolve" ? "解決時" :
                        step.cause.phase === "trigger" ? "誘発したアクション" : "練習の準備"}
                    {step.actionName && ` · ${step.actionName}`}
                  </p>
                )}
                {step.mode === "fixed" && <p>{step.instruction}</p>}
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
            <span>{step.chapterTitle}</span>
            <button onClick={() => setMenuOpen(true)}>一覧を見る</button>
          </div>
          <p className="physical-note">
            {step.mode === "fixed"
              ? "次へ → 盤面の変化を見る → 次へ"
              : "実物カードを動かす → 次へ"}
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
            <p>保存された進捗と先攻の選択を消し、導入から始めます。</p>
            <div>
              <button onClick={() => setRestartOpen(false)}>キャンセル</button>
              <button
                className="danger"
                onClick={() => {
                  progress.restart();
                  clearIntroComplete(storage);
                  setIntroComplete(false);
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
