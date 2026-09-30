import data from "./learning-path.json";
import scenario from "./tutorials/entry16.json";
import { makeBulwarkFixture } from "./bulwark-fixture.mjs";
import type { RuleRef, TutorialScenario } from "../types";

export type Explainer =
  | { type: "flow"; title: string; items: { title: string; text: string }[] }
  | { type: "compare"; title: string; text: string; characterIds: string[] }
  | { type: "anatomy"; title: string; text: string; actionId: string; effectSummary: string }
  | { type: "example"; title: string; text: string; equation: string; cards: string[] };
export interface Lesson {
  id: string; title: string; shortDescription: string; category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  status: "ready" | "reading" | "pending"; optional?: boolean;
  prerequisites: string[]; sceneIds: string[]; realStepIds?: string[];
  actionIds: string[]; reviewActionIds: string[]; cards: string[]; ruleRefs: RuleRef[];
  explainer?: Explainer;
  media?: { type: "youtube"; url: string; title: string; note: string; edition: "current" | "legacy" };
}
export const learningPath = data as { schemaVersion: number; id: string; title: string;
  categories: { id: string; title: string }[]; lessons: Lesson[] };
export const entryScenario = scenario as TutorialScenario;
export const bulwarkScenario = makeBulwarkFixture(entryScenario);
export const scenarios = [entryScenario, bulwarkScenario];
export const lessonById = (id: string) => learningPath.lessons.find((lesson) => lesson.id === id)!;
export function legacyLesson(stepIndex: number) {
  if (stepIndex === 0) return lessonById("board-overview");
  const step = entryScenario.steps[Math.min(stepIndex, entryScenario.steps.length - 1)];
  return learningPath.lessons.find((lesson) => lesson.realStepIds?.includes(step.id) ||
    lesson.sceneIds.some((id) => entryScenario.scenes.find((scene) => scene.id === id)?.stepIds.includes(step.id))) || lessonById("first-battle");
}
