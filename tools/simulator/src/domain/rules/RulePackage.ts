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
    timing: "main" | "quick" | "block" | string;
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
  triggerCondition?: Record<string, any>;
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
