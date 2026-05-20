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
    timing: "main" | "quick" | string;
  };
  cost?: string;
  key?: {
    id: string;
    condition: Record<string, any>;
  };
  targets?: Array<{
    id: string;
    condition: Record<string, any>;
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
  unitCondition?: Record<string, any>;
  properties?: Record<string, any>;
  abilities?: Array<Record<string, any>>;
  text?: Record<string, string>;
};

export type EffectCommand =
  | { createFog: Record<string, any> }
  | { summonUnit: Record<string, any> }
  | { [commandName: string]: Record<string, any> };
