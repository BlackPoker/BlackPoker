import { DecisionPolicy, PolicyDescriptor } from "../simulation/DecisionPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder";
import { GenomeScorer } from "./GenomeScorer";

/**
 * Decision DNA v1 の線形＋相互作用重み付けに基づいて決定論的に最善手を選択する Policy。
 *
 * 【DecisionPolicy 準拠】
 * - 入力境界: Readonly<DecisionRequest> のみを受け取り、生の GameState や GameSession へアクセスしません。
 * - 決定論的 Argmax: 厳格な argmax (score > bestScore) を採用。
 * - タイブレーク: スコアが完全同点の場合は最小の patternRef (先に現れた手) を決定論的に選択。
 * - 乱数非依存: RNG や Date.now を一切使用せず、同一 DNA + 同一 Request で完全同一の Response を返します。
 * - 隔離性: コンストラクタで渡された DNA は内部でディープコピーされ、呼び出し元の変更から保護されます。
 * - 軽量 Descriptor: 1482個の全重みは PolicyDescriptor.metadata に含めず、識別情報のみを保持します。
 */
export class GenomePolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  private readonly dna: DecisionDNA;

  constructor(dna: Readonly<DecisionDNA>, name?: string) {
    DecisionDNACodec.validate(dna);
    this.dna = DecisionDNACodec.clone(dna);

    this.descriptor = {
      kind: "genome",
      policyVersion: 1,
      name: name ?? this.dna.metadata?.name ?? "GenomePolicy",
      metadata: {
        dnaFormatVersion: this.dna.dnaFormatVersion,
        featureSchemaVersion: this.dna.featureSchemaVersion,
        scoringModel: this.dna.scoringModel,
        dnaId: this.dna.metadata?.id,
        dnaName: this.dna.metadata?.name,
      },
    };
  }

  /**
   * 同期的に意思決定を実行
   */
  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const patterns = request.patterns;
    if (!patterns || patterns.length === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    // 1. 合法的観測情報から特徴量ベクトルをエンコード
    const encodedFeatures = DecisionFeatureEncoder.encode(request);

    // 2. GenomeScorer で全合法パターンのスコアを計算
    const scoredPatterns = GenomeScorer.score(encodedFeatures, this.dna);

    // 3. 決定論的 Argmax (タイブレーク: 最小 patternRef 優先)
    let bestScore = -Infinity;
    let bestPatternRef = scoredPatterns[0].patternRef;

    for (let i = 0; i < scoredPatterns.length; i++) {
      const p = scoredPatterns[i];
      if (p.score > bestScore) {
        bestScore = p.score;
        bestPatternRef = p.patternRef;
      }
    }

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: bestPatternRef,
    };
  }

  /**
   * 非同期インターフェース (DecisionPolicy 互換)
   */
  public async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    return this.choose(request);
  }

  /**
   * 保持している DNA のコピーを取得
   */
  public getDNA(): DecisionDNA {
    return DecisionDNACodec.clone(this.dna);
  }
}
