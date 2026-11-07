/**
 * BlackPoker Work 4-2 — Million Match Dedicated Worker Thread
 *
 * 各 Worker Thread は独立した V8 Isolate とイベントループで動作する。
 * スレッド起動時に RulePackage および Champion Policy を 1 回だけ初期化し、
 * 座席反転ペア（Leg 0 & Leg 1）の対戦タスクを逐次実行して結果を返す。
 */

import { parentPort } from "worker_threads";
import * as path from "path";
import {
  MainToWorkerMessage,
  WorkerInitOkMessage,
  WorkerPairResultMessage,
  WorkerErrorMessage,
} from "../../domain/simulation/MillionMatchWorkerTypes";
import {
  executeSingleInstrumentedMatch,
  SingleMatchExecutionInput,
  SingleMatchExecutionResult,
} from "./MillionMatchCampaignEngine";
import { loadRulePackageFromDirectory } from "../rules/RuleLoader";
import { getPlaytestRulePackage } from "../rules/RulePackageSelector";
import { prepareOfficialSessionFactory } from "../../cli/stage3EvolutionRunner";
import { DecisionPolicy, FirstLegalPolicy, RandomPolicy } from "./DecisionPolicy";
import { GenomePolicy } from "../ai/GenomePolicy";
import { SeededRandom } from "../random/RandomSource";
import { ParticipantPolicySpec } from "../../domain/simulation/MillionMatchInfraTypes";
import { EvolutionIndependentEvaluator } from "../ai/EvolutionIndependentEvaluator";
import { GameSession } from "../session/GameSession";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes";

if (!parentPort) {
  throw new Error("[MillionMatchWorker] Must be spawned as a Worker Thread");
}

// Core の [TRIGGER] / [BUFFER-] ログによる標準出力・I/O 負荷を抑制
const origConsoleLog = console.log;
console.log = (...args: any[]) => {
  const first = typeof args[0] === "string" ? args[0] : "";
  if (first.startsWith("[TRIGGER]") || first.startsWith("[BUFFER-")) {
    return;
  }
  origConsoleLog(...args);
};

let workerId = -1;
let sessionFactory: ((ctx: BatchMatchContext) => GameSession) | null = null;
let policyResolver:
  | ((
      spec: ParticipantPolicySpec,
      seat: "p1" | "p2",
      matchSeed: number,
      playerSeed: number
    ) => DecisionPolicy)
  | null = null;
let defaultRegulationId = "standard-pack";
let defaultFrameId = "pack";

