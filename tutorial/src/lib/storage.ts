import type { TutorialProgress } from "../types";

const STORAGE_KEY = "blackpoker-tutorial-progress-v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function resolveBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export const initialProgress = (scenarioId: string): TutorialProgress => ({
  scenarioId,
  stepIndex: 0,
  completed: false,
  updatedAt: new Date(0).toISOString(),
});

export function loadProgress(scenarioId: string, storage?: StorageLike | null): TutorialProgress {
  if (!storage) return initialProgress(scenarioId);
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return initialProgress(scenarioId);
    const value = JSON.parse(raw) as Partial<TutorialProgress>;
    if (value.scenarioId !== scenarioId || !Number.isInteger(value.stepIndex) || Number(value.stepIndex) < 0) return initialProgress(scenarioId);
    return { scenarioId, stepIndex: Number(value.stepIndex), completed: Boolean(value.completed), updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString() };
  } catch {
    return initialProgress(scenarioId);
  }
}

export function saveProgress(progress: TutorialProgress, storage?: StorageLike | null): void {
  if (!storage) return;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch { /* 保存不可でも学習は続行できる。 */ }
}

export function clearProgress(storage?: StorageLike | null): void {
  try { storage?.removeItem(STORAGE_KEY); } catch { /* 保存領域がなくても問題ない。 */ }
}

export const progressStorageKey = STORAGE_KEY;
