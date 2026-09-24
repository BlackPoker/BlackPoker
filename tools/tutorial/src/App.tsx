import { useEffect, useState } from "react";
import scenario from "./data/tutorials/entry16.json";
import { TutorialBoard } from "./components/TutorialBoard";
import { MoveGuide } from "./components/MoveGuide";
import { ActionHelp } from "./components/ActionHelp";
import { CurriculumPanel } from "./components/CurriculumPanel";
import { RuleLinks } from "./components/RuleLinks";
import { TutorialIntro } from "./components/TutorialIntro";
import { useTutorialProgress } from "./hooks/useTutorialProgress";
import { useScenePlayback } from "./hooks/useScenePlayback";
import { cardName } from "./lib/cards";
import { learningUnits, unitIndexForStep } from "./lib/scenes";
import {
  clearIntroComplete,
  loadIntroComplete,
  resolveBrowserStorage,
  saveIntroComplete,
} from "./lib/storage";
import type { Operation, TutorialScenario, TutorialStep } from "./types";
const tutorial = scenario as TutorialScenario;
const units = learningUnits(tutorial);
function shortResult(step: TutorialStep) {
  if (!step.operations.length) return step.learned;
  const phase = step.cause?.phase === "request" ? "コスト支払い" :
    step.cause?.phase === "trigger" ? "誘発" : "解決";
  return `${phase}：${step.operations.map((operation) => operation.label).join(" / ")}`;
}
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
  const unitIndex = unitIndexForStep(units, progress.stepIndex);
  const unit = units[unitIndex];
  const scene = unit.scene;
  const playback = useScenePlayback(scene);
  const step = tutorial.steps[scene
    ? unit.firstStepIndex + playback.microIndex
    : progress.stepIndex];
  const applied = scene ? playback.applied : progress.applied;
  const maxReachedUnitIndex = unitIndexForStep(units, progress.maxReachedStepIndex);
  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [unitIndex]);
  const chapterUnits = units.filter((item) => item.chapter === unit.chapter);
  const position = chapterUnits.findIndex((item) => item.id === unit.id) + 1;
  const percent = Math.round(
    ((maxReachedUnitIndex +
      (unitIndex === maxReachedUnitIndex && (scene ? playback.complete : progress.applied)
        ? 1
        : 0)) /
      units.length) *
      100,
  );
  const actor =
    step.id === "free-play" && progress.applied
      ? "both"
      : step.actor === "first"
        ? progress.firstPlayer
        : step.actor;
  const board = step.board[applied ? "after" : "before"];
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
    if (index === unit.firstStepIndex && scene) playback.replay();
    else progress.goTo(index);
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
          units={units}
          unitIndex={unitIndex}
          maxReachedUnitIndex={maxReachedUnitIndex}
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
              <small> / {chapterUnits.length}</small>
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
              {scene ? "画面で体験" : "いまやること"}
            </p>
            {!scene && (step.sequenceLabel || step.actionName) && (
              <div className="step-context">
                {step.actionName && <span>今回のアクション：{step.actionName}</span>}
                {step.sequenceLabel && <strong>{step.sequenceLabel}</strong>}
              </div>
            )}
            <h1>{scene ? scene.title : step.title}</h1>
            <p className="instruction">
              {scene ? scene.intro : step.instruction}
            </p>
            {scene?.presentation === "auto" && !playback.complete && (
              <div className="scene-progress" aria-live="polite">
                <strong>{playback.microIndex + 1} / {scene.stepIds.length}</strong>
                <span>{scene.cues[playback.microIndex]}</span>
                <small>{applied ? "結果" : "次に起こること"}</small>
              </div>
            )}
            {scene?.presentation === "static" && (
              <div className="scene-overview" aria-label="盤面の見かた">
                <span><b>PLAYER A / B</b> 下がA・上がB</span>
                <span><b>カードの置き場</b> 手札・兵士・防壁・ライフ・墓地</span>
                <span><b>カードの向き</b> 縦がチャージ・横がドライブ</span>
              </div>
            )}
            {scene && applied && (
              <div className="learned scene-result" role="status">
                <strong>{playback.complete ? "この場面のまとめ" : scene.cues[playback.microIndex]}</strong>
                <p>{playback.complete ? scene.summary : shortResult(step)}</p>
              </div>
            )}
            {step.placementGuide && <p className="placement-guide">{step.placementGuide}</p>}
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
              applied={applied}
              real={step.mode === "real"}
              stepId={step.id}
              cause={step.cause}
              focusZones={step.focusZones}
            />
            {step.mode === "real" && !progress.applied && (
              <MoveGuide
                operations={guideOperations}
                before={step.board.before}
                after={step.board.after}
              />
            )}
            {scene && playback.complete && tutorial.steps.slice(unit.firstStepIndex, unit.lastStepIndex + 1).some((item) => item.alternate) && (
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
                    {tutorial.steps.slice(unit.firstStepIndex, unit.lastStepIndex + 1)
                      .filter((item) => item.alternate).map((item) => <div key={item.id}>
                        <strong>{item.alternate!.title}</strong>
                        <p>{item.alternate!.text}</p>
                      </div>)}
                  </div>
                )}
              </div>
            )}
            <div className="step-actions">
              <button
                className="step-back"
                aria-label="← 戻る"
                disabled={unitIndex === 0}
                onClick={() => {
                  progress.goTo(units[unitIndex - 1].firstStepIndex);
                  setDetailsOpen(false);
                  setAlternateOpen(false);
                }}
              >
                <span aria-hidden="true">←</span><span>戻る</span>
              </button>
              <button
                className="primary-button"
                disabled={
                  (scene && !playback.complete) ||
                  ((step.chooseFirst || step.actor === "first") && !progress.firstPlayer)
                }
                onClick={() => {
                  if (scene) {
                    progress.goTo(units[unitIndex + 1].firstStepIndex);
                    setDetailsOpen(false);
                    setAlternateOpen(false);
                  } else if (step.id === "free-play") {
                    progress.apply();
                    setHelpOpen(true);
                  } else if (step.mode === "real") {
                    progress.next();
                    setDetailsOpen(false);
                    setAlternateOpen(false);
                  }
                }}
              >
                {scene && !playback.complete ? "再生中…" : step.id === "free-play" ? "対戦を始める" : "次へ"}
                {(!scene || playback.complete) && <span>→</span>}
              </button>
            </div>
            {scene?.presentation === "auto" && playback.complete && (
              <button className="scene-replay" onClick={() => {
                playback.replay();
                setDetailsOpen(false);
                setAlternateOpen(false);
              }}>↻ もう一度見る</button>
            )}
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
                {scene ? tutorial.steps.slice(unit.firstStepIndex, unit.lastStepIndex + 1).map((item, index) => (
                  <section className="scene-detail" key={item.id}>
                    <h2>{index + 1}. {scene.cues[index]}</h2>
                    {item.cause && <p className="cause-phase">
                      {item.cause.phase === "request" ? "リクエスト時" :
                        item.cause.phase === "resolve" ? "解決時" :
                          item.cause.phase === "trigger" ? "誘発したアクション" : "練習の準備"}
                      {item.actionName && ` · ${item.actionName}`}
                    </p>}
                    {item.cause && <p>{item.cause.text}</p>}
                    <p>{item.explanation}</p>
                    <RuleLinks refs={item.ruleRefs} />
                  </section>
                )) : <>{step.cause && (
                  <p className="cause-phase">
                    {step.cause.phase === "request" ? "リクエスト時" :
                      step.cause.phase === "resolve" ? "解決時" :
                        step.cause.phase === "trigger" ? "誘発したアクション" : "練習の準備"}
                    {step.actionName && ` · ${step.actionName}`}
                  </p>
                )}
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
                </>}
              </div>
            )}
          </article>
          <div className="lesson-nav">
            <span>{step.chapterTitle}</span>
            <button onClick={() => setMenuOpen(true)}>一覧を見る</button>
          </div>
          <p className="physical-note">
            {scene
              ? "場面を自動再生 → まとめを見る → 次へ"
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
