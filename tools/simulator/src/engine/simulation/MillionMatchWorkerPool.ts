/**
 * BlackPoker Work 4-2 — Million Match Persistent Worker Pool
 *
 * 永続的な Worker Threads を管理し、座席反転ペアの対戦タスクをマルチコア並列実行する。
 * 各 Worker は起動時に RulePackage および Champion Policy を 1 回だけ初期化し、
 * メインスレッドとの間ではプレーンな JSON データのみをやり取りする。
 */

import { Worker } from "worker_threads";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  WorkerInitMessage,
  WorkerRunPairMessage,
  WorkerToMainMessage,
  SerializedChampionsBundle,
} from "../../domain/simulation/MillionMatchWorkerTypes";
import { SingleMatchExecutionResult } from "./MillionMatchCampaignEngine";
import { MatchupPairingSpec } from "../../domain/simulation/MillionMatchInfraTypes";
import { EvolutionIndependentEvaluator } from "../ai/EvolutionIndependentEvaluator";

export interface WorkerPairTask {
  readonly taskId: string;
  readonly campaignId: string;
  readonly workId: string;
  readonly pairIndex: number;
  readonly matchSeed: number;
  readonly playerSeeds: { readonly p1: number; readonly p2: number };
  readonly matchup: MatchupPairingSpec;
  readonly maxDecisionsPerMatch: number;
}

export interface WorkerPairTaskResult {
  readonly pairIndex: number;
  readonly workerId: number;
  readonly leg0Result: SingleMatchExecutionResult;
  readonly leg1Result: SingleMatchExecutionResult;
}

interface WorkerHandle {
  readonly workerId: number;
  readonly worker: Worker;
  busy: boolean;
  currentTaskId: string | null;
  currentPairIndex: number | null;
}

export class MillionMatchWorkerPool {
  private readonly workersCount: number;
  private readonly handles: WorkerHandle[] = [];
  private readonly pendingTaskResolvers = new Map<
    string,
    {
      resolve: (res: WorkerPairTaskResult) => void;
      reject: (err: Error) => void;
    }
  >();
  private readonly taskQueue: {
    task: WorkerPairTask;
    resolve: (res: WorkerPairTaskResult) => void;
    reject: (err: Error) => void;
  }[] = [];
  private isTerminated = false;

  private constructor(workersCount: number) {
    this.workersCount = workersCount;
  }

  /**
   * Worker Pool を生成し、全 Worker の初期化完了を待機して返却する
   */
  public static async create(params: {
    workersCount: number;
    regulationId: string;
    frameId: string;
    rulesDir: string;
    maxDecisionsPerMatch: number;
    champions: SerializedChampionsBundle;
  }): Promise<MillionMatchWorkerPool> {
    const {
      workersCount,
      regulationId,
      frameId,
      rulesDir,
      maxDecisionsPerMatch,
      champions,
    } = params;

    if (![1, 2, 4, 8].includes(workersCount)) {
      throw new Error(
        `[MillionMatchWorkerPool] Invalid workersCount: ${workersCount}. Must be 1, 2, 4, or 8.`
      );
    }

    // メインスレッド側での早期 Champion DNA 真正性バリデーション (Fail-Closed)
    const actualGen7Digest = EvolutionIndependentEvaluator.computeDnaDigest(champions.gen7DNA);
    const actualGen5Digest = EvolutionIndependentEvaluator.computeDnaDigest(champions.gen5DNA);
    const actualZeroDigest = EvolutionIndependentEvaluator.computeDnaDigest(champions.zeroDNA);

    if (actualGen7Digest !== champions.gen7Digest) {
      throw new Error(
        `[MillionMatchWorkerPool] Gen 7 DNA Digest mismatch: expected ${champions.gen7Digest}, computed ${actualGen7Digest}`
      );
    }
    if (actualGen5Digest !== champions.gen5Digest) {
      throw new Error(
        `[MillionMatchWorkerPool] Gen 5 DNA Digest mismatch: expected ${champions.gen5Digest}, computed ${actualGen5Digest}`
      );
    }
    if (actualZeroDigest !== champions.zeroDigest) {
      throw new Error(
        `[MillionMatchWorkerPool] ZeroDNA Digest mismatch: expected ${champions.zeroDigest}, computed ${actualZeroDigest}`
      );
    }

    const pool = new MillionMatchWorkerPool(workersCount);
    const workerScriptPath = path.resolve(__dirname, "MillionMatchWorker.ts");
    const viteNodePath = path.resolve("node_modules/vite-node/vite-node.mjs");

    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < workersCount; i++) {
      const workerId = i;
      const worker = new Worker(viteNodePath, {
        argv: [workerScriptPath],
      });

      const handle: WorkerHandle = {
        workerId,
        worker,
        busy: true, // 初期化中は busy
        currentTaskId: null,
        currentPairIndex: null,
      };
      pool.handles.push(handle);

      const initPromise = new Promise<void>((resolve, reject) => {
        const onInitMessage = (msg: WorkerToMainMessage) => {
          if (msg.type === "INIT_OK" && msg.workerId === workerId) {
            handle.busy = false;
            worker.off("message", onInitMessage);
            worker.off("error", onInitError);
            resolve();
          } else if (msg.type === "ERROR" && msg.workerId === workerId) {
            worker.off("message", onInitMessage);
            worker.off("error", onInitError);
            reject(
              new Error(
                `[MillionMatchWorkerPool] Worker ${workerId} init failed: ${msg.message}`
              )
            );
          }
        };

        const onInitError = (err: Error) => {
          worker.off("message", onInitMessage);
          worker.off("error", onInitError);
          reject(
            new Error(
              `[MillionMatchWorkerPool] Worker ${workerId} process error during init: ${err.message}`
            )
          );
        };

        worker.on("message", onInitMessage);
        worker.on("error", onInitError);

        worker.on("exit", (code) => {
          if (code !== 0 && !pool.isTerminated) {
            const err = new Error(
              `[MillionMatchWorkerPool] Worker ${workerId} exited unexpectedly with code ${code} (pairIndex: ${handle.currentPairIndex})`
            );
            if (handle.currentTaskId && pool.pendingTaskResolvers.has(handle.currentTaskId)) {
              pool.pendingTaskResolvers.get(handle.currentTaskId)!.reject(err);
              pool.pendingTaskResolvers.delete(handle.currentTaskId);
            }
          }
        });

        // 試合実行時のメッセージハンドラ
        worker.on("message", (msg: WorkerToMainMessage) => {
          if (msg.type === "PAIR_RESULT") {
            const resolver = pool.pendingTaskResolvers.get(msg.taskId);
            if (resolver) {
              pool.pendingTaskResolvers.delete(msg.taskId);
              handle.busy = false;
              handle.currentTaskId = null;
              handle.currentPairIndex = null;
              resolver.resolve({
                pairIndex: msg.pairIndex,
                workerId: msg.workerId,
                leg0Result: msg.leg0Result,
                leg1Result: msg.leg1Result,
              });
              pool.dispatchNext();
            }
          } else if (msg.type === "ERROR") {
            if (msg.taskId && pool.pendingTaskResolvers.has(msg.taskId)) {
              const resolver = pool.pendingTaskResolvers.get(msg.taskId)!;
              pool.pendingTaskResolvers.delete(msg.taskId);
              handle.busy = false;
              handle.currentTaskId = null;
              handle.currentPairIndex = null;
              resolver.reject(
                new Error(
                  `[Worker ${msg.workerId} Error] match failure at pairIndex ${msg.pairIndex}: ${msg.message}`
                )
              );
              pool.dispatchNext();
            }
          }
        });

        const initMsg: WorkerInitMessage = {
          type: "INIT",
          workerId,
          regulationId,
          frameId,
          rulesDir,
          maxDecisionsPerMatch,
          champions,
        };
        worker.postMessage(initMsg);
      });

      initPromises.push(initPromise);
    }

