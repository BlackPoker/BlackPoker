import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { AutomatedDecisionRecord } from "../../engine/playtest/HumanVsPolicyController";

/**
 * 意思決定履歴レコード (Transcript v1)
 */
export interface PlaytestDecisionTranscriptEntryV1 {
  readonly seq: number;
  readonly actor: "human" | "policy" | "autoPass";
  readonly playerId: "p1" | "p2";
  readonly decisionId: string;
  readonly stateVersion: number;
  readonly response: {
    readonly decisionId: string;
    readonly stateVersion: number;
    readonly selectedPatternRef: number;
  };
  readonly policy?: {
    readonly kind?: string;
    readonly name?: string;
    readonly policyVersion?: number;
  };
}

/**
 * 単一の意思決定履歴エントリを生成する Pure Function。
 * React MutableRefObject を受け取らず、渡された seq および値のみから不変オブジェクトを生成します。
 */
export function createDecisionTranscriptEntry(
  seq: number,
  params: {
    actor: "human" | "policy" | "autoPass";
    playerId: "p1" | "p2";
    decisionId: string;
    stateVersion: number;
    response: DecisionResponse;
    policy?: {
      kind?: string;
      name?: string;
      policyVersion?: number;
    };
  }
): PlaytestDecisionTranscriptEntryV1 {
  return {
    seq,
    actor: params.actor,
    playerId: params.playerId,
    decisionId: params.decisionId,
    stateVersion: params.stateVersion,
    response: {
      decisionId: params.response.decisionId,
      stateVersion: params.response.stateVersion,
      selectedPatternRef: params.response.selectedPatternRef,
    },
    policy: params.policy
      ? {
          kind: params.policy.kind,
          name: params.policy.name,
          policyVersion: params.policy.policyVersion,
        }
      : undefined,
  };
}

/**
 * advanceAutomatedDecisions が返した AutomatedDecisionRecord 配列から
 * 連続する transcript エントリ群と次シーケンス番号を生成する Pure Function。
 */
export function createAutomatedDecisionTranscriptEntries(
  startSeq: number,
  records: readonly AutomatedDecisionRecord[]
): {
  entries: PlaytestDecisionTranscriptEntryV1[];
  nextSeq: number;
} {
  let currentSeq = startSeq;
  const entries: PlaytestDecisionTranscriptEntryV1[] = [];

  for (const rec of records) {
    const entry = createDecisionTranscriptEntry(currentSeq++, {
      actor: "policy",
      playerId: rec.playerId as "p1" | "p2",
      decisionId: rec.request.decisionId,
      stateVersion: rec.request.stateVersion,
      response: rec.response,
      policy: {
        kind: rec.policyDescriptor.kind,
        name: rec.policyDescriptor.name,
        policyVersion: rec.policyDescriptor.policyVersion,
      },
    });
    entries.push(entry);
  }

  return {
    entries,
    nextSeq: currentSeq,
  };
}
