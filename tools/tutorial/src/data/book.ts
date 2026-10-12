import { learningPath, type Lesson } from "./lessons";
import layout from "./book-layout.json";

export type BookTrack = "first-game" | "learn-more" | "reference";
export interface BookSection {
  id: string; anchor: string; title: string; category: string; track: BookTrack;
  kind: "intro" | "orientation" | "lesson" | "milestone";
  lesson?: Lesson;
}
export const bookTracks = layout.tracks as { id: BookTrack; title: string; sectionIds: string[] }[];
export const introductions: BookSection[] = [
  { id: "about", anchor: "about", title: "BlackPokerとは", category: "intro", kind: "intro", track: "first-game" },
  { id: "game-purpose", anchor: "game-purpose", title: "ゲームの目的", category: "intro", kind: "intro", track: "first-game" },
  { id: "entry16", anchor: "entry16", title: "実物のトランプで遊ぼう", category: "intro", kind: "intro", track: "first-game" },
];
const specialSections: BookSection[] = [...introductions,
  { id: "orientation", anchor: "orientation", title: "カードの向き", category: "combat", kind: "orientation", track: "first-game" },
  { id: "first-game-ready", anchor: "first-game-ready", title: "ここまで分かれば、まず遊べます", category: "real", kind: "milestone", track: "first-game" },
];
// おすすめ順・進捗の範囲はJSONで管理する。元のLesson分類・IDは変更しない。
export const bookSections: BookSection[] = bookTracks.flatMap((track) => track.sectionIds.map((id): BookSection => {
  const special = specialSections.find((section) => section.id === id);
  if (special) return { ...special, track: track.id };
  const lesson = learningPath.lessons.find((lesson) => lesson.id === id)!;
  return { id, anchor: id === "board-overview" ? "board" : id === "first-battle" ? "soldier-block" : id,
    title: lesson.title, category: lesson.category, kind: "lesson", track: track.id, lesson };
}));
export const publishedSections = bookSections.filter((section) => section.lesson?.status !== "pending");
export const firstGameSections = publishedSections.filter((section) => section.track === "first-game");
export const sectionById = (id: string) => bookSections.find((section) => section.id === id);
export const sectionFromHash = (hash: string) => bookSections.find((section) => `#${section.anchor}` === hash || `#${section.id}` === hash);
export function unlockThrough(id: string, previous: string[] = []) {
  const target = sectionById(id);
  const route = target?.track === "first-game" ? firstGameSections.slice(0, firstGameSections.findIndex((s) => s.id === id) + 1).map((s) => s.id) : [id];
  // 応用の直リンクは、その教材だけを追加する。過去に開いた本文は閉じない。
  return bookSections.filter((section) => previous.includes(section.id) || route.includes(section.id)).map((section) => section.id);
}
export function nextSection(id: string) {
  const current = sectionById(id);
  if (!current) return undefined;
  return bookSections.slice(bookSections.indexOf(current) + 1)
    .find((section) => section.track === current.track && section.lesson?.status !== "pending" && !section.lesson?.optional);
}
