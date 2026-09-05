import {
  FormatDefinition,
  FrameDefinition,
  RegulationDefinition,
  RegulationValidationResult,
  SimulatorNotImplementedError,
  UnknownFormatError,
  UnknownFrameError,
  UnknownRegulationError,
} from "../../domain/regulation/RegulationDefinition";
import { RegulationCatalog } from "./RegulationLoader";

export class RegulationValidator {
  /**
   * レギュレーションIDを指定して検証を実行します。
   */
  public static validateRegulation(
    catalog: RegulationCatalog,
    regulationId: string,
    options?: { assertImplemented?: boolean }
  ): RegulationValidationResult {
    const regulation = catalog.regulations.get(regulationId);
    if (!regulation) {
      throw new UnknownRegulationError(regulationId);
    }

    return this.validateCombination(catalog, regulation.formatId, regulation.frameId, {
      regulation,
      assertImplemented: options?.assertImplemented,
    });
  }

  /**
   * フォーマットIDとフレームIDの組み合わせを検証します。
   *
   * 【公式ルール第9.1.2版 2.3 & 8.3.1】
   * - ruleLegal: どの組み合わせでも公式ルール上は対戦可能であるため常に true。
   * - recommended: frame.recommendedFormatIds に formatId が含まれるかどうか（Table 2.1 推奨レギュレーション準拠）。
   * - simulatorImplemented: 現行 Simulator (Phase 1.0) で E2E 実装されているのは "light + entry16" のみ。
   */
  public static validateCombination(
    catalog: RegulationCatalog,
    formatId: string,
    frameId: string,
    options?: {
      regulation?: RegulationDefinition;
      assertImplemented?: boolean;
    }
  ): RegulationValidationResult {
    const format = catalog.formats.get(formatId);
    if (!format) {
      throw new UnknownFormatError(formatId);
    }

    const frame = catalog.frames.get(frameId);
    if (!frame) {
      throw new UnknownFrameError(frameId);
    }

    const ruleLegal = true;
    const recommended = frame.recommendedFormatIds.includes(formatId);
    const simulatorImplemented = formatId === "light" && frameId === "entry16";

    if (options?.assertImplemented && !simulatorImplemented) {
      throw new SimulatorNotImplementedError(formatId, frameId);
    }

    return {
      ruleLegal,
      recommended,
      simulatorImplemented,
      regulation: options?.regulation,
      format,
      frame,
    };
  }
}
