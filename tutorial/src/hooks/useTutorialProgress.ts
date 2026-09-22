import { useEffect, useState } from "react";
import {
  clearProgress,
  initialProgress,
  loadProgress,
  resolveBrowserStorage,
  saveProgress,
} from "../lib/storage";
import type { Player, TutorialProgress } from "../types";
export function useTutorialProgress(scenarioId: string, stepCount: number) {
  const storage = resolveBrowserStorage();
  const [progress, setProgress] = useState(() =>
    loadProgress(scenarioId, storage),
  );
  const stepIndex = Math.min(progress.stepIndex, Math.max(0, stepCount - 1));
  const maxReachedStepIndex = Math.min(
    Math.max(stepIndex, progress.maxReachedStepIndex ?? stepIndex),
    Math.max(0, stepCount - 1),
  );
  useEffect(
    () => saveProgress({ ...progress, stepIndex, maxReachedStepIndex }, storage),
    [progress, stepIndex, maxReachedStepIndex, storage],
  );
  const update = (changes: Partial<TutorialProgress>) =>
    setProgress((p) => ({
      ...p,
      ...changes,
      updatedAt: new Date().toISOString(),
    }));
  return {
    stepIndex,
    maxReachedStepIndex,
    completed: progress.completed,
    applied: !!progress.applied,
    firstPlayer: progress.firstPlayer,
    apply: () =>
      update({ applied: true, completed: stepIndex === stepCount - 1 }),
    chooseFirst: (firstPlayer: Player) => update({ firstPlayer }),
    next: () =>
      update({
        stepIndex: Math.min(stepIndex + 1, stepCount - 1),
        maxReachedStepIndex: Math.max(
          maxReachedStepIndex,
          Math.min(stepIndex + 1, stepCount - 1),
        ),
        applied: false,
        completed: stepIndex === stepCount - 1,
      }),
    previous: () =>
      update({
        stepIndex: Math.max(0, stepIndex - 1),
        applied: false,
      }),
    goTo: (index: number) =>
      update({
        stepIndex: Math.max(0, Math.min(index, stepCount - 1)),
        maxReachedStepIndex: Math.max(
          maxReachedStepIndex,
          Math.max(0, Math.min(index, stepCount - 1)),
        ),
        applied: false,
      }),
    restart: () => {
      clearProgress(storage);
      setProgress(initialProgress(scenarioId));
    },
  };
}
