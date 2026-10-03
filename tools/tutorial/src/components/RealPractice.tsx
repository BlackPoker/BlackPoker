import { entryScenario } from "../data/lessons";
import type { useTutorialProgress } from "../hooks/useTutorialProgress";
import { TutorialBoard } from "./TutorialBoard";
import { MoveGuide } from "./MoveGuide";
import { RuleLinks } from "./RuleLinks";
import { PlayingCard } from "./PlayingCard";
import { scrollToSection } from "../lib/book-scroll";
import type { Operation } from "../types";

export function RealPractice({ progress, onComplete }: {
  progress: ReturnType<typeof useTutorialProgress>; onComplete: () => void;
}) {
  const steps = entryScenario.steps.filter((step) => step.mode === "real");
  const firstIndex = entryScenario.steps.indexOf(steps[0]);
  const reached = Math.max(0, progress.maxReachedStepIndex - firstIndex);
  return <div className="real-practice">
    <p className="section-summary">ここから実物カード。画面は置き場のガイドです。2人とも自分のトランプを用意します。</p>
    {steps.slice(0, reached + 1).map((step, index) => {
      const operations: Operation[] = step.id === "start-draw" && progress.firstPlayer
        ? [{ player: progress.firstPlayer, from: "life", to: "hand", cards: [], label: "ライフから手札へ1枚動かす" }] : step.operations;
      return <section id={`real-${step.id}`} className="real-section" key={step.id} aria-labelledby={`real-${step.id}-title`}>
        <h3 id={`real-${step.id}-title`} tabIndex={-1}>{index + 1}. {step.title}</h3><p>{step.instruction}</p>
        {step.placementGuide && <p className="placement-guide">{step.placementGuide}</p>}
        {step.id === "preset-bulwark" && <p className="preset-note">ゲーム開始時だけ、防壁は表向きで置きます。通常の「防壁設置」では裏向きです。</p>}
        {step.checklist && <details className="deck-check"><summary>用意する16枚を確認</summary>
          <div>{step.checklist.map((code) => <PlayingCard code={code} key={code} />)}</div>
        </details>}
        {step.chooseFirst && <fieldset className="first-choice"><legend>実物のカードで決まった先攻</legend>
          {(["A", "B"] as const).map((player) => <label key={player}><input type="radio" name="firstPlayer"
            checked={progress.firstPlayer === player} onChange={() => progress.chooseFirst(player)} />PLAYER {player}</label>)}
        </fieldset>}
        <TutorialBoard board={step.id === "start-draw" ? { ...step.board.after, turn: progress.firstPlayer || null } : step.board.after}
          before={step.board.before} after={step.board.after} operations={operations} applied={true} real stepId={step.id}
          cause={step.cause} focusZones={step.focusZones} />
        <MoveGuide operations={operations} before={step.board.before} after={step.board.after} />
        <button className="primary-button" disabled={!!((step.chooseFirst || step.actor === "first") && !progress.firstPlayer)}
          onClick={() => {
            if (index === steps.length - 1) { progress.apply(); onComplete(); return; }
            progress.goTo(firstIndex + index + 1);
            requestAnimationFrame(() => scrollToSection(`real-${steps[index + 1].id}`));
          }}>{index === steps.length - 1 ? "対戦を始める" : "準備できた・次へ →"}</button>
        <details className="lesson-definitions"><summary>解説を見る</summary><p>{step.explanation}</p><RuleLinks refs={step.ruleRefs} /></details>
      </section>;
    })}
  </div>;
}
