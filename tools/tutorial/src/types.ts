export type RuleRef = `action.${string}` | `frame.${string}` | `format.${string}` | `component.${string}`;

export type StepVisual =
  | { type: "cards"; cards: string[]; caption?: string }
  | { type: "board"; focus: "life" | "grave" | "hand" | "field" | "bulwark" }
  | { type: "turn"; state: "charge" | "drive" }
  | { type: "duel"; attacker: string; blocker?: string; damage?: number };

export interface TutorialStep {
  id: string;
  chapter: string;
  chapterTitle: string;
  eyebrow: string;
  title: string;
  instruction: string;
  explanation: string;
  actionLabel?: string;
  ruleRefs: RuleRef[];
  visual?: StepVisual;
}

export interface TutorialScenario {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  regulation: { format: string; frame: string };
  learn: RuleRef[];
  steps: TutorialStep[];
}

export interface TutorialProgress {
  scenarioId: string;
  stepIndex: number;
  completed: boolean;
  updatedAt: string;
}