parentPort.on("message", async (msg: MainToWorkerMessage) => {
  try {
    if (msg.type === "INIT") {
      workerId = msg.workerId;
      defaultRegulationId = msg.regulationId;
      defaultFrameId = msg.frameId;

      // 1. ルールパッケージのロードとセッションファクトリの準備
      const fullPackage = await loadRulePackageFromDirectory(path.resolve(msg.rulesDir));
      getPlaytestRulePackage(fullPackage);
      sessionFactory = await prepareOfficialSessionFactory(msg.regulationId);

      // 2. Champion DNA の真正性検証
      const { champions } = msg;
      const actualGen7Digest = EvolutionIndependentEvaluator.computeDnaDigest(champions.gen7DNA);
      const actualGen5Digest = EvolutionIndependentEvaluator.computeDnaDigest(champions.gen5DNA);
      const actualZeroDigest = EvolutionIndependentEvaluator.computeDnaDigest(champions.zeroDNA);

      if (actualGen7Digest !== champions.gen7Digest) {
        throw new Error(
          `[Worker ${workerId}] Gen 7 DNA Digest mismatch: expected ${champions.gen7Digest}, computed ${actualGen7Digest}`
        );
      }
      if (actualGen5Digest !== champions.gen5Digest) {
        throw new Error(
          `[Worker ${workerId}] Gen 5 DNA Digest mismatch: expected ${champions.gen5Digest}, computed ${actualGen5Digest}`
        );
      }
      if (actualZeroDigest !== champions.zeroDigest) {
        throw new Error(
          `[Worker ${workerId}] ZeroDNA Digest mismatch: expected ${champions.zeroDigest}, computed ${actualZeroDigest}`
        );
      }

      // 3. Policy Resolver の初期化
      policyResolver = (
        spec: ParticipantPolicySpec,
        seat: "p1" | "p2",
        _matchSeed: number,
        playerSeed: number
      ): DecisionPolicy => {
        if (spec.policyId === "gen7-champion") {
          return new GenomePolicy(champions.gen7DNA, `Gen7Champion-${seat}`);
        }
        if (spec.policyId === "gen5-champion") {
          return new GenomePolicy(champions.gen5DNA, `Gen5Champion-${seat}`);
        }
        if (spec.policyId === "zero-dna") {
          return new GenomePolicy(champions.zeroDNA, `ZeroDNA-${seat}`);
        }
        if (spec.policyId === "seeded-random") {
          return new RandomPolicy(new SeededRandom(playerSeed), `SeededRandom-${seat}`);
        }
        if (spec.policyId === "first-legal") {
          return new FirstLegalPolicy(false);
        }
        throw new Error(`[Worker ${workerId}] Unknown policyId "${spec.policyId}"`);
      };

      const initOk: WorkerInitOkMessage = {
        type: "INIT_OK",
        workerId,
        gen7Digest: actualGen7Digest,
        gen5Digest: actualGen5Digest,
        zeroDigest: actualZeroDigest,
      };
      parentPort!.postMessage(initOk);
      return;
    }

    if (msg.type === "RUN_PAIR") {
      if (!sessionFactory || !policyResolver) {
        throw new Error(`[Worker ${workerId}] Not initialized before RUN_PAIR`);
      }

      const {
        taskId,
        campaignId,
        workId,
        pairIndex,
        matchSeed,
        playerSeeds,
        matchup,
        maxDecisionsPerMatch,
      } = msg;

      // Leg 0: p1 = agentA, p2 = agentB
      const matchIndex0 = pairIndex * 2;
      const matchId0 = `${campaignId}-p${pairIndex}-l0-s${matchSeed}-${matchup.agentA.policyId}-vs-${matchup.agentB.policyId}`;
      const leg0Input: SingleMatchExecutionInput = {
        campaignId,
        workId,
        matchIndex: matchIndex0,
        pairIndex,
        legIndex: 0,
        matchId: matchId0,
        matchupId: matchup.matchupId,
        matchSeed,
        playerSeeds,
        p1Spec: matchup.agentA,
        p2Spec: matchup.agentB,
        p1Policy: policyResolver(matchup.agentA, "p1", matchSeed, playerSeeds.p1),
        p2Policy: policyResolver(matchup.agentB, "p2", matchSeed, playerSeeds.p2),
        sessionFactory,
        regulationId: defaultRegulationId,
        frameId: defaultFrameId,
        maxDecisionsPerMatch,
      };

      // Leg 1: p1 = agentB, p2 = agentA (座席反転)
      const matchIndex1 = pairIndex * 2 + 1;
      const matchId1 = `${campaignId}-p${pairIndex}-l1-s${matchSeed}-${matchup.agentB.policyId}-vs-${matchup.agentA.policyId}`;
      const leg1Input: SingleMatchExecutionInput = {
        campaignId,
        workId,
        matchIndex: matchIndex1,
        pairIndex,
        legIndex: 1,
        matchId: matchId1,
        matchupId: matchup.matchupId,
        matchSeed,
        playerSeeds,
        p1Spec: matchup.agentB,
        p2Spec: matchup.agentA,
        p1Policy: policyResolver(matchup.agentB, "p1", matchSeed, playerSeeds.p1),
        p2Policy: policyResolver(matchup.agentA, "p2", matchSeed, playerSeeds.p2),
        sessionFactory,
        regulationId: defaultRegulationId,
        frameId: defaultFrameId,
        maxDecisionsPerMatch,
      };

      const leg0Result: SingleMatchExecutionResult = executeSingleInstrumentedMatch(leg0Input);
      const leg1Result: SingleMatchExecutionResult = executeSingleInstrumentedMatch(leg1Input);

      const pairResult: WorkerPairResultMessage = {
        type: "PAIR_RESULT",
        taskId,
        pairIndex,
        workerId,
        leg0Result,
        leg1Result,
      };
      parentPort!.postMessage(pairResult);
      return;
    }

    if (msg.type === "TERMINATE") {
      process.exit(0);
    }
  } catch (err: any) {
    const errorMsg: WorkerErrorMessage = {
      type: "ERROR",
      workerId,
      taskId: (msg as any)?.taskId,
      pairIndex: (msg as any)?.pairIndex,
      message: err?.message ?? String(err),
      stack: err?.stack,
    };
    parentPort!.postMessage(errorMsg);
  }
});
