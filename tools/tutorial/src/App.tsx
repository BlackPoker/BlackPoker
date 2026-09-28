import { useEffect, useState } from "react";
import scenario from "./data/tutorials/entry16.json";
import { TutorialBoard } from "./components/TutorialBoard";
import { MoveGuide } from "./components/MoveGuide";
import { ActionHelp } from "./components/ActionHelp";
import { CurriculumPanel } from "./components/CurriculumPanel";
import { RuleLinks } from "./components/RuleLinks";
import { TutorialIntro } from "./components/TutorialIntro";
import { useTutorialProgress } from "./hooks/useTutorialProgress";
import { useSceneInteraction } from "./hooks/useSceneInteraction";
import { cardName } from "./lib/cards";
import { learningUnits, unitIndexForStep } from "./lib/scenes";
import {
  clearIntroComplete,
  loadIntroComplete,
  resolveBrowserStorage,
  saveIntroComplete,
} from "./lib/storage";
import type { Operation, TutorialScenario } from "./types";
const tutorial = scenario as TutorialScenario;
const units = learningUnits(tutorial);
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
  const interaction = useSceneInteraction(scene, scene ? tutorial.steps.slice(unit.firstStepIndex, unit.lastStepIndex + 1) : []);
  const step = tutorial.steps[scene
    ? unit.firstStepIndex + interaction.microIndex
    : progress.stepIndex];
  const applied = scene ? interaction.applied : progress.applied;
  const maxReachedUnitIndex = unitIndexForStep(units, progress.maxReachedStepIndex);
  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [unitIndex]);
  const chapterUnits = units.filter((item) => item.chapter === unit.chapter);
  const position = chapterUnits.findIndex((item) => item.id === unit.id) + 1;
  const percent = progress.completed ? 100 : Math.round(
    ((maxReachedUnitIndex +
      (unitIndex === maxReachedUnitIndex && (scene ? interaction.hasCompleted : progress.applied)
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
  const board = scene ? interaction.board! : step.board[applied ? "after" : "before"];
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
      : scene && interaction.pending && interaction.completedActions
        ? step.operations.flatMap((operation) => {
          const completed = interaction.commands[interaction.completedActions - 1];
          return completed && "source" in completed && completed.operation === operation
            ? [{ ...operation, cards: [completed.source.card] }] : [];
        }) : step.operations;
  const select = (index: number) => {
    if (index === unit.firstStepIndex && scene) interaction.replay();
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
              <small>{scene?.presentation === "static" ? "注目する人" : "操作する人"}</small>
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
            {scene?.presentation === "interactive" && !interaction.complete && (
              <div className="scene-progress" aria-live="polite">
                <strong>{interaction.microIndex + 1} / {scene.stepIds.length}</strong>
                <span>{scene.cues[interaction.microIndex]}</span>
                {interaction.commands.length > 1 && <small>{interaction.pending ? interaction.completedActions : interaction.completedActions + 1} / {interaction.commands.length}枚目</small>}
              </div>
            )}
            {scene?.presentation === "static" && (
              <div className="scene-overview" aria-label="盤面の見かた">
                <span><b>PLAYER A / B</b> 下がA・上がB</span>
                <span><b>カードの置き場</b> 手札・兵士・防壁・ライフ・墓地</span>
                <span><b>カードの向き</b> 縦がチャージ・横がドライブ</span>
              </div>
            )}
            {scene && interaction.complete && (
              <div className="learned scene-result" role="status">
                <strong>この場面のまとめ</strong>
                <p>{scene.summary}</p>
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
            {scene && <div className="interaction-guide" aria-live="polite" aria-atomic="true">
              {interaction.lastResult && <p className="interaction-result">✓ {interaction.lastResult}</p>}
              {!interaction.complete && <strong>{interaction.pending ? "操作できました" : interaction.prompt}</strong>}
              {scene.presentation === "static" && <strong>置き場をタップすると説明が出ます。</strong>}
              {interaction.feedback && <p className="interaction-feedback">{interaction.feedback}</p>}
              {!interaction.complete && step.cause?.phase === "trigger" && step.operations.some((operation) => operation.from === operation.to) &&
                interaction.commands.every((command) => command.kind === "tap-card") && <small>自動で起きるチャージを、カード操作としてなぞります。</small>}
              {!interaction.complete && step.cause?.phase === "trigger" && step.operations.some((operation) => operation.to === "hand") &&
                <small>自動で起きるドローをなぞります。今回は2枚引いてみましょう。</small>}
              {!interaction.complete && interaction.command?.kind === "action" && !interaction.pending &&
                <button className="interaction-action" onClick={() => interaction.attempt({ kind: "action" })}>{interaction.command.label}</button>}
            </div>}
            <TutorialBoard
              board={selectedBoard}
              before={step.board.before}
              after={step.board.after}
              operations={guideOperations}
              applied={applied || !!(scene && interaction.pending)}
              real={step.mode === "real"}
              stepId={step.id}
              cause={step.cause}
              focusZones={step.focusZones}
              boardNote={step.boardNote}
              interaction={scene ? { command: interaction.command, selected: interaction.selected,
                pending: interaction.pending, complete: interaction.complete,
                mistakes: interaction.mistakes, onInput: interaction.attempt } : undefined}
            />
            {step.mode === "real" && !progress.applied && (
              <MoveGuide
                operations={guideOperations}
                before={step.board.before}
                after={step.board.after}
              />
            )}
            {scene && interaction.complete && tutorial.steps.slice(unit.firstStepIndex, unit.lastStepIndex + 1).some((item) => item.alternate) && (
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
              {(!scene || interaction.complete) && <button
                className="primary-button"
                disabled={
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
                {step.id === "free-play" ? "対戦を始める" : "次へ"}
                <span>→</span>
              </button>}
            </div>
            {scene?.presentation === "interactive" && interaction.complete && (
              <button className="scene-replay" onClick={() => {
                interaction.replay();
                setDetailsOpen(false);
                setAlternateOpen(false);
              }}>↻ もう一度やる</button>
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
              ? "画面のカードを操作 → 場面を完了 → 次へ"
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
                  interaction.replay();
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
