export type RulePackage = {
  id: string;
  version: string;
  description?: string;
  actions: ActionDefinition[];
  components: ComponentDefinition[];
};

export type ActionDefinition = {
  id: string;
  name: string;
  ruby?: string;
  type: string;
  request: {
    trigger: "direct" | "triggered" | string;
    speed: "normal" | "immediate" | string;
    timing: "main" | "quick" | "block" | "damageJudge" | string;
  };
  cost?: string;
  key?: {
    id: string;
    condition?: Record<string, any>;
    conditions?: Array<Record<string, any>>;
    count?: number;
  };
  targets?: Array<{
    id: string;
    type?: string;
    condition?: Record<string, any>;
    [key: string]: any;
  }>;
  text?: {
    effect?: string;
    ability?: string;
  };
  triggerCondition?: TriggerCondition;
  effect?: EffectCommand[];
};

export type ComponentDefinition = {
  id: string;
  name: string;
  ruby?: string;
  type: "character" | "fog" | "trump" | string;
  zone: string;
  display?: {
    kind?: string;
    [key: string]: any;
  };
  unitCondition?: Record<string, any>;
  properties?: Record<string, any>;
  abilities?: Array<Record<string, any>>;
  text?: Record<string, string>;
};

export type EffectCommand =
  | { createFog: Record<string, any> }
  | { summonUnit: Record<string, any> }
  | { [commandName: string]: Record<string, any> };

export type ActionRequestTarget =
  | {
      type: "unit";
      unitId: string;
      kind: string;
      componentId: string;
    }
  | {
      type: "request";
      requestId: string;
      actionId: string;
    };

export type ActionRequest = {
  id: string;
  actionId: string;
  controller: string; // "p1" | "p2"
  keyCards: any[];
  targets?: ActionRequestTarget[];
  cost?: string;
  status: "pending" | "resolving" | "resolved" | "cancelled";
  sequence: number;
  action?: ActionDefinition;
};

export type Stage = {
  requests: ActionRequest[];
  history?: ActionRequest[];
};

export type TriggerCondition = {
  event: string;
  condition?: {
    fromZone?: string;
    toZone?: string;
    actionId?: string;
    hasAttacker?: boolean;
    hasAttackerAndBlocker?: boolean;
    card?: {
      rank?: string | string[];
      owner?: "self" | string;
    };
  };
};

export type TriggeredActionRequest = {
  id: string;
  actionId: string;
  controller: string;
  keyCards: unknown[]; // anyを徹底排除
  status: "pending" | "resolving" | "resolved" | "cancelled";
  sequence: number;
  action: ActionDefinition;
  sourceEvent?: unknown; // anyを徹底排除
};

export type TriggerHistory = {
  actionId: string;
  status: "triggered" | "discarded";
  reason?: string;
  sourceEvent?: unknown; // anyを徹底排除
};

export type RequestBuffer = {
  requests: TriggeredActionRequest[];
  history: TriggerHistory[];
};
