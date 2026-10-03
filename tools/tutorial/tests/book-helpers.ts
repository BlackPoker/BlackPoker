import { act, fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";
import { RESULT_MS } from "../src/hooks/useSceneInteraction";
import { scenarios, lessonById } from "../src/data/lessons";
import { deriveInteractions } from "../src/lib/interaction.mjs";
import type { TutorialStep } from "../src/types";

export const section = (id: string) => document.querySelector<HTMLElement>(`[data-section-id="${id}"]`)!;
export const card = (id: string, player: string, code: string) => section(id).querySelector(`.player-${player} [data-card="${code}"]`)!.closest("button")!;
export const zone = (id: string, player: string, name: string) => within(section(id)).getByTestId(`${player}-${name}`);
export const tap = (id: string, player: string, code: string) => fireEvent.click(card(id, player, code));
export const destination = (id: string, player: string, name: string) => within(zone(id, player, name)).getByRole("button", { name: /^PLAYER/ });
export const move = (id: string, player: string, code: string, to: string) => { tap(id, player, code); fireEvent.click(destination(id, player, to)); };
export const wait = () => act(() => { vi.advanceTimersByTime(RESULT_MS); });
export const automatic = () => { act(() => { vi.advanceTimersByTime(1100); }); wait(); };
export const next = (id: string) => fireEvent.click(within(section(id)).getByRole("button", { name: "次へ →" }));
export function select(id: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".chapter-list button")]
    .find((item) => item.querySelector("b")?.firstChild?.textContent === lessonById(id)?.title || item.textContent?.includes(id === "about" ? "BlackPokerとは" : "\u0000"))!;
  button.closest("details")!.open = true;
  fireEvent.click(button);
}
export const fixture = (id: string) => scenarios.find((scenario) => scenario.scenes.some((scene) => lessonById(id).sceneIds.includes(scene.id)))!;
export function perform(id: string, step: TutorialStep) {
  for (const command of deriveInteractions(step)) {
    if (step.automatic) { automatic(); continue; }
    if (command.kind === "action") fireEvent.click(within(section(id)).getByRole("button", { name: command.label }));
    else {
      tap(id, command.source.player, command.source.card);
      if (command.kind === "move-card") fireEvent.click(destination(id, command.source.player, command.to));
      if (command.kind === "select-target") tap(id, command.target.player, command.target.card);
    }
    wait();
  }
}
export const finish = (id: string) => fixture(id).steps.forEach((step) => perform(id, step));
export const hash = (value: string) => window.history.replaceState(null, "", "/#" + value);
