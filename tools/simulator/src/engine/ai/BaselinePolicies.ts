import { PolicyExperimentParticipant } from "../../domain/ai/PolicyExperimentTypes";
import { FirstLegalPolicy, RandomPolicy } from "../simulation/DecisionPolicy";
import { SeededRandom } from "../random/RandomSource";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { GenomePolicy } from "./GenomePolicy";
import { PATTERN_FEATURE_NAMES } from "../../domain/ai/DecisionFeatureTypes";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";

/**
 * 実験評価用の手動汎用 Genome DNA (Manual Generic Genome v1) を生成
 *
 * 【設計原則】
 * 1. 汎用特徴量のみ使用:
 *    pattern_is_action (+5.0), pattern_is_pass (-3.0), pattern_is_effect_selection (+5.0) の
 *    汎用パターン種別特徴量のみに重みを設定。
 * 2. Action ID / Component ID の完全排除:
 *    "action.attack" や "action.end" 等の個別 ID に対する重み・条件判定は一切使用しません。
 * 3. 目的:
 *    最強の AI を作ることではなく、重み設定が実際の意思決定（Behavior）および結果へ
 *    反映されることを検証するための決定論的ベースラインです。
 */
export function createManualGenericGenomeDNA(): DecisionDNA {
  const dna = DecisionDNACodec.createZeroDecisionDNA({
    id: "baseline-manual-genome-v1",
    name: "ManualGenericGenome",
    tags: ["baseline", "manual-generic", "v1"],
  });

  const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
  const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
  const effIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");

  if (actIdx !== -1) (dna.patternWeights as number[])[actIdx] = 5.0;
  if (passIdx !== -1) (dna.patternWeights as number[])[passIdx] = -3.0;
  if (effIdx !== -1) (dna.patternWeights as number[])[effIdx] = 5.0;

  DecisionDNACodec.validate(dna);
  return dna;
}

/**
 * 4種類の標準 Baseline Participant Factory
 */
export class BaselineParticipants {
  /**
   * 1. FirstLegal Policy Participant
   */
  public static createFirstLegal(
    id: string = "baseline-first-legal-v1",
    name: string = "FirstLegal",
    preferPass: boolean = false
  ): PolicyExperimentParticipant {
    return {
      id,
      name,
      artifactRef: `policy:firstLegal:v1:${preferPass ? "preferPass" : "preferAction"}`,
      policyFactory: () => new FirstLegalPolicy(preferPass),
    };
  }

  /**
   * 2. Seeded Random Policy Participant
   */
  public static createRandom(
    id: string = "baseline-seeded-random-v1",
    name: string = "SeededRandom"
  ): PolicyExperimentParticipant {
    return {
      id,
      name,
      artifactRef: "policy:random:v1:seeded",
      policyFactory: (ctx, seat) => {
        const seed = ctx.playerSeeds[seat];
        return new RandomPolicy(new SeededRandom(seed), `${name}-${seat}`);
      },
    };
  }

  /**
   * 3. Zero Genome Policy Participant
   */
  public static createZeroGenome(
    id: string = "baseline-zero-genome-v1",
    name: string = "ZeroGenome"
  ): PolicyExperimentParticipant {
    const zeroDNA = DecisionDNACodec.createZeroDecisionDNA({
      id: "baseline-zero-genome-v1",
      name: "ZeroGenome",
    });

    return {
      id,
      name,
      artifactRef: "dna:artifact:zero-genome-v1",
      policyFactory: () => new GenomePolicy(zeroDNA, name),
    };
  }

  /**
   * 4. Manual Generic Genome Policy Participant
   */
  public static createManualGenericGenome(
    id: string = "baseline-manual-genome-v1",
    name: string = "ManualGenericGenome"
  ): PolicyExperimentParticipant {
    const manualDNA = createManualGenericGenomeDNA();

    return {
      id,
      name,
      artifactRef: "dna:artifact:manual-generic-genome-v1",
      policyFactory: () => new GenomePolicy(manualDNA, name),
    };
  }
}