    await Promise.all(initPromises);
    return pool;
  }

  /**
   * 座席反転ペア対戦タスクを投入し、結果を Promise で受け取る
   */
  public executePairTask(task: WorkerPairTask): Promise<WorkerPairTaskResult> {
    if (this.isTerminated) {
      return Promise.reject(
        new Error("[MillionMatchWorkerPool] Cannot execute task on terminated pool")
      );
    }

    return new Promise<WorkerPairTaskResult>((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject });
      this.dispatchNext();
    });
  }

  /**
   * 空いている Worker にキュー先頭のタスクをディスパッチする
   */
  private dispatchNext(): void {
    if (this.isTerminated || this.taskQueue.length === 0) {
      return;
    }

    const idleHandle = this.handles.find((h) => !h.busy);
    if (!idleHandle) {
      return;
    }

    const { task, resolve, reject } = this.taskQueue.shift()!;
    idleHandle.busy = true;
    idleHandle.currentTaskId = task.taskId;
    idleHandle.currentPairIndex = task.pairIndex;

    this.pendingTaskResolvers.set(task.taskId, { resolve, reject });

    const msg: WorkerRunPairMessage = {
      type: "RUN_PAIR",
      taskId: task.taskId,
      campaignId: task.campaignId,
      workId: task.workId,
      pairIndex: task.pairIndex,
      matchSeed: task.matchSeed,
      playerSeeds: task.playerSeeds,
      matchup: task.matchup,
      maxDecisionsPerMatch: task.maxDecisionsPerMatch,
    };

    idleHandle.worker.postMessage(msg);
  }

  /**
   * 実行中タスクの件数（キュー内 + スレッド実行中）
   */
  public get inFlightTasksCount(): number {
    return this.taskQueue.length + this.handles.filter((h) => h.busy).length;
  }

  /**
   * すべての Worker を安全に終了する
   */
  public async terminate(): Promise<void> {
    if (this.isTerminated) {
      return;
    }
    this.isTerminated = true;

    // キューに残っている未開始タスクをキャンセル
    while (this.taskQueue.length > 0) {
      const { reject } = this.taskQueue.shift()!;
      reject(new Error("[MillionMatchWorkerPool] Task cancelled due to pool termination"));
    }

    const terminatePromises = this.handles.map(async (h) => {
      try {
        h.worker.postMessage({ type: "TERMINATE" });
      } catch {}
      await h.worker.terminate();
    });

    await Promise.all(terminatePromises);
    this.handles.length = 0;
  }
}
