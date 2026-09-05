import { parse } from "yaml";
import {
  FormatDefinition,
  FrameDefinition,
  RegulationDefinition,
  RegulationCatalog,
} from "../../domain/regulation/RegulationDefinition";

function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  for (const key of Object.keys(obj as any)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

let browserCatalogCache: RegulationCatalog | null = null;

export function clearBrowserRegulationCache(): void {
  browserCatalogCache = null;
}

/**
 * Vite の import.meta.glob を用いて、data/regulations 配下の全 YAML 定義を
 * raw 文字列としてバンドル・パースし、RegulationCatalog を構築します（ブラウザ環境用）。
 */
export function loadRegulationCatalogForBrowser(): RegulationCatalog {
  if (browserCatalogCache) {
    return browserCatalogCache;
  }

  const formatsModules = (import.meta as any).glob("../../data/regulations/formats/**/*.yaml", {
    eager: true,
    query: "?raw",
    import: "default",
  });
  const framesModules = (import.meta as any).glob("../../data/regulations/frames/**/*.yaml", {
    eager: true,
    query: "?raw",
    import: "default",
  });
  const regulationsModules = (import.meta as any).glob("../../data/regulations/regulations/**/*.yaml", {
    eager: true,
    query: "?raw",
    import: "default",
  });

  const formatsMap = new Map<string, FormatDefinition>();
  const framesMap = new Map<string, FrameDefinition>();
  const regulationsMap = new Map<string, RegulationDefinition>();

  for (const rawYaml of Object.values(formatsModules)) {
    if (typeof rawYaml === "string") {
      const parsed = parse(rawYaml) as FormatDefinition;
      if (parsed && parsed.id) {
        formatsMap.set(parsed.id, deepFreeze(parsed));
      }
    }
  }

  for (const rawYaml of Object.values(framesModules)) {
    if (typeof rawYaml === "string") {
      const parsed = parse(rawYaml) as FrameDefinition;
      if (parsed && parsed.id) {
        framesMap.set(parsed.id, deepFreeze(parsed));
      }
    }
  }

  for (const rawYaml of Object.values(regulationsModules)) {
    if (typeof rawYaml === "string") {
      const parsed = parse(rawYaml) as RegulationDefinition;
      if (parsed && parsed.id) {
        regulationsMap.set(parsed.id, deepFreeze(parsed));
      }
    }
  }

  browserCatalogCache = {
    formats: formatsMap,
    frames: framesMap,
    regulations: regulationsMap,
  };

  return browserCatalogCache;
}
