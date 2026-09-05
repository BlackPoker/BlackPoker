import { FrameDefinition, RegulationDefinition } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import { BatchSimulationRunner } from "../simulation/BatchSimulationRunner";
import { OfficialRegulationMatchFactory } from "./OfficialRegulationMatchFactory";
import {
  SetupAuditConfig,
  SetupAuditSummary,
  SetupNonReadyEntry,
} from "../../domain/ai/OfficialBaselineMeasurementTypes";

export class OfficialSetupAuditor {
  /**
   * 指定シード・指定試合数で公式セットアップの成立状況（Viability）を監査します。
   * ※ ゲームプレイ（シミュレーションループ）は回さず、セットアップの成否のみを高速に判定します。
   */
  public static audit(
    regulation: RegulationDefinition,
    frame: FrameDefinition,
    rulePackage: RulePackage,
    config: SetupAuditConfig
  ): SetupAuditSummary {
    const { baseSeed, auditCount } = config;
    let readySetups = 0;
    let terminalSetups = 0;
    let ruleUnspecifiedSetups = 0;

    const reasonBreakdown: { [reasonCode: string]: number } = {
      FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED: 0,
      GAME_START_DRAW_LIFE_EXHAUSTED: 0,
    };
    const nonReadyEntries: SetupNonReadyEntry[] = [];

    for (let matchIndex = 0; matchIndex < auditCount; matchIndex++) {
      const matchPlan = BatchSimulationRunner.planMatch(baseSeed, matchIndex);
      const matchSeed = matchPlan.matchSeed;

      const outcome = OfficialRegulationMatchFactory.setupMatch(
        regulation,
        frame,
        rulePackage,
        matchSeed
      );

      if (outcome.type === "READY") {
        readySetups++;
      } else if (outcome.type === "TERMINAL") {
        terminalSetups++;
        nonReadyEntries.push({
          matchIndex,
          matchSeed,
          outcomeType: "TERMINAL",
          reasonCode: outcome.reason,
        });
      } else if (outcome.type === "RULE_UNSPECIFIED") {
        ruleUnspecifiedSetups++;
        const rCode = outcome.reasonCode;
        reasonBreakdown[rCode] = (reasonBreakdown[rCode] || 0) + 1;
        nonReadyEntries.push({
          matchIndex,
          matchSeed,
          outcomeType: "RULE_UNSPECIFIED",
          reasonCode: rCode,
        });
      }
    }

    return {
      plannedSetups: auditCount,
      readySetups,
      terminalSetups,
      ruleUnspecifiedSetups,
      reasonBreakdown: {
        FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED:
          reasonBreakdown.FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED || 0,
        GAME_START_DRAW_LIFE_EXHAUSTED:
          reasonBreakdown.GAME_START_DRAW_LIFE_EXHAUSTED || 0,
      },
      nonReadyEntries,
    };
  }
}
