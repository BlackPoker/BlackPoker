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
  useEffect(
    () => saveProgress({ ...progress, stepIndex }, storage),
    [progress, stepIndex, storage],
  );
  const update = (changes: Partial<TutorialProgress>) =>
    setProgress((p) => ({
      ...p,
      ...changes,
      updatedAt: new Date().toISOString(),
    }));
  return {
    stepIndex,
    completed: progress.completed,
    applied: !!progress.applied,
    firstPlayer: progress.firstPlayer,
    apply: () =>
      update({ applied: true, completed: stepIndex === stepCount - 1 }),
    chooseFirst: (firstPlayer: Player) => update({ firstPlayer }),
    next: () =>
      update({
        stepIndex: Math.min(stepIndex + 1, stepCount - 1),
        applied: false,
        completed: stepIndex === stepCount - 1,
      }),
    previous: () =>
      update({
        stepIndex: Math.max(0, stepIndex - 1),
        applied: false,
        completed: false,
      }),
    goTo: (index: number) =>
      update({
        stepIndex: Math.max(0, Math.min(index, stepCount - 1)),
        applied: false,
        completed: false,
      }),
    restart: () => {
      clearProgress(storage);
      setProgress(initialProgress(scenarioId));
    },
  };
}
