import type { TutorialScenario, TutorialScene } from "../types";

export interface LearningUnit {
  id: string;
  title: string;
  chapter: string;
  chapterTitle: string;
  mode: "fixed" | "real";
  firstStepIndex: number;
  lastStepIndex: number;
  scene?: TutorialScene;
}

export function learningUnits(tutorial: TutorialScenario): LearningUnit[] {
  const indexes = new Map(tutorial.steps.map((step, index) => [step.id, index]));
  const fixed = tutorial.scenes.map((scene) => {
    const firstStepIndex = indexes.get(scene.stepIds[0])!;
    const lastStepIndex = indexes.get(scene.stepIds.at(-1)!)!;
    const step = tutorial.steps[firstStepIndex];
    return { id: scene.id, title: scene.title, chapter: step.chapter,
      chapterTitle: step.chapterTitle, mode: "fixed" as const,
      firstStepIndex, lastStepIndex, scene };
  });
  const real = tutorial.steps.flatMap((step, index) => step.mode === "real"
    ? [{ id: step.id, title: step.title, chapter: step.chapter,
      chapterTitle: step.chapterTitle, mode: "real" as const,
      firstStepIndex: index, lastStepIndex: index }]
    : []);
  return [...fixed, ...real];
}

export function unitIndexForStep(units: LearningUnit[], stepIndex: number) {
  const index = units.findIndex((unit) =>
    unit.firstStepIndex <= stepIndex && stepIndex <= unit.lastStepIndex);
  return index < 0 ? 0 : index;
}
