import { learningPath, legacyLesson } from "../data/lessons";
import type { StorageLike } from "./storage";
export const lessonStorageKey = "blackpoker-howto-lessons-v1";
export interface LessonProgress { lessonId: string; completedIds: string[] }
export function loadLessonProgress(storage: StorageLike | null, legacyIndex: number): LessonProgress {
  const fallback = { lessonId: legacyLesson(legacyIndex).id, completedIds: [] };
  try {
    const value = JSON.parse(storage?.getItem(lessonStorageKey) || "null");
    if (!value || !learningPath.lessons.some((l) => l.id === value.lessonId) || !Array.isArray(value.completedIds)) return fallback;
    return { lessonId: value.lessonId, completedIds: [...new Set<string>(value.completedIds.filter((id: unknown) =>
      learningPath.lessons.some((l) => l.id === id && l.status !== "pending")))] };
  } catch { return fallback; }
}
export function saveLessonProgress(storage: StorageLike | null, progress: LessonProgress) {
  try { storage?.setItem(lessonStorageKey, JSON.stringify(progress)); } catch { /* 保存不可でも学習可能 */ }
}
