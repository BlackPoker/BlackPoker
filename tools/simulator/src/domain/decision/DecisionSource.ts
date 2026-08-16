export type PlayerKey = "p1" | "p2" | string;
export type RequestRef = string;

/**
 * 判断要求の発生元を識別する型。
 */
export type DecisionSource =
  | {
      readonly type: "ACTION_REQUEST";
      readonly playerId: PlayerKey;
    }
  | {
      readonly type: "EFFECT_RESOLUTION";
      readonly sourceRequestRef: RequestRef;
      readonly effectStepId: string;
      readonly playerId?: PlayerKey;
    };
