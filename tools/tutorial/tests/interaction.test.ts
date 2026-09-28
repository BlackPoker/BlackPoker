import { describe, expect, it } from "vitest";
import scenario from "../src/data/tutorials/entry16.json";
import { attemptInteraction, deriveInteractions, interactionBoard } from "../src/lib/interaction.mjs";
import type { TutorialStep } from "../src/types";
const step = (id: string) => scenario.steps.find((s) => s.id === id) as TutorialStep;
describe("兵士召喚の共通interaction", () => {
  it("防壁タップでドライブし、教材を変更しない", () => {
    const s = step("summon-cost-b"), snapshot = JSON.stringify(s);
    const command = deriveInteractions(s)[0];
    expect(command.kind).toBe("tap-card");
    expect(attemptInteraction(command, null, { kind: "card", card: { player: "A", zone: "bulwarks", card: "D5" } })).toBe("success");
    expect(interactionBoard(s, 1).A.bulwarks[0].state).toBe("drive");
    expect(JSON.stringify(s)).toBe(snapshot);
  });
  it.each(["summon-cost-l", "summon"])("%s は正しいカードと移動先を必要とし、dragも同じ判定を通る", (id) => {
    const s = step(id), command = deriveInteractions(s)[0];
    if (command.kind !== "move-card") throw new Error("move required");
    const source = command.source;
    expect(attemptInteraction(command, null, { kind: "zone", player: source.player, zone: command.to })).toBe("wrong-source");
    expect(attemptInteraction(command, null, { kind: "card", card: { ...source, player: "B" } })).toBe("wrong-source");
    expect(attemptInteraction(command, null, { kind: "card", card: source })).toBe("select");
    expect(attemptInteraction(command, source, { kind: "card", card: source })).toBe("deselect");
    expect(attemptInteraction(command, source, { kind: "zone", player: "B", zone: command.to })).toBe("wrong-target");
    expect(interactionBoard(s, 0)).toEqual(s.board.before);
    expect(attemptInteraction(command, source, { kind: "zone", player: source.player, zone: command.to })).toBe("success");
    expect(attemptInteraction(command, null, { kind: "drop", source, player: source.player, zone: command.to })).toBe("success");
    expect(attemptInteraction(command, null, { kind: "drop", source })).toBe("wrong-target");
    expect(interactionBoard(s, 1)).toEqual(s.board.after);
  });
  it("複数枚をoperation順に1枚ずつ移し、未来のカードを公開しない", () => {
    const s = step("draw"), snapshot = JSON.stringify(s);
    expect(deriveInteractions(s)).toHaveLength(2);
    const partial = interactionBoard(s, 1);
    expect(partial.B.hand.map((c) => c.card)).toEqual([...s.board.before.B.hand.map((c) => c.card), "S3"]);
    expect(partial.B.life[0]).toMatchObject({ card: "D8", face: "down" });
    expect(interactionBoard(s, 2)).toEqual(s.board.after);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
