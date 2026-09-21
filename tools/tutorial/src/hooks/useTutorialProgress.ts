import { useEffect, useMemo, useState } from "react";
import { clearProgress, initialProgress, loadProgress, resolveBrowserStorage, saveProgress } from "../lib/storage";

export function useTutorialProgress(scenarioId: string, stepCount: number) {
  const storage = resolveBrowserStorage();
  const [progress, setProgress] = useState(() => loadProgress(scenarioId, storage));
  const stepIndex = Math.min(progress.stepIndex, Math.max(0, stepCount - 1));

  useEffect(() => saveProgress({ ...progress, stepIndex }, storage), [progress, stepIndex, storage]);

  return useMemo(
    () => ({
      stepIndex,
      completed: progress.completed,
      next: () =>
        setProgress((current) => {
          const atLast = stepIndex >= stepCount - 1;
          return {
            ...current,
            stepIndex: atLast ? stepIndex : stepIndex + 1,
            completed: atLast,
            updatedAt: new Date().toISOString(),
          };
        }),
      previous: () =>
        setProgress((current) => ({
          ...current,
          stepIndex: Math.max(0, stepIndex - 1),
          completed: false,
          updatedAt: new Date().toISOString(),
        })),
      restart: () => {
        clearProgress(storage);
        setProgress({ ...initialProgress(scenarioId), updatedAt: new Date().toISOString() });
      },
      goTo: (index: number) =>
        setProgress((current) => ({
          ...current,
          stepIndex: Math.max(0, Math.min(index, stepCount - 1)),
          completed: false,
          updatedAt: new Date().toISOString(),
        })),
    }),
    [progress.completed, scenarioId, stepCount, stepIndex, storage],
  );
}
