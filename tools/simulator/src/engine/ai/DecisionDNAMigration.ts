import {
  DecisionDNA,
  DecisionDNAMetadata,
} from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { DecisionDNALegacyValidator } from "./DecisionDNALegacyValidator";

export class DecisionDNAMigration {
  public static readonly MIGRATION_RULE = "v5-to-v6-zero-init-v1";

  /**
   * Schema v5 Decision DNA を Schema v6 へ決定論的に移行
   */
  public static migrateV5toV6(dnaV5: Readonly<DecisionDNA>): DecisionDNA {
    // 1. 旧形式の厳格な検証
    DecisionDNALegacyValidator.validateV5(dnaV5);

    const OLD_C_DIM = 163;
    const NEW_C_DIM = 165;
    const P_DIM = 143;

    // 2. Pattern Weights (143次元) は厳密にコピー
    const patternWeights: number[] = new Array<number>(P_DIM);
    for (let j = 0; j < P_DIM; j++) {
      patternWeights[j] = dnaV5.patternWeights[j];
    }

    // 3. Row-major 相互作用行列 (165 x 143 = 23,595次元) の再構築
    const contextPatternWeights: number[] = new Array<number>(NEW_C_DIM * P_DIM);

    // 行 0..162: 旧 v5 の全 23,309 重みを厳密に Row-major コピー
    for (let c = 0; c < OLD_C_DIM; c++) {
      const rowOffset = c * P_DIM;
      for (let p = 0; p < P_DIM; p++) {
        contextPatternWeights[rowOffset + p] = dnaV5.contextPatternWeights[rowOffset + p];
      }
    }

    // 行 163, 164: 新規 2 行 (全 286 要素) を厳密に 0.0 で初期化
    for (let c = OLD_C_DIM; c < NEW_C_DIM; c++) {
      const rowOffset = c * P_DIM;
      for (let p = 0; p < P_DIM; p++) {
        contextPatternWeights[rowOffset + p] = 0.0;
      }
    }

    // 4. メタデータの決定論的複製と移行 Provenance
    let metadata: DecisionDNAMetadata | undefined = undefined;
    if (dnaV5.metadata !== undefined) {
      metadata = {
        ...JSON.parse(JSON.stringify(dnaV5.metadata)),
        migratedFromSchema: 5,
        migrationRule: this.MIGRATION_RULE,
      };
    } else {
      metadata = {
        migratedFromSchema: 5,
        migrationRule: this.MIGRATION_RULE,
      };
    }

    const dnaV6: DecisionDNA = {
      dnaFormatVersion: 1,
      featureSchemaVersion: 6,
      scoringModel: "linear-bilinear-v1",
      contextDimension: NEW_C_DIM,
      patternDimension: P_DIM,
      patternWeights,
      contextPatternWeights,
      metadata,
    };

    // 5. v6 Codec による新形式の完全性検証
    DecisionDNACodec.validate(dnaV6);

    return dnaV6;
  }
}
