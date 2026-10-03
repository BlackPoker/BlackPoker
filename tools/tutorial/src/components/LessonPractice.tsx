import { useEffect } from "react";
import { scenarios, type Lesson } from "../data/lessons";
import { useSceneInteraction } from "../hooks/useSceneInteraction";
import { TutorialBoard } from "./TutorialBoard";
import { ActionDefinition, ConceptSlide } from "./LessonExplainer";
import { RuleLinks } from "./RuleLinks";

export function LessonPractice({ lesson, active, completed, onComplete, onNext }: {
  lesson: Lesson; active: boolean; completed: boolean; onComplete: (id: string) => void; onNext: () => void;
}) {
  const scenario = scenarios.find((item) => item.scenes.some((scene) => scene.id === lesson.sceneIds[0]))!;
  const scene = scenario.scenes[0];
  const interaction = useSceneInteraction(scene, scenario.steps, { enabled: active, initialCompleted: completed });
  const step = interaction.step!;
  useEffect(() => {
    if (scene.presentation === "interactive" && interaction.complete) onComplete(lesson.id);
  }, [interaction.complete, lesson.id, onComplete, scene.presentation]);
  const operations = interaction.pending && interaction.completedActions
    ? step.operations.flatMap((operation) => {
      const command = interaction.commands[interaction.completedActions - 1];
      return command && "source" in command && command.operation === operation ? [{ ...operation, cards: [command.source.card] }] : [];
    }) : step.operations;
  return <div className="book-practice">
    <p className="section-summary">{scene.presentation === "static" ? "TutorialではあなたがPLAYER A（下）、相手がPLAYER B（上）です。ルール上の違いではありません。" : scene.intro}</p>
    {scene.presentation === "interactive" && <ol className="micro-trail" aria-label="この場面の流れ">
      {scene.cues.map((cue, index) => <li key={index} className={index <= interaction.microIndex ? "reached" : ""}
        aria-current={!interaction.complete && index === interaction.microIndex ? "step" : undefined}>
        {index < interaction.microIndex || interaction.complete ? "✓ " : ""}{cue}</li>)}
    </ol>}
    <div className="interaction-guide" aria-live="polite" aria-atomic="true">
      {interaction.pending && <p className="interaction-result">✓ {interaction.lastResult}</p>}
      {!interaction.pending && !interaction.complete && <strong>{step.automatic ? step.instruction : interaction.feedback || interaction.prompt}</strong>}
      {scene.presentation === "static" && <strong>{interaction.feedback || "置き場をタップして確認できます。"}</strong>}
      {!interaction.complete && step.automatic && <small>相手側の処理を表示しています。操作は不要です。</small>}
      {!interaction.complete && !step.automatic && interaction.command?.kind === "action" && !interaction.pending &&
        <button className="interaction-action" onClick={() => interaction.attempt({ kind: "action" })}>{interaction.command.label}</button>}
    </div>
    <TutorialBoard board={interaction.board!} before={step.board.before} after={step.board.after}
      operations={operations} applied={interaction.applied || interaction.pending} real={false} stepId={step.id}
      cause={step.cause} focusZones={step.focusZones}
      interaction={{ command: interaction.command, selected: interaction.selected,
        pending: interaction.pending || !!step.automatic, complete: interaction.complete,
        mistakes: interaction.mistakes, onInput: interaction.attempt }} />
    {interaction.complete && scene.presentation === "interactive" && <div className="learned scene-result" role="status">
      <strong>このSectionの操作は完了</strong><p>{scene.summary}</p>
    </div>}
    {interaction.complete && <button className="primary-button section-next" onClick={onNext}>次へ →</button>}
    {interaction.complete && scene.presentation === "interactive" &&
      <button className="scene-replay" onClick={interaction.replay}>↻ もう一度やる</button>}
    <details className="lesson-definitions"><summary>解説を見る</summary>
      {lesson.explainer && <ConceptSlide explainer={lesson.explainer} />}
      {scenario.steps.map((item, index) => <div className="scene-detail" key={item.id}>
        <h3>{scene.cues[index]}</h3><p>{item.explanation}</p><RuleLinks refs={item.ruleRefs} />
      </div>)}
      {[...new Set([...lesson.actionIds, ...lesson.reviewActionIds])].map((id) => <ActionDefinition id={id} key={id} />)}
    </details>
    {interaction.complete && scenario.steps.some((item) => item.alternate) && <details className="lesson-definitions">
      <summary>別の展開を見る</summary>{scenario.steps.filter((item) => item.alternate).map((item) =>
        <div key={item.id}><h3>{item.alternate!.title}</h3><p>{item.alternate!.text}</p></div>)}
    </details>}
  </div>;
}
