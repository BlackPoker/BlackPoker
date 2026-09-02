import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { RandomSource, SeededRandom } from "../random/RandomSource";

/**
 * Policy の識別およびバージョン管理用メタデータ。
 */
export interface PolicyDescriptor {
  /** ポリシーの種別 ("firstLegal", "random", "scripted", "genome" 等) */
  readonly kind: string;
  /** ポリシーのフォーマットバージョン */
  readonly policyVersion: number;
  /** 人間可読なポリシー識別名 */
  readonly name?: string;
  /** 追加メタデータ (seed, パラメータ等) */
  readonly metadata?: Record<string, any>;
}

/**
 * 自動プレイヤー（AI、テストスクリプト、シミュレーション用Policy）の抽象インターフェース。
 * ゲームセッションの DecisionRequest (合法的観測情報) のみを受け取り、妥当な DecisionResponse を返します。
 * ※ 生 GameState へのアクセスは遮断されます。
 */
export interface DecisionPolicy {
  readonly descriptor: PolicyDescriptor;

  /**
   * 同期的に意思決定を実行 (高速シミュレーション・AI Self-Play 用)
   */
  choose(request: Readonly<DecisionRequest>): DecisionResponse;

  /**
   * 非同期的に意思決定を実行 (UI連携・ネットワークAI・非同期Policyとの互換用)
   */
  decide?(request: Readonly<DecisionRequest>): Promise<DecisionResponse>;
}

/**
 * 最初の合法パターン（デフォルトではPASS以外を優先、なければPASS）を選択する基本Policy。
 */
export class FirstLegalPolicy implements DecisionPolicy {
  readonly descriptor: PolicyDescriptor;

  constructor(private readonly preferPass: boolean = false) {
    this.descriptor = {
      kind: "firstLegal",
      policyVersion: 1,
      name: preferPass ? "FirstLegalPolicy(preferPass=true)" : "FirstLegalPolicy",
      metadata: { preferPass },
    };
  }

  choose(request: Readonly<DecisionRequest>): DecisionResponse {
    if (!request.patterns || request.patterns.length === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    let selectedIndex = 0;

    if (this.preferPass) {
      const passIdx = request.patterns.findIndex((p) => p.kind === "PASS");
      selectedIndex = passIdx !== -1 ? passIdx : 0;
    } else {
      const nonPassIdx = request.patterns.findIndex((p) => p.kind !== "PASS");
      selectedIndex = nonPassIdx !== -1 ? nonPassIdx : 0;
    }

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: selectedIndex,
    };
  }

  async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    return this.choose(request);
  }
}

/**
 * Seeded PRNG を用いて決定論的にランダムな合法手を選択する Policy。
 * 同じ seed ならば完全に同一の Decision 列を再現します。
 */
export class RandomPolicy implements DecisionPolicy {
  readonly descriptor: PolicyDescriptor;
  private readonly rng: RandomSource;

  constructor(rngOrSeedOrFn?: RandomSource | number | (() => number), name?: string) {
    if (typeof rngOrSeedOrFn === "number") {
      this.rng = new SeededRandom(rngOrSeedOrFn);
    } else if (typeof rngOrSeedOrFn === "function") {
      const fn = rngOrSeedOrFn;
      this.rng = {
        seed: 0,
        next: fn,
        nextInt: (min: number, max: number) => {
          const r = fn();
          return Math.floor(r * (max - min + 1)) + min;
        },
        choice: <T>(arr: readonly T[]) => (arr.length ? arr[Math.floor(fn() * arr.length)] : undefined),
        fork: () => this.rng,
      };
    } else if (rngOrSeedOrFn) {
      this.rng = rngOrSeedOrFn;
    } else {
      this.rng = new SeededRandom(0);
    }

    this.descriptor = {
      kind: "random",
      policyVersion: 1,
      name: name ?? `RandomPolicy(seed=${this.rng.seed})`,
      metadata: { seed: this.rng.seed },
    };
  }

  choose(request: Readonly<DecisionRequest>): DecisionResponse {
    if (!request.patterns || request.patterns.length === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    const randomIndex = this.rng.nextInt(0, request.patterns.length - 1);
    const clampedIndex = Math.max(0, Math.min(randomIndex, request.patterns.length - 1));

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: clampedIndex,
    };
  }

  async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    return this.choose(request);
  }
}

/**
 * 指定された判断ルール関数（フィルター・セレクター）を適用するスクリプトPolicy。
 */
export class ScriptedPolicy implements DecisionPolicy {
  readonly descriptor: PolicyDescriptor;

  constructor(
    private readonly chooser: (request: Readonly<DecisionRequest>) => number | undefined,
    private readonly fallbackPolicy: DecisionPolicy = new FirstLegalPolicy(),
    name?: string
  ) {
    this.descriptor = {
      kind: "scripted",
      policyVersion: 1,
      name: name ?? "ScriptedPolicy",
    };
  }

  choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const chosenIndex = this.chooser(request);
    if (chosenIndex !== undefined && chosenIndex >= 0 && chosenIndex < request.patterns.length) {
      return {
        decisionId: request.decisionId,
        stateVersion: request.stateVersion,
        selectedPatternRef: chosenIndex,
      };
    }
    return this.fallbackPolicy.choose(request);
  }

  async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    return this.choose(request);
  }
}
