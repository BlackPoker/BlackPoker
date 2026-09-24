export type Player = "A" | "B";
export type Zone = "hand" | "soldiers" | "bulwarks" | "life" | "grave";
export type RuleRef =
  | `action.${string}`
  | `frame.${string}`
  | `format.${string}`
  | `character.${string}`
  | `fog.${string}`;
export interface BoardCard {
  card: string;
  state: "charge" | "drive";
  face: "up" | "down";
}
export type PlayerBoard = Record<Zone, BoardCard[]>;
export interface BoardState {
  A: PlayerBoard;
  B: PlayerBoard;
  turn: Player | null;
}
export interface Operation {
  player: Player;
  from: Zone;
  to: Zone;
  cards: string[];
  label: string;
}
export interface MovementCause {
  phase: "request" | "resolve" | "trigger" | "setup";
  actionId?: string;
  text: string;
}
export interface TutorialStep {
  id: string;
  chapter: string;
  chapterTitle: string;
  eyebrow: string;
  actor: Player | "both" | "first";
  title: string;
  instruction: string;
  explanation: string;
  learned: string;
  actionLabel: string;
  ruleRefs: RuleRef[];
  mode: "fixed" | "real";
  board: { before: BoardState; after: BoardState };
  operations: Operation[];
  focusZones?: { player: Player; zone: Zone }[];
  placementGuide?: string;
  checklist?: string[];
  chooseFirst?: boolean;
  sequenceLabel?: string;
  actionName?: string;
  cause?: MovementCause;
  alternate?: { title: string; text: string };
}
export interface TutorialScene {
  id: string;
  title: string;
  presentation: "static" | "auto";
  stepIds: string[];
  cues: string[];
  intro: string;
  summary: string;
}
export interface TutorialScenario {
  schemaVersion: 2;
  id: string;
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  regulation: { format: string; frame: string };
  learn: RuleRef[];
  scenes: TutorialScene[];
  steps: TutorialStep[];
}
export interface TutorialProgress {
  scenarioId: string;
  stepIndex: number;
  completed: boolean;
  updatedAt: string;
  applied?: boolean;
  firstPlayer?: Player;
  maxReachedStepIndex?: number;
}
