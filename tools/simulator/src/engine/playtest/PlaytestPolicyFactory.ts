import { DecisionPolicy, FirstLegalPolicy, RandomPolicy } from "../simulation/DecisionPolicy";
import { PlaytestConservativePolicy } from "./PlaytestConservativePolicy";
import { SeededRandom } from "../random/RandomSource";
import { GenomePolicy } from "../ai/GenomePolicy";
import { DecisionDNACodec } from "../ai/DecisionDNACodec";
import { createManualGenericGenomeDNA } from "../ai/BaselinePolicies";
import { createEvolutionG1BestPolicy, EVOLUTION_G1_BEST_SUPPORTED_REGULATION_ID } from "../ai/EvolutionDNALoader";
import { BatchSimulationRunner } from "../simulation/BatchSimulationRunner";
import { PlaytestPolicyId, PlaytestSeatControllers } from "./PlaytestSeatController";

/**
 * Playtest UI 用 AI Policy ファクトリ。
 * 既存の Baseline Policy 実装を再利用し、決定論的 Seed Derivation（BatchSimulationRunner.deriveSeed）を適用します。
 */
export class PlaytestPolicyFactory {
  /**
   * 指定 seat および matchSeed に対するシード値を決定論的に導出
   * ※ BatchSimulationRunner.deriveSeed() を再利用して同一計算を保証
   */
  public static derivePolicySeed(matchSeed: number, seat: string): number {
    if (typeof matchSeed !== "number" || !Number.isFinite(matchSeed)) {
      throw new Error(`Invalid matchSeed for policy seed derivation: ${matchSeed}`);
    }
    return BatchSimulationRunner.deriveSeed(matchSeed, 0, seat);
  }

  /**
   * Policy ID に応じた DecisionPolicy インスタンスを生成
   */
  public static createPolicy(
    policyId: PlaytestPolicyId,
    matchSeed: number | undefined,
    seat: string,
    regulationId?: string
  ): DecisionPolicy {
    switch (policyId) {
      case "playtestConservative":
        return new PlaytestConservativePolicy();

      case "firstLegal":
        return new FirstLegalPolicy(false);

      case "seededRandom": {
        if (matchSeed === undefined || typeof matchSeed !== "number" || !Number.isFinite(matchSeed)) {
          throw new Error(
            `SeededRandom policy requires a valid match seed. (Core Battle does not define a match seed; please select an Official Regulation or use a deterministic policy)`
          );
        }
        const seed = this.derivePolicySeed(matchSeed, seat);
        return new RandomPolicy(new SeededRandom(seed), `SeededRandom-${seat}`);
      }

      case "manualGenericGenome": {
        const manualDNA = createManualGenericGenomeDNA();
        return new GenomePolicy(manualDNA, "ManualGenericGenome");
      }

      case "zeroGenome": {
        const zeroDNA = DecisionDNACodec.createZeroDecisionDNA({
          id: "playtest-zero-genome-v1",
          name: "ZeroGenome",
        });
        return new GenomePolicy(zeroDNA, "ZeroGenome");
      }

      case "evolution-g1-best": {
        if (regulationId !== EVOLUTION_G1_BEST_SUPPORTED_REGULATION_ID) {
          throw new Error(
            `Evolution g1 Best AI は公式レギュレーション ${EVOLUTION_G1_BEST_SUPPORTED_REGULATION_ID} 専用です (現在の環境: ${regulationId ?? "undefined"})`
          );
        }
        return createEvolutionG1BestPolicy();
      }

      default: {
        const exhaustiveCheck: never = policyId;
        throw new Error(`Unknown PlaytestPolicyId: ${exhaustiveCheck}`);
      }
    }
  }

  /**
   * SeatControllers 定義に従い、POLICY が指定された席の DecisionPolicy インスタンスマップを生成
   */
  public static createPoliciesForMatch(
    seatControllers: PlaytestSeatControllers,
    matchSeed?: number,
    regulationId?: string
  ): Record<string, DecisionPolicy> {
    const policies: Record<string, DecisionPolicy> = {};

    if (seatControllers.p1.kind === "POLICY") {
      policies.p1 = this.createPolicy(seatControllers.p1.policyId, matchSeed, "p1", regulationId);
    }

    if (seatControllers.p2.kind === "POLICY") {
      policies.p2 = this.createPolicy(seatControllers.p2.policyId, matchSeed, "p2", regulationId);
    }

    return policies;
  }
}
