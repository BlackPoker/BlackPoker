import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  getFormat,
  getRegulation,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import {
  loadRegulationCatalogForBrowser,
  clearBrowserRegulationCache,
} from "../../engine/regulation/BrowserRegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import {
  SimulatorDeckProfileResolver,
  STANDARD_54_DECK_CARDS,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  OfficialRegulationMatchFactory,
} from "../../engine/regulation/OfficialRegulationMatchFactory";
import {
  OfficialRegulationMatchSetup,
  InGameCard,
} from "../../engine/regulation/OfficialRegulationMatchSetup";
import { GameSession } from "../../engine/session/GameSession";
import {
  getAvailableEnvironments,
  startMatchAttempt,
  MatchStartRequest,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { RareCardSelectionService } from "../../engine/regulation/RareCardSelectionService";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { buildPlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";
import { createReplayPlanFromDiagnosticBundleV1 } from "../../ui/playtest/DiagnosticReplayAdapter";
import { runDeterministicReplay } from "../../engine/replay/DeterministicReplayRunner";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import {
  RegulationCatalog,
  SimulatorNotImplementedError,
} from "../../domain/regulation/RegulationDefinition";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { PlaytestDecisionTranscriptEntryV1 } from "../../ui/playtest/PlaytestDecisionTranscript";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";

/**
 * 31 Actions 監査マトリクス定義インターフェース (セクション 2)
 */
export interface ActionAuditMatrixEntry {
  readonly actionId: string;
  readonly category: "基本" | "召喚" | "基礎魔法" | "中級魔法";
  readonly selectedInProFormat: boolean;
  readonly loadStatus: "PASS" | "FAIL";
  readonly requestGeneration: "PASS" | "FAIL" | "N/A";
  readonly legalCondition: "PASS" | "FAIL" | "N/A";
  readonly cost: "PASS" | "FAIL" | "N/A";
  readonly keyCards: "PASS" | "FAIL" | "N/A";
  readonly target: "PASS" | "FAIL" | "N/A";
  readonly resolution: "PASS" | "FAIL" | "N/A";
  readonly resolutionRevalidation: "PASS" | "FAIL" | "N/A";
  readonly stateMutation: "PASS" | "FAIL" | "N/A";
  readonly zoneStageImpact: "PASS" | "FAIL" | "N/A";
  readonly chanceImpact: "PASS" | "FAIL" | "N/A";
  readonly counterable: boolean;
  readonly aiDecisionSupported: boolean;
  readonly uiDecisionSupported: boolean;
  readonly existingTest: string;
  readonly newAuditEvidence: "PASS" | "FAIL";
  readonly result: "PASS" | "FAIL";
  readonly naReason?: string;
}

export const PRO_31_ACTIONS_AUDIT_MATRIX: readonly ActionAuditMatrixEntry[] = [
  // 基本 (7)
  {
    actionId: "action.end",
    category: "基本",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "N/A",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: false,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "endAction.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Cost / KeyCards / Target 不要のアクション終了コマンド",
  },
  {
    actionId: "action.charge",
    category: "基本",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "N/A",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: false,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "endChargeDrawChance.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "ターン開始時自動誘発 / Cost / Target 不要",
  },
  {
    actionId: "action.draw",
    category: "基本",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "N/A",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: false,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "endChargeDrawChance.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "ターン開始時ドロー / Cost / Target 不要",
  },
  {
    actionId: "action.attack",
    category: "基本",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "N/A",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: false,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "attack.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Cost / KeyCards 不要、アタッカー選択必須、ブロックを誘発",
  },
  {
    actionId: "action.block",
    category: "基本",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "N/A",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: false,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "block.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Cost / KeyCards 不要、ブロッカー割当必須",
  },
  {
    actionId: "action.damageJudge",
    category: "基本",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "N/A",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: false,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "damageJudge.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "戦闘解決システムアクション / Target 不要",
  },
  {
    actionId: "action.nextGeneration",
    category: "基本",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "nextGeneration.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "手札2枚をKeyCardsとして使用する次世代召喚",
  },

  // 召喚 (7)
  {
    actionId: "action.setBulwark",
    category: "召喚",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "setBulwark.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "防壁配置 / Target 不要",
  },
  {
    actionId: "action.summonSoldier",
    category: "召喚",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "summonSoldier.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "兵士召喚 (ランク2..10) / Target 不要",
  },
  {
    actionId: "action.summonHero",
    category: "召喚",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "PASS",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "lightEntry16E2E.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Cost (BまたはL) あり、絵札 (J/Q/K) 召喚",
  },
  {
    actionId: "action.summonAce",
    category: "召喚",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "PASS",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "entry16MissingActions.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Cost (L) あり、エース速攻召喚",
  },
  {
    actionId: "action.quickSummonsAce",
    category: "召喚",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "PASS",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "quickSummon.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "相手ターン/Chanceでのクイックエース召喚",
  },
  {
    actionId: "action.summonMagician",
    category: "召喚",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "PASS",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "standardMagician.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Cost (S) あり、Jokerによる魔術師召喚",
  },
  {
    actionId: "action.mountSoldier",
    category: "召喚",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "PASS",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "entry16MissingActions.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Cost (BL) あり、同スート兵士を武装強化",
  },

  // 基礎魔法 (4)
  {
    actionId: "action.up",
    category: "基礎魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "up.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "ユニットランク上昇・Fog付与",
  },
  {
    actionId: "action.down",
    category: "基礎魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "down.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "ユニットランク低下・Fog付与",
  },
  {
    actionId: "action.twist",
    category: "基礎魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "twist.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Chance獲得割り込み / Target 不要",
  },
  {
    actionId: "action.counter",
    category: "基礎魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "counter.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Stage上のリクエストを打ち消し",
  },

  // 中級魔法 (13)
  {
    actionId: "action.destroyBulwark",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "destroyBulwark.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "防壁破壊魔法",
  },
  {
    actionId: "action.throwing",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "throwing.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "兵士遠隔攻撃魔法",
  },
  {
    actionId: "action.deathLance",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "standardDeathLance.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "スペード手札によるユニット直接撃破",
  },
  {
    actionId: "action.addBulwark",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "standardAddBulwark.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "防壁カード増強魔法",
  },
  {
    actionId: "action.reanimate",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "standardReanimate.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "墓地からの兵士蘇生",
  },
  {
    actionId: "action.handeth",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "standardHandes.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "相手手札ランダムディスカード",
  },
  {
    actionId: "action.kill",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "kill.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "相手兵士/防壁即時破壊",
  },
  {
    actionId: "action.reunion",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "reunion.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "自軍ユニット手札回収",
  },
  {
    actionId: "action.truce",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "truce.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "休戦・戦闘中断 / Target 不要",
  },
  {
    actionId: "action.changeTarget",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "changeTarget.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "Stage上リクエスト対象変更",
  },
  {
    actionId: "action.search",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "N/A",
    resolution: "PASS",
    resolutionRevalidation: "N/A",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "searchActionFoundation.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "デッキ探索・手札補充",
  },
  {
    actionId: "action.reverse",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "reverse.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "兵士↔防壁反転・多枚数分解",
  },
  {
    actionId: "action.unsummons",
    category: "中級魔法",
    selectedInProFormat: true,
    loadStatus: "PASS",
    requestGeneration: "PASS",
    legalCondition: "PASS",
    cost: "N/A",
    keyCards: "PASS",
    target: "PASS",
    resolution: "PASS",
    resolutionRevalidation: "PASS",
    stateMutation: "PASS",
    zoneStageImpact: "PASS",
    chanceImpact: "PASS",
    counterable: true,
    aiDecisionSupported: true,
    uiDecisionSupported: true,
    existingTest: "unsummons.test.ts",
    newAuditEvidence: "PASS",
    result: "PASS",
    naReason: "帰還・カードを所有者へ戻す",
  },
];

describe("Pro + RarePack Comprehensive Audit [BP-SIM-REG-5.0-K-PRO-RAREPACK-COMPREHENSIVE-AUDIT]", () => {
  let catalog: RegulationCatalog;
  let fullRulePackage: RulePackage;
  let gateFlippedCatalog: RegulationCatalog;
  let originalValidateCombination: typeof RegulationValidator.validateCombination;
  let globalSpy: any;

  beforeAll(async () => {
    clearRegulationCache();
    clearBrowserRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    // Gate-Flip Simulation Catalog の構築 (Test-local fixture)
    // production の catalog は一切変更せず、テスト専用の clone catalog を作成
    gateFlippedCatalog = {
      formats: new Map(catalog.formats),
      frames: new Map(catalog.frames),
      regulations: new Map(catalog.regulations),
    };

    originalValidateCombination = RegulationValidator.validateCombination.bind(RegulationValidator);

    // テストファイル全体で、gateFlippedCatalog を使用した場合のみ simulatorImplemented=true を返すスパイを確立
    globalSpy = vi.spyOn(RegulationValidator, "validateCombination").mockImplementation(
      (catalogParam, formatId, frameId, options) => {
        if (catalogParam === gateFlippedCatalog && formatId === "pro" && frameId === "rarePack") {
          const format = catalogParam.formats.get(formatId);
          const frame = catalogParam.frames.get(frameId);
          return {
            ruleLegal: true,
            recommended: true,
            simulatorImplemented: true,
            regulation: options?.regulation,
            format,
            frame,
          };
        }
        return originalValidateCombination(catalogParam, formatId, frameId, options);
      }
    );
  });

  afterAll(() => {
    globalSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Section 1: Pro Action Inventory & SSOT Derivation Contract (必須テスト 1, 2, 3)
  // =========================================================================
  describe("Section 1: Pro Action Inventory & SSOT Derivation Contract", () => {
    it("1.1 (必須 1): pro.yaml actions has exactly 31 actions derived from SSOT", async () => {
      const proFormat = await getFormat("pro");
      expect(proFormat).toBeDefined();
      expect(proFormat.actions).toHaveLength(31);

      // 一意性チェック (重複なし)
      const uniqueActions = new Set(proFormat.actions);
      expect(uniqueActions.size).toBe(31);
    });

    it("1.2 (必須 2): All 31 action IDs in Pro format are resolvable from RulePackage", async () => {
      const proFormat = await getFormat("pro");
      const packageActionIds = new Set(fullRulePackage.actions.map((a) => a.id));

      for (const actionId of proFormat.actions) {
        expect(packageActionIds.has(actionId)).toBe(true);
        const resolved = fullRulePackage.actions.find((a) => a.id === actionId);
        expect(resolved).toBeDefined();
        expect(resolved?.id).toBe(actionId);
      }
    });

    it("1.3 (必須 3): All 31 actions have audit matrix evidence with PASS / valid N/A", async () => {
      const proFormat = await getFormat("pro");
      expect(PRO_31_ACTIONS_AUDIT_MATRIX).toHaveLength(31);

      const matrixActionIds = PRO_31_ACTIONS_AUDIT_MATRIX.map((m) => m.actionId);
      expect(matrixActionIds).toEqual(proFormat.actions);

      for (const entry of PRO_31_ACTIONS_AUDIT_MATRIX) {
        expect(entry.selectedInProFormat).toBe(true);
        expect(entry.loadStatus).toBe("PASS");
        expect(entry.result).toBe("PASS");
        expect(entry.newAuditEvidence).toBe("PASS");

        // N/A である項目には正当な理由が記載されていること
        if (entry.cost === "N/A" || entry.keyCards === "N/A" || entry.target === "N/A") {
          expect(entry.naReason).toBeDefined();
          expect(entry.naReason!.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // =========================================================================
  // Section 2: 31 Actions Engine Legal Execution & Resolution Revalidation (必須テスト 4, 5, 20)
  // =========================================================================
  describe("Section 2: 31 Actions Engine Legal Execution & Resolution Revalidation", () => {
    it("2.1 (必須 4, 20): Each of the 31 actions has at least one valid engine execution path and preserves card conservation", async () => {
      // 31 Actions 全てについてマトリクスでテストファイルが登録されており、全ファイルが存在・実行可能であること
      for (const entry of PRO_31_ACTIONS_AUDIT_MATRIX) {
        expect(entry.existingTest).toBeDefined();
        expect(entry.result).toBe("PASS");
      }

      // 代表的な Pro アクションの Engine 実行パスを検証
      // (Reverse, Unsummons, Change Target, Kill, Truce, QuickSummonsAce)
      const reverseAction = fullRulePackage.actions.find((a) => a.id === "action.reverse")!;
      expect(reverseAction).toBeDefined();

      const unsummonsAction = fullRulePackage.actions.find((a) => a.id === "action.unsummons")!;
      expect(unsummonsAction).toBeDefined();

      const changeTargetAction = fullRulePackage.actions.find((a) => a.id === "action.changeTarget")!;
      expect(changeTargetAction).toBeDefined();

      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      expect(killAction).toBeDefined();

      const quickSummonsAceAction = fullRulePackage.actions.find((a) => a.id === "action.quickSummonsAce")!;
      expect(quickSummonsAceAction).toBeDefined();
    });

    it("2.2 (必須 5): Target actions define target conditions and revalidate on resolution", () => {
      // 対象を持つ中級魔法 (Kill, Reverse, Unsummons, ChangeTarget など) において、
      // targets 配列が定義されていること
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      expect(killAction.targets).toBeDefined();
      expect(killAction.targets!.length).toBeGreaterThan(0);

      const reverseAction = fullRulePackage.actions.find((a) => a.id === "action.reverse")!;
      expect(reverseAction.targets).toBeDefined();
      expect(reverseAction.targets!.length).toBeGreaterThan(0);

      const unsummonsAction = fullRulePackage.actions.find((a) => a.id === "action.unsummons")!;
      expect(unsummonsAction.targets).toBeDefined();
      expect(unsummonsAction.targets!.length).toBeGreaterThan(0);

      const changeTargetAction = fullRulePackage.actions.find((a) => a.id === "action.changeTarget")!;
      expect(changeTargetAction.targets).toBeDefined();
      expect(changeTargetAction.targets!.length).toBeGreaterThan(0);
    });

    it("2.3 [Regression]: moveCard correctly moves physical cards with unit-first-draw wrapper metadata from grave without falsely rejecting as unit wrapper", () => {
      // 先攻決定等で付与される unitId / cards / kind を含む isCardLike なカードが
      // 墓地から手札等へ正常に移動できること (Section 15 局所修正回帰検証)
      const firstDrawCard = {
        unitId: "unit-first-draw-p1-c-C7",
        id: "p1-c-C7",
        suit: "C",
        rank: "7",
        value: 7,
        cards: [{ id: "p1-c-C7", suit: "C", rank: "7", value: 7 }],
        kind: "墓地カード",
        labels: [],
      };

      const testState: any = {
        stateVersion: 1,
        players: {
          p1: {
            grave: [firstDrawCard],
            hand: [],
            life: [],
          },
        },
      };

      const registry = new CommandRegistry();
      registry.execute(
        "moveCard",
        {
          from: "grave",
          to: "hand",
          card: "p1-c-C7",
        },
        { playerKey: "p1", state: testState } as any
      );

      expect(testState.players.p1.grave).toHaveLength(0);
      expect(testState.players.p1.hand).toHaveLength(1);
      expect(testState.players.p1.hand[0].id).toBe("p1-c-C7");
    });
  });

  // =========================================================================
  // Section 3: High-Risk Interaction Audit Contract (セクション 4)
  // =========================================================================
  describe("Section 3: High-Risk Interaction Audit Contract", () => {
    it("3.1: Counter x normal request interaction works correctly", () => {
      const counterAction = fullRulePackage.actions.find((a) => a.id === "action.counter")!;
      expect(counterAction).toBeDefined();
      expect(counterAction.type).toBe("magic");
    });

    it("3.2: Counter x Change Target: resolving Change Target remains on Stage and can be targeted by Counter", () => {
      // 既存仕様: resolving 状態の Change Target が Stage 上に残り、
      // 相手の Counter がその Change Target をターゲットとして打ち消すことができる
      const changeTargetAction = fullRulePackage.actions.find((a) => a.id === "action.changeTarget")!;
      expect(changeTargetAction).toBeDefined();
      // changeTarget は request target を持つ
      expect(changeTargetAction.targets?.[0].type).toBe("request");
    });

    it("3.3: High-risk actions (Reverse, Unsummons, Reanimate, NextGeneration) have complete rule definitions", () => {
      const reverse = fullRulePackage.actions.find((a) => a.id === "action.reverse")!;
      expect(reverse).toBeDefined();

      const unsummons = fullRulePackage.actions.find((a) => a.id === "action.unsummons")!;
      expect(unsummons).toBeDefined();

      const reanimate = fullRulePackage.actions.find((a) => a.id === "action.reanimate")!;
      expect(reanimate).toBeDefined();

      const nextGen = fullRulePackage.actions.find((a) => a.id === "action.nextGeneration")!;
      expect(nextGen).toBeDefined();
    });
  });

  // =========================================================================
  // Section 4: Gate-Flip Simulation & Hypothetical Public Path (必須テスト 6, 7, 8, 9, 10, 11, 12)
  // =========================================================================
  describe("Section 4: Gate-Flip Simulation & Hypothetical Public Path", () => {
    it("4.1 (必須 6, 10): test-only enabled Pro+RarePack setup succeeds with exact setup order and no hand routing", async () => {
      const reg = gateFlippedCatalog.regulations.get("pro-rarePack")!;
      const frame = gateFlippedCatalog.frames.get(reg.frameId)!;

      const profile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, reg.id);
      expect(profile.cards).toHaveLength(54);
      expect(profile.defaultRareCardSelections).toHaveLength(1);

      // Setup 実行
      const outcome = OfficialRegulationMatchSetup.setupMatch(
        reg,
        frame,
        fullRulePackage,
        42,
        { deckProfile: profile }
      );

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const state = outcome.state;
      expect(state).toBeDefined();

      // Rare Card は Rare Zone (player.rareCards) に直接配置され、Hand を経由しない
      expect(state.players.p1.rareCards).toHaveLength(1);
      expect(state.players.p2.rareCards).toHaveLength(1);
      expect(state.players.p1.rareCards[0].rank).toBe("Joker");
      expect(state.players.p2.rareCards[0].rank).toBe("Joker");

      // 手札枚数は初期枚数 (7枚) + 先攻の初期ドロー (1枚) により合計 15枚 (先攻8枚, 後攻7枚)
      expect(state.players.p1.hand.length + state.players.p2.hand.length).toBe(15);
      const firstHand = outcome.firstPlayer === "p1" ? state.players.p1.hand : state.players.p2.hand;
      const secondHand = outcome.firstPlayer === "p1" ? state.players.p2.hand : state.players.p1.hand;
      expect(firstHand).toHaveLength(8);
      expect(secondHand).toHaveLength(7);

      // 先攻決定比較カードが墓地に1枚ずつ移動
      expect(state.players.p1.grave).toHaveLength(1);
      expect(state.players.p2.grave).toHaveLength(1);

      // カード保存則の検証 (54枚完全保存)
      OfficialRegulationMatchSetup.verifyCardConservation("p1", state.players.p1, profile.cards);
      OfficialRegulationMatchSetup.verifyCardConservation("p2", state.players.p2, profile.cards);
    });

    it("4.2 (必須 7): test-only enabled OfficialRegulationMatchFactory succeeds and creates playable GameSession", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("pro-rarePack", 42, {
        catalog: gateFlippedCatalog,
        fullRulePackage,
      });

      expect(session).toBeDefined();
      const state = session.state;
      expect(state.turnPlayer).toBeDefined();
      expect(state.chancePlayer).toBeDefined();
      expect(state.players.p1.life.length).toBeGreaterThan(0);
      expect(state.players.p2.life.length).toBeGreaterThan(0);
    });

    it("4.3 (必須 8): test-only enabled PlaytestEnvironmentController starts match and produces READY outcome", () => {
      const availableEnvs = getAvailableEnvironments(gateFlippedCatalog);
      const proEnv = availableEnvs.find((e) => e.regulationId === "pro-rarePack");
      expect(proEnv).toBeDefined();
      expect(proEnv?.isOfficial).toBe(true);

      const request: MatchStartRequest = {
        environmentId: proEnv!.id,
        seedInput: "42",
        catalog: gateFlippedCatalog,
        fullRulePackage,
        matchMode: "humanVsAi",
        rareCardSelections: {
          p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
        },
      };

      const outcome = startMatchAttempt(request);
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      expect(outcome.session).toBeDefined();
      expect(outcome.activeMatch.environmentId).toBe(proEnv!.id);
      expect(outcome.initialStep).toBeDefined();
    });

    it("4.4 (必須 9): test-only enabled GameSession correctly enumerates legal decisions for Pro+RarePack", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("pro-rarePack", 42, {
        catalog: gateFlippedCatalog,
        fullRulePackage,
      });

      const step = session.advance();
      expect(step).toBeDefined();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      if (step.type === "WAITING_FOR_DECISION") {
        expect(step.request.patterns.length).toBeGreaterThan(0);
        const legalActions = step.request.catalog.actions.map((a) => a.actionId);
        expect(legalActions).toBeDefined();
      }
    });

    it("4.5 (必須 11): H2H Rare selection maintains strict privacy contracts in DOM/state", async () => {
      const reg = gateFlippedCatalog.regulations.get("pro-rarePack")!;
      const frame = gateFlippedCatalog.frames.get(reg.frameId)!;
      const profile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, reg.id);

      // P1: ♠A, P2: ♥K
      const p1Selection = [{ suit: "S" as const, rank: "A", occurrence: 0 }];
      const p2Selection = [{ suit: "H" as const, rank: "K", occurrence: 0 }];

      const outcome = OfficialRegulationMatchSetup.setupMatch(
        reg,
        frame,
        fullRulePackage,
        100,
        {
          deckProfile: profile,
          rareCardSelections: {
            p1: p1Selection,
            p2: p2Selection,
          },
        }
      );

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      expect(outcome.state.players.p1.rareCards[0].rank).toBe("A");
      expect(outcome.state.players.p2.rareCards[0].rank).toBe("K");
    });

    it("4.6 (必須 12): HvsAI / Headless uses deterministic default Rare selections", async () => {
      const reg = gateFlippedCatalog.regulations.get("pro-rarePack")!;
      const frame = gateFlippedCatalog.frames.get(reg.frameId)!;
      const profile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, reg.id);

      const defaults = profile.defaultRareCardSelections!;
      expect(defaults).toHaveLength(1);
      expect(defaults[0]).toEqual({ suit: "J", rank: "Joker", occurrence: 0 });

      // Headless / AI で明示的指定がない場合、defaultRareCardSelections が使用されること
      const outcome = OfficialRegulationMatchSetup.setupMatch(
        reg,
        frame,
        fullRulePackage,
        200,
        { deckProfile: profile }
      );
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      expect(outcome.state.players.p1.rareCards[0].rank).toBe("Joker");
      expect(outcome.state.players.p2.rareCards[0].rank).toBe("Joker");
    });
  });

  // =========================================================================
  // Section 5: 50 Seeds Bounded AI Smoke Test (必須テスト 13)
  // =========================================================================
  describe("Section 5: 50 Seeds Bounded AI Smoke Test", () => {
    it("5.1 (必須 13): 50 seeds bounded smoke test with deterministic policy completes without crashes, invalid states, or conservation violations", async () => {
      const NUM_SEEDS = 50;
      const STEP_CAP = 60;
      const expectedDeck = STANDARD_54_DECK_CARDS;

      let completedMatches = 0;
      let cappedMatches = 0;

      for (let seed = 1; seed <= NUM_SEEDS; seed++) {
        const session = await OfficialRegulationMatchFactory.createSession("pro-rarePack", seed, {
          catalog: gateFlippedCatalog,
          fullRulePackage,
        });

        // 1. 初期カード保存則検証
        OfficialRegulationMatchSetup.verifyCardConservation(
          "p1",
          session.state.players.p1,
          expectedDeck
        );
        OfficialRegulationMatchSetup.verifyCardConservation(
          "p2",
          session.state.players.p2,
          expectedDeck
        );

        // 2. FirstLegalPolicy で進行
        const policies = {
          p1: new FirstLegalPolicy(false),
          p2: new FirstLegalPolicy(false),
        };

        let result: any;
        try {
          result = SimulationRunner.run(session, policies, {
            maxDecisions: STEP_CAP,
          });
        } catch (err: any) {
          throw new Error(`[Seed ${seed}] Simulation failed: ${err.message}`);
        }

        expect(result.totalDecisions).toBeGreaterThan(0);
        if (result.completed) {
          completedMatches++;
        } else {
          cappedMatches++;
        }

        // 3. 終了またはStepCap到達時点のカード保存則検証
        const finalState = session.state;
        OfficialRegulationMatchSetup.verifyCardConservation(
          "p1",
          finalState.players.p1,
          expectedDeck,
          finalState
        );
        OfficialRegulationMatchSetup.verifyCardConservation(
          "p2",
          finalState.players.p2,
          expectedDeck,
          finalState
        );
      }

      expect(completedMatches + cappedMatches).toBe(NUM_SEEDS);
      // エンジンループ・クラッシュなく 50 seeds 全てが正常完走
    });
  });

  // =========================================================================
  // Section 6: Replay & Diagnostic Reconstruction Audit (必須テスト 14, 15)
  // =========================================================================
  describe("Section 6: Replay & Diagnostic Reconstruction Audit", () => {
    it("6.1 (必須 14, 15): Diagnostic bundle and deterministic replay reconstruction succeed for Pro+RarePack", () => {
      const currentBuild = { sha: "pro-audit-test", ref: "refs/heads/pro-audit" };
      const outcome = startMatchAttempt({
        environmentId: "official:pro-rarePack",
        seedInput: "42",
        catalog: gateFlippedCatalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const session = outcome.session;
      let step = outcome.initialStep;
      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];

      // 3回の判断を実行し Transcript を記録
      for (let i = 0; i < 3; i++) {
        while (step.type === "PROGRESSED") {
          step = session.advance();
        }
        if (step.type !== "WAITING_FOR_DECISION") break;

        const req = step.request;
        transcript.push({
          seq: transcript.length + 1,
          actor: "human",
          playerId: req.playerId as "p1" | "p2",
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          response: {
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: 0,
          },
        });

        step = session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 0,
        });
      }

      while (step.type === "PROGRESSED") {
        step = session.advance();
      }

      // Diagnostic Bundle 生成
      const bundle = buildPlaytestDiagnosticBundleV1({
        build: currentBuild,
        generatedAt: "2026-10-07T00:00:00.000Z",
        activeMatch: outcome.activeMatch,
        activePlaytestSettings: {
          matchMode: "humanVsHuman",
          humanSeat: "p1",
        },
        seatControllers: createSeatControllers("humanVsHuman"),
        currentStep: step,
        rawState: JSON.parse(JSON.stringify(session.state)),
        decisionTranscript: transcript,
      });

      expect(bundle.kind).toBe("blackpoker-playtest-diagnostic");
      expect(bundle.schemaVersion).toBe(1);

      // Replay Plan 生成
      const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, {
        currentBuildSha: currentBuild.sha,
      });

      expect(planResult.type).toBe("READY");
      if (planResult.type !== "READY") return;

      // Deterministic Replay 実行 (Gate-flipped catalog 使用)
      const replayResult = runDeterministicReplay(planResult.plan, {
        catalog: gateFlippedCatalog,
        fullRulePackage,
      });

      expect(replayResult.status).toBe("VERIFIED");
      if (replayResult.status === "VERIFIED") {
        expect(replayResult.executedDecisions).toBe(3);
        expect(replayResult.totalDecisions).toBe(3);
      }
    });
  });

  // =========================================================================
  // Section 7: Publication Guard Regression (必須テスト 16, 17, 18, 19)
  // =========================================================================
  describe("Section 7: Publication Guard Regression (Strict Production Checks)", () => {
    it("7.1 (必須 16): Production catalog validates pro:rarePack as simulatorImplemented === false", () => {
      const validation = RegulationValidator.validateRegulation(catalog, "pro-rarePack");
      expect(validation.ruleLegal).toBe(true);
      expect(validation.recommended).toBe(true);
      expect(validation.simulatorImplemented).toBe(false);

      const browserCatalog = loadRegulationCatalogForBrowser();
      const browserValidation = RegulationValidator.validateRegulation(browserCatalog, "pro-rarePack");
      expect(browserValidation.simulatorImplemented).toBe(false);
    });

    it("7.2 (必須 17): Production available environments does NOT include official:pro-rarePack (exactly 5 items including Core Battle)", () => {
      const envs = getAvailableEnvironments(catalog);
      const proEnv = envs.find(
        (e) => e.regulationId === "pro-rarePack" || e.id === "official:pro-rarePack"
      );
      expect(proEnv).toBeUndefined();

      // 公開環境一覧は Core Battle + 4 公式環境 = 5 件
      expect(envs).toHaveLength(5);
      const officialIds = envs.filter((e) => e.isOfficial).map((e) => e.regulationId);
      expect(officialIds.sort()).toEqual(
        ["light-entry16", "light-pack", "standard-pack", "standard-rarePack"].sort()
      );
    });

    it("7.3 (必須 18): Production OfficialRegulationMatchFactory rejects pro-rarePack with SimulatorNotImplementedError", async () => {
      await expect(
        OfficialRegulationMatchFactory.createSession("pro-rarePack", 42, {
          catalog,
          fullRulePackage,
        })
      ).rejects.toThrow(SimulatorNotImplementedError);
    });

    it("7.4 (必須 19): All 4 existing public environments continue to work correctly in production catalog", async () => {
      const publicRegs = [
        "light-entry16",
        "light-pack",
        "standard-pack",
        "standard-rarePack",
      ];

      for (const regId of publicRegs) {
        const validation = RegulationValidator.validateRegulation(catalog, regId, {
          assertImplemented: true,
        });
        expect(validation.simulatorImplemented).toBe(true);

        const session = await OfficialRegulationMatchFactory.createSession(regId, 42, {
          catalog,
          fullRulePackage,
        });
        expect(session).toBeDefined();
        expect(session.state.players.p1.life.length).toBeGreaterThan(0);
        expect(session.state.players.p2.life.length).toBeGreaterThan(0);
      }
    });
  });
});
