import { loadLessonProgress, lessonStorageKey } from "./lesson-storage";
import { loadIntroComplete, progressStorageKey, type StorageLike } from "./storage";
import { sectionById, unlockThrough } from "../data/book";

export const bookStorageKey = "blackpoker-howto-book-v1";
export interface BookProgress { lastSectionId: string; unlockedIds: string[]; completedIds: string[] }
export const emptyBook = (): BookProgress => ({ lastSectionId: "cover", unlockedIds: [], completedIds: [] });
export function loadBookProgress(storage: StorageLike | null, legacyIndex = 0): BookProgress {
  try {
    let value;
    try { value = JSON.parse(storage?.getItem(bookStorageKey) || "null"); } catch { /* 破損時は旧形式の復元を試す */ }
    if (value && typeof value.lastSectionId === "string" && Array.isArray(value.unlockedIds) && Array.isArray(value.completedIds)) {
      const unlocked = value.unlockedIds.filter((id: unknown): id is string => typeof id === "string" && !!sectionById(id));
      const last = sectionById(value.lastSectionId) ? value.lastSectionId : "cover";
      const completed = [...new Set<string>(value.completedIds.filter((id: unknown): id is string =>
        typeof id === "string" && !!sectionById(id) && sectionById(id)!.lesson?.status !== "pending"))];
      return { lastSectionId: last, unlockedIds: [...new Set([...unlockThrough(last, unlocked), ...completed])], completedIds: completed };
    }
    // 旧キーは読み取りだけ。旧Lesson・30操作のどちらからも続きへ移行する。
    if (loadIntroComplete(storage) || storage?.getItem(lessonStorageKey) || (legacyIndex > 0 && storage?.getItem(progressStorageKey))) {
      const old = loadLessonProgress(storage, legacyIndex);
      return { lastSectionId: old.lessonId, unlockedIds: unlockThrough(old.lessonId, old.completedIds),
        completedIds: [...new Set(["about", "game-purpose", "entry16", ...old.completedIds])] };
    }
  } catch { /* 保存禁止・破損時にも教材を開ける。旧データは削除しない。 */ }
  return emptyBook();
}
export function saveBookProgress(storage: StorageLike | null, progress: BookProgress) {
  try { storage?.setItem(bookStorageKey, JSON.stringify(progress)); } catch { /* 保存なしで継続 */ }
}
