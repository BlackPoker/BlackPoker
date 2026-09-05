import { parse } from "yaml";
import {
  FormatDefinition,
  FrameDefinition,
  RegulationDefinition,
  RegulationCatalog,
  UnknownRegulationError,
  UnknownFormatError,
  UnknownFrameError,
} from "../../domain/regulation/RegulationDefinition";
import { deepFreeze } from "../rules/RuleLoader";

export type { RegulationCatalog };

let catalogCache: RegulationCatalog | null = null;

export function clearRegulationCache(): void {
  catalogCache = null;
}

/**
 * regulations ディレクトリ配下の YAML を読み込み、Format, Frame, Regulation を統合したカタログを構築します。
 */
export async function loadRegulationCatalog(baseDir?: string): Promise<RegulationCatalog> {
  if (catalogCache && !baseDir) {
    return catalogCache;
  }

  const fs = await import("fs");
  const path = await import("path");

  const resolvedBaseDir = baseDir
    ? path.resolve(baseDir)
    : path.resolve(__dirname, "../../data/regulations");

  const formatsMap = new Map<string, FormatDefinition>();
  const framesMap = new Map<string, FrameDefinition>();
  const regulationsMap = new Map<string, RegulationDefinition>();

  // formats 読み込み
  const formatsDir = path.join(resolvedBaseDir, "formats");
  if (fs.existsSync(formatsDir)) {
    const files = fs.readdirSync(formatsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of files) {
      const content = fs.readFileSync(path.join(formatsDir, f), "utf-8");
      const parsed = parse(content) as FormatDefinition;
      if (parsed && parsed.id) {
        formatsMap.set(parsed.id, deepFreeze(parsed));
      }
    }
  }

  // frames 読み込み
  const framesDir = path.join(resolvedBaseDir, "frames");
  if (fs.existsSync(framesDir)) {
    const files = fs.readdirSync(framesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of files) {
      const content = fs.readFileSync(path.join(framesDir, f), "utf-8");
      const parsed = parse(content) as FrameDefinition;
      if (parsed && parsed.id) {
        framesMap.set(parsed.id, deepFreeze(parsed));
      }
    }
  }

  // regulations 読み込み
  const regulationsDir = path.join(resolvedBaseDir, "regulations");
  if (fs.existsSync(regulationsDir)) {
    const files = fs.readdirSync(regulationsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of files) {
      const content = fs.readFileSync(path.join(regulationsDir, f), "utf-8");
      const parsed = parse(content) as RegulationDefinition;
      if (parsed && parsed.id) {
        regulationsMap.set(parsed.id, deepFreeze(parsed));
      }
    }
  }

  const catalog: RegulationCatalog = {
    formats: formatsMap,
    frames: framesMap,
    regulations: regulationsMap,
  };

  if (!baseDir) {
    catalogCache = catalog;
  }

  return catalog;
}

export async function getRegulation(regulationId: string, baseDir?: string): Promise<RegulationDefinition> {
  const catalog = await loadRegulationCatalog(baseDir);
  const reg = catalog.regulations.get(regulationId);
  if (!reg) {
    throw new UnknownRegulationError(regulationId);
  }
  return reg;
}

export async function getFormat(formatId: string, baseDir?: string): Promise<FormatDefinition> {
  const catalog = await loadRegulationCatalog(baseDir);
  const fmt = catalog.formats.get(formatId);
  if (!fmt) {
    throw new UnknownFormatError(formatId);
  }
  return fmt;
}

export async function getFrame(frameId: string, baseDir?: string): Promise<FrameDefinition> {
  const catalog = await loadRegulationCatalog(baseDir);
  const frm = catalog.frames.get(frameId);
  if (!frm) {
    throw new UnknownFrameError(frameId);
  }
  return frm;
}
