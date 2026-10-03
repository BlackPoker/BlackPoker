import { learningPath, type Lesson } from "./lessons";

export interface BookSection {
  id: string; anchor: string; title: string; category: string;
  kind: "intro" | "orientation" | "lesson";
  lesson?: Lesson;
}
export const introductions: BookSection[] = [
  { id: "about", anchor: "about", title: "BlackPokerとは", category: "intro", kind: "intro" },
  { id: "game-purpose", anchor: "game-purpose", title: "ゲームの目的", category: "intro", kind: "intro" },
  { id: "entry16", anchor: "entry16", title: "Entry16について", category: "intro", kind: "intro" },
];
const lessonSections = learningPath.lessons.map((lesson): BookSection => ({
  id: lesson.id, anchor: lesson.id === "board-overview" ? "board" : lesson.id === "first-battle" ? "soldier-block" : lesson.id,
  title: lesson.title, category: lesson.category, kind: "lesson", lesson,
}));
export const bookSections: BookSection[] = [...introductions, lessonSections[0],
  { id: "orientation", anchor: "orientation", title: "カードの向き", category: "combat", kind: "orientation" },
  ...lessonSections.slice(1)];
export const publishedSections = bookSections.filter((section) => section.lesson?.status !== "pending");
export const sectionById = (id: string) => bookSections.find((section) => section.id === id);
export const sectionFromHash = (hash: string) => bookSections.find((section) => `#${section.anchor}` === hash || `#${section.id}` === hash);
export function unlockThrough(id: string, previous: string[] = []) {
  const index = bookSections.findIndex((section) => section.id === id);
  return bookSections.filter((section, i) => previous.includes(section.id) ||
    (i <= index && (section.lesson?.status !== "pending" || section.id === id))).map((section) => section.id);
}
export function nextSection(id: string) {
  return bookSections.slice(bookSections.findIndex((section) => section.id === id) + 1)
    .find((section) => section.lesson?.status !== "pending" && !section.lesson?.optional);
}
