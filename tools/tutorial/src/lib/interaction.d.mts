import type { BoardState, Operation, Player, TutorialStep, Zone } from "../types";
export interface CardLocation { player: Player; zone: Zone; card: string }
export type InteractionCommand =
  | { kind: "action"; label: string }
  | { kind: "move-card"; source: CardLocation; to: Zone; operation: Operation }
  | { kind: "tap-card" | "unsupported"; source: CardLocation; operation: Operation }
  | { kind: "select-target"; source: CardLocation; target: CardLocation; operation: Operation };
export type InteractionInput =
  | { kind: "card"; card: CardLocation }
  | { kind: "zone"; player: Player; zone: Zone }
  | { kind: "drop"; source: CardLocation; player?: Player; zone?: Zone }
  | { kind: "action" };
export function deriveInteractions(step: TutorialStep): InteractionCommand[];
export function interactionBoard(step: TutorialStep, completed: number): BoardState;
export function sameCard(a?: CardLocation | null, b?: CardLocation | null): boolean;
export function attemptInteraction(command: InteractionCommand | undefined, selected: CardLocation | null, input: InteractionInput): "success" | "select" | "deselect" | "wrong-source" | "wrong-target";
