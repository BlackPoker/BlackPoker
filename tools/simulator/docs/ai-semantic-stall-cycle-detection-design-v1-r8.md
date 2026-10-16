# BlackPoker Simulator
# Semantic Stall / Cycle Detection Diagnostic Architecture Design V1-R8

## 1. Document Identity
- **Work ID**: `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R8`
- **Document Version**: `1.8.0`
- **Status**: `DESIGNED / PENDING INDEPENDENT REVIEW`
- **Supersedes**: `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R7` (Commit: `fec61f3b449d87833768e90cdb5405f6b82801ba`, NOT ACCEPTED / R8 REQUIRED)
- **Target Component**: BlackPoker Simulator (`tools/simulator/`)
- **Category**: AI Self-Play / Diagnostic Architecture Specification (DESIGN ONLY)
- **Author**: BlackPoker Simulator AI Diagnostics & Core Flow Architecture Team

---

## 2. Formal Baseline
本設計書 (V1-R8) は、以下の正式採択コミットおよび過去の証拠を不変の前提ベースラインとして策定されています：

1. **Feature Scaling Design V1-R2**:
   - Status: `FORMAL ACCEPTED`
   - Commit SHA: `4c9f8c273d9c2bd8068173dd1333bcc55547668a`
2. **Feature Scaling Implementation V1-R2**:
   - Status: `FORMAL ACCEPTED`
   - Commit SHA: `975788f80054f4e5a08e446ee9967d400726bca9`
3. **Controlled Feature Scaling A/B Evidence V1-R1**:
   - Status: `FORMAL ACCEPTED`
   - Commit SHA: `97d2ac1fa2db79f459c75e4f1fd19486125d1ef6`
4. **Semantic Stall / Cycle Detection Design V1**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R1`
   - Commit SHA: `6ab04120fb3cfc9dccf4cf04f9c824e091af374d`
5. **Semantic Stall / Cycle Detection Design V1-R1**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R2`
   - Commit SHA: `81433f8e5cdcec44bcffca51ce476f0d2e1b8fbe`
6. **Semantic Stall / Cycle Detection Design V1-R2**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R3`
   - Commit SHA: `14de5ffd567a099b27ec7c23389741d2859e2491`
7. **Semantic Stall / Cycle Detection Design V1-R3**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R4`
   - Commit SHA: `e96a6bef80492b62eb86935096658604bdc4ba09`
8. **Semantic Stall / Cycle Detection Design V1-R4**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R5`
   - Commit SHA: `a697ee02d23e239ff9fffffbad9d8a4a7464ff80`
9. **Semantic Stall / Cycle Detection Design V1-R5**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R6`
   - Commit SHA: `34e773a01aed53a6c76806d0332b10754e0a4ec2`
10. **Semantic Stall / Cycle Detection Design V1-R6**:
    - Status: `NOT ACCEPTED / SUPERSEDED BY R7`
    - Commit SHA: `c7306755d42a68c859ef084826451f6f0189ea9e`
11. **Semantic Stall / Cycle Detection Design V1-R7**:
    - Status: `NOT ACCEPTED / SUPERSEDED BY R8`
    - Commit SHA: `fec61f3b449d87833768e90cdb5405f6b82801ba`
12. **Start Commit HEAD**: `fec61f3b449d87833768e90cdb5405f6b82801ba`
13. **Branch**: `BlackPoker/issue551-core-flow`
14. **Rules / Core Flow Status**: `RULES UNCHANGED / NO CHANGE PLANNED` (0 diff contract)

---

## 3. V1-R7 Review Findings & R8 Remediation
V1-R7 設計（SHA: `fec61f3b449d87833768e90cdb5405f6b82801ba`）の Independent Review において指摘された 3 点のブロッカーおよび解消内容は以下の通りです：

1. **Blocker A: Registry `state.turnCount` Rationale の修正**:
   - **問題点**: R7 Registry の `state.turnCount` に「ターンをまたぐ同一盤面停滞（マルチターン・パスループ）」という不正確な rationale が残存していた。Current BlackPoker Core Flow では PASS 単体ではターンは絶対に進行しないため、「マルチターン・パスループ」という表現は誤りである。
   - **R8 是正**:
     - `state.turnCount` の classification、fingerprint flags、source evidence は一切変更せず、`rationale` のみを正確な意味論へ改訂：
       - **Variant S1 (Turn-Aware)**: `turnCount` を含み、同一ターン内の厳密な状態を比較する。
       - **Variant S2 (Turn-Invariant)**: `turnCount` を除外し、End 等により実際にターンが進行した後に複数ターンにまたがってその他の semantic gameplay state が周期的に再訪する候補を検知する。
       - S2 は「PASS でターンが進むケース」のためではないことを明記。
     - R7 $\rightarrow$ R8 レジストリ差分は、メタデータヘッダーと `state.turnCount.rationale` の 1 箇所のみ（その他の全 139 エントリは 100% ディープイコール）に厳格限定。

2. **Blocker B: End Lifecycle の厳密な Core Flow 整合と「End = semantic no-op」モデルの完全撤回**:
   - **問題点**: R7 設計書の一部に「双方が毎ターン action.end を選び、手番と turnCount だけが進み、盤面が進展しない」という仮定（End を盤面変化のない no-op とみなす誤ったモデル）が含まれていた。
   - **実コード監査による End の真のライフサイクル**:
     - `action.end` は即時実行される特殊コマンドではなく、**Normal Action**（通常アクション）である。選択直後にはターンは変わらない。
     - 実際の詳細な進行ステップ：
       1. 手番プレイヤー（P1）が `action.end` を選択
       2. End Request が Stage 最上段へ積載される（`stage.requests[0].actionId === "action.end"`）
       3. チャンスは引き続き P1 が維持する（選択直後の自動ターン終了はない）
       4. P1 が PASS を選択 $\rightarrow$ チャンスが P2 へ渡る
       5. P2 も PASS を選択 $\rightarrow$ `consecutivePassCount === 2`（2-PASS 成立）
       6. Stage TOP の `action.end` が解決される
       7. 終了時処理としてディスカード判定およびフォグの墓地送還（`cleanupFogs`）が実行される
       8. `TurnManager.endTurn` $\rightarrow$ `TurnManager.startTurn` が呼び出され、`turnPlayer` が P2 へ交代し、**`turnCount` が +1** される
       9. 新ターン開始に伴う誘発処理が実行される
       10. ターン開始時チャージ（`action.charge`）は即時誘発（immediate）として直接解決され、**P2 ユニットの状態が charge へ変化**する
       11. ターン開始時ドロー（`action.draw`）が Stage へ積載される（`stage.requests[0].actionId === "action.draw"`）
       12. ドロー解決のためにさらなるチャンス所持プレイヤーの判断および PASS サイクル（P2 PASS $\rightarrow$ P1 PASS）が発生する
       13. 2-PASS 成立によりドローが解決され、**P2 のライフから手札へカードが 2 枚移動**する
       14. 解決後、チャンスが手番プレイヤー（P2）へ返却される
     - したがって、**`End` は決して semantic no-op ではない**。End の解決と新ターン開始により、ユニット状態（charge）やリソース（Life $\rightarrow$ Hand）が実際に更新される。
   - **R8 是正**:
     - 「End 連打による no-op ターン進行」という誤ったモデルを完全撤回。
     - S2（Turn-Invariant）の用途を「End $\rightarrow$ Charge $\rightarrow$ Draw の一連のライフサイクルを経た後、turnCount の差を無視したときに、その他の semantic gameplay state が周期的に再訪しているかを観測する診断候補」に厳密限定。

3. **Blocker C: 全フィンガープリントの Canonical Sampling Point の単一化 (`PRE_DECISION`)**:
   - **問題点**: R7 では事前状態観測（Pre-Decision）と事後状態観測（Post-Decision）のタイミング境界が曖昧であり、異なるフィンガープリントが異なる時点で採取される余地を残していた。
   - **R8 是正**:
     - 全 recurrence diagnostic fingerprint（`sgf1`, `sgf1-ti`, `pof1`, `drsf1`, `gpif1`）の採取タイミングを、**単一の Canonical Sampling Point** に完全統一：
       - 採取点: `SimulationRunner.run` ループ内において、`const step = session.advance()` が **`WAITING_FOR_DECISION`** を返した直後、**`policy.choose(step.request)` を呼び出す直前**。
       - この時点を **`PRE_DECISION / DECISION_BOUNDARY`** と定義する。
     - これら 5 つのフィンガープリントは、同一 `stepIndex` において**必ず 100% 同一時点**を表す。
     - その後、`response = policy.choose(step.request)` によって得られた手（`selectedPatternRef`, `selectedPatternKind`, `actionId`, `logicalPatternKey` 等）は、直前の `PRE_DECISION` スナップショットに対する **decision result metadata** として関連付ける。これによりフィンガープリントの時間境界は一切変化しない。
     - `session.submitDecision(response)` 後の盤面は、次に `SimulationRunner` ループで `WAITING_FOR_DECISION` に到達した時点で**次の Canonical Snapshot** として観測する。診断目的で余分な `session.advance()` を呼び出すことは厳禁とする。

---

## 4. Problem Statement
Formal Accepted となった `BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1-R1` において、Feature Scaling は特徴量および相互作用重みを有界化し、PASS スコアマージンを大幅に圧縮（+1.565003 $\rightarrow$ +0.052248）したものの、Controlled N=6 g1 集団における全体完了率は以下の通り不変でした：

- **CONTROL (RAW_V4_EQUIVALENT)**: 2 / 30 Completed (28 Incomplete at `maxDecisions = 500`)
- **TREATMENT (SCALED_V5)**: 2 / 30 Completed (28 Incomplete at `maxDecisions = 500`)

この残存 28 Incomplete 対戦について、以下の疑問が存在します：
1. **Semantic Stall**: 盤面・効果・手札が何一つ進展しないまま、空の PASS 等が連続しているのか？
2. **Periodic Cycle**: プレイヤー双方が同一または周期的な盤面・判断文脈を行き来するループに陥っているのか？
3. **Genuine Progress**: 状態は健全に進展しているものの、500 回の決定上限が単に短いだけなのか？
4. **Bookkeeping Artifact**: 内部シーケンス番号（`sequence`, `stateVersion`）のみが進んで「異なる状態」と見誤っていないか？

本設計は、既存エンジン・ルール・ポリシーに一切の副作用を与えることなく、これらを数学的決定性をもって受動的に観測・診断するための仕様を確定します。

---

## 5. Explicit Non-Claims
本設計および将来の診断実装において、以下を **明示的に主張しない (Explicit Non-Claims)** ことを厳格に規定します：

1. **Cycle Proven: NO** — フィンガープリントの一致・再訪のみをもって「無限ループ」「決定論的サイクル」「デッドロック」が証明されたとは主張しない。
2. **Infinite Loop Proven: NO** — 将来の外部入力、未観測の PRNG 分岐、ポリシータイブレークの揺らぎによりループを脱出する可能性を排除しない。
3. **Continuation Equivalence Proven: NO** — 観測可能な全フィンガープリントが一致しても、将来の同一軌跡が数学的に保証されたとは主張しない。
4. **Rules Bug Proven: NO** — インコンプリート対戦の発生をもってルール実装のバグと即断しない。
5. **Policy Cause Proven: NO** — 診断シグナルのみをもって特定のゲノム遺伝子座の欠陥と即断しない。
6. **Mutation Cause Proven: NO** — 遺伝的突然変異や交叉が停滞を引き起こした直接要因であると即断しない。
7. **Performance Improvement Proven: NO** — 診断機能の導入がシミュレーション速度やメモリ効率を向上させるとは主張しない。
8. **Multi-Generation Proven: NO** — N=6 g1 の結果をもって、多世代進化学習全体の収束性を証明したとは主張しない。
9. **End Loop Proven: NO** — S2 の一致をもって、通常プレイにおいて「ターンだけが進む無限ループ」が存在すると証明されたとは主張しない。

---

## 6. Existing StateHasher Exact Guarantee
既存の `StateHasher.ts` (State Hash v2) の厳密な保証範囲および非保証境界を以下のように固定します：

### 6.1 等価性が意味すること (What Equality Means)
- `StateHasher.hash(state)` の一致は、**「StateHasher v2 によって抽出された正規論理 GameState 射影 (Canonical Logical GameState Projection) をシリアライズした文字列の FNV-1a 64-bit ハッシュ値が一致すること」** のみを意味する。
- 抽出対象には、`presetId`, `turnCount`, `turnPlayer`, `chancePlayer`, `turnUsage`, `stateVersion`, `nextRequestSeq`, 正規化されたプレイヤーゾーン（手札、ライフ、フィールド、墓地、フォグ、切札）、ステージリクエスト、バッファリクエスト、墓地トップ選択が含まれる。

### 6.2 等価性が意味しないこと (What It Does NOT Mean)
1. **`same StateHash != same complete GameSession memory`**: `GameSession` のサイドステート（`passTracker.consecutivePassCount`, `resolvingRequest`, `resolvingContext`, `continuation`, `matchSeed` 等）は含まれていない。
2. **`same StateHash != Continuation Equivalence`**: 将来のゲーム進行が同一であることを保証しない。
3. **`same StateHash != cryptographic proof of identical state`**: FNV-1a 64-bit はコンパクトな非暗号学的ハッシュであり、衝突耐性の暗号学的証明ではない。
4. **`different StateHash != semantic gameplay progress`**: プレイヤーが何ら盤面を動かさず連続 PASS した場合でも、`stateVersion` や `nextRequestSeq` がインクリメントされるため StateHash は変化する。したがって、ハッシュ値の変化はゲームの意味論的進展を証明しない。

### 6.3 StateHasher の役割固定
既存の `StateHasher.ts` は Replay/Consistency の健全性検査シグナルとして一切変更せず（0 diff）、新しい診断機能の土台や置換対象として使用しない。

---

## 7. SimulationRunner Audit & Canonical Sampling Boundary
`SimulationRunner.ts` における対戦実行ループおよび `GameSession.ts` の実 API 契約を監査し、Canonical Sampling Point を確定しました：

### 7.1 実 API 契約
- **エントリーポイント**:
  ```typescript
  SimulationRunner.run(
    session: GameSession,
    policies: Record<string, DecisionPolicy>,
    options?: SimulationOptions
  ): SimulationResult
  ```
  - `SimulationRunner` は自ら `GameSession` をインスタンス化せず、引数として受け取る。
- **対戦ループ構造と Canonical Sampling Point**:
  ```typescript
  while (totalDecisions < maxDecisions) {
    const step = session.advance();

    if (step.type === "FINISHED") {
      return {
        completed: true,
        totalDecisions,
        turnCount: session.state.turnCount || 1,
        winner: step.result.winner,
        reason: step.result.reason,
        finalState: session.state,
        decisionTraceVersion: 2,
        decisionTrace,
        finalStateHash,
        matchLog: session.getMatchLog ? session.getMatchLog() : undefined,
      };
    }

    if (step.type === "WAITING_FOR_DECISION") {
      // =======================================================================
      // ★ CANONICAL DECISION SNAPSHOT (PRE_DECISION / DECISION_BOUNDARY) ★
      // この唯一の時点で、全 5 つの Fingerprint を一括採取する:
      //   - sgf1     : Structural Gameplay Fingerprint (Variant S1, Turn-Aware)
      //   - sgf1-ti  : Structural Gameplay Fingerprint (Variant S2, Turn-Invariant)
      //   - pof1     : Player Observation Fingerprint
      //   - drsf1    : Decision Request Semantic Fingerprint
      //   - gpif1    : Genome Policy Input Fingerprint
      // =======================================================================

      const playerId = step.request.playerId as PlayerKey;
      const policy = policies[playerId];

      // 意思決定の取得
      const response = policy.choose(step.request);
      totalDecisions++;

      // 意思決定結果メタデータ（selectedPatternRef, logicalPatternKey 等）を
      // 直前の PRE_DECISION スナップショットに関連付ける（時間境界は変えない）

      // 意思決定の適用
      session.submitDecision(response);

      // ※ submitDecision 後の状態は、次回ループの advance() で
      //   WAITING_FOR_DECISION に達した際に次の PRE_DECISION として観測する。
      //   診断目的で余分な session.advance() を呼ぶことは厳禁。
    }
  }

  return {
    completed: false,
    totalDecisions,
    turnCount: session.state.turnCount || 1,
    reason: `最大判断回数 (${maxDecisions}) に到達しました。`,
    finalState: session.state,
    decisionTraceVersion: 2,
    decisionTrace,
    finalStateHash,
    matchLog: session.getMatchLog ? session.getMatchLog() : undefined,
  };
  ```

### 7.2 意思決定適用 API
- `GameSession` の公開メソッドは `session.submitDecision(response)` である（`applyDecision` は存在しない）。

### 7.3 戻り値ステータス契約
- `SimulationResult` において、未完了対戦は `completed: false`（真偽値フラグ）として表現される。リテラルの `"INCOMPLETE"` 列挙値は `SimulationResult` には存在せず、上位の BatchRunner や GenerationRunner がこの結果を受け取って対戦ステータス `INCOMPLETE` を記録する。

### 7.4 診断 Observer 統合境界 (Passive Zero Mutation)
1. **PRE_DECISION 単一サンプリング**:
   - `sgf1`, `sgf1-ti`, `pof1`, `drsf1`, `gpif1` の 5 つのフィンガープリントは同一の `PRE_DECISION` 境界において同時に採取される。
2. **副作用完全遮断**:
   - 診断 Observer は、対戦ループの終了条件、勝敗判定、意思決定、PRNG シード消費、`session.state` のプロパティに一切の変更（Mutation）を与えない。
   - 余分な `session.advance()` を呼び出さない。

---

## 8. Core Flow PASS vs End Semantics Audit
BlackPoker コアフローにおける PASS、2-PASS、ステージ解決、および明示的ターン終了（`action.end`）の真のライフサイクルを厳密に整理します：

### 8.1 動作比較マトリクス
| 事象 / アクション | 実行条件 | チャンス遷移 | ターン・turnCount | ステージ・効果の解決 | PassTracker |
|:---|:---|:---|:---|:---|:---|
| **単一 PASS** | チャンス所持プレイヤー | 相手プレイヤーへ譲渡 (`nextChance`) | **不変** (ターン継続) | なし | `consecutivePassCount += 1` |
| **2-PASS (ステージ空)** | `isAllPassed(2)` 成立 かつ `stage.requests.length === 0` | 手番プレイヤー `turnPlayer` へ返却 | **不変** (ターン継続, `turnCount` 増加なし) | なし | `reset()` (`consecutivePassCount = 0`) |
| **2-PASS (ステージ非空)** | `isAllPassed(2)` 成立 かつ `stage.requests.length > 0` | 解決完了後、手番プレイヤー `turnPlayer` へ返却 | **不変** (ターン継続, `turnCount` 増加なし) | ステージ最上段 (最新) の 1 リクエストのみ解決 | `reset()` (`consecutivePassCount = 0`) |
| **End アクション積載** | 手番プレイヤー かつ チャンス所持 かつ `stage.requests.length === 0` | チャンスは手番プレイヤーが維持 | **不変** (ターン継続) | Stage 最上段に `action.end` が積載される | `reset()` (`consecutivePassCount = 0`) |
| **End アクション解決** | `action.end` が Stage 最上段にある状態で 2-PASS 成立 | 新手番プレイヤー (相手) へ設定 | **交代** (`turnPlayer` 交代, **`turnCount += 1`**) | フォグ墓地送還 $\rightarrow$ Charge 即時解決 $\rightarrow$ Draw Stage 積載 | `reset()` (`consecutivePassCount = 0`) |

### 8.2 End アクションの真のライフサイクル (End is NOT a semantic no-op)
`action.end` の完全な解決シーケンス：
1. **リクエスト**: 手番プレイヤー（P1）が `action.end` を選択。これは Normal Action であり、Stage に積まれる。チャンスは P1 のまま。
2. **PASS サイクル**: P1 が PASS $\rightarrow$ チャンスが P2 へ $\rightarrow$ P2 が PASS $\rightarrow$ 2-PASS 成立。
3. **End 解決**: Stage TOP の `action.end` が解決され、`cleanupFogs` により全フォグが墓地へ送還される。
4. **ターン交代**: `TurnManager.endTurn` $\rightarrow$ `TurnManager.startTurn` により、`turnPlayer` が P2 へ交代し、**`turnCount` が +1** される。
5. **新ターン誘発 (Charge)**: ターン開始時チャージが即時誘発（immediate）として直接解決され、**P2 ユニットの状態が charge へ変化**する。
6. **新ターン誘発 (Draw)**: ターン開始時ドローが Stage へ積載される。
7. **Draw PASS サイクル**: P2 が PASS $\rightarrow$ P1 が PASS $\rightarrow$ 2-PASS 成立。
8. **Draw 解決**: ドローが解決され、**P2 のライフから手札へカードが 2 枚移動**する。
9. **メイン準備完了**: チャンスが手番プレイヤー（P2）に戻る。

したがって、`End` の実行は盤面状態（フォグ、ユニットチャージ状態、ライフ枚数、手札枚数）を確実に変化させるため、**`End = semantic no-op` とみなすモデルは成立しない**。

---

## 9. GameSession Side-State Audit
`GameSession.ts` の徹底監査により、GameState 外に保持されている以下の意味論的サイドステートを特定しました：

1. `session.passTracker.consecutivePassCount`:
   - 連続パス回数カウンタ。2 回連続パスでステージトップ解決またはチャンス返却を行う重要決定要因。GameState には存在しないため、Structural Fingerprint に必須。
2. `session.resolvingRequest`:
   - 現在解決中のリクエストのコピー。効果解決時判断の親リクエスト情報。
3. `session.resolvingContext`:
   - 効果解決コンテキスト（playerKey, keyCards, targetComponent, targetRequest, selections）。
4. `session.continuation`:
   - 複数ステップ効果（EffectContinuation）の中間状態・残余ステップ。
5. `session.pendingDecision`:
   - 現在回答待ちの DecisionRequest 参照。Current DecisionRequest と同一実体。
6. `session.matchSeed`:
   - 対戦の基底乱数シード。
7. `session.matchStartedRecorded` / `session.lastRecordedTurnPlayer`:
   - ログ記録器の内部フラグ・キャッシュ。Bookkeeping として除外。

---

## 10. Structural Gameplay Fingerprint Specification
- **プレフィックス**: `sgf1-<64 hex>`
- **目的**: 内部管理カウンタ（`stateVersion`, `nextRequestSeq`, `decisionId`）を除外した、ルール上の意味的ゲーム盤面・状況の再訪候補検知。
- **対象ソース**: `GameState` + `GameSession` 意味的サイドステート（`consecutivePassCount`, `continuation`, `resolvingRequest`, `resolvingContext`）。
- **サンプリング点**: `PRE_DECISION`（`WAITING_FOR_DECISION` 到達時）。
- **バリアント構成と検知役割**:
  - **Variant S1 (Turn-Aware)**:
    - `turnCount` を含み、同一ターン内またはターン進行を伴う厳密なゲーム状態を比較する。
    - **検知能力の理論的根拠**: ステージ空の連続 PASS ループにおいて、ターンは交代せず `turnCount` は不変である。したがって、動的 ID や `stateVersion` を抽象化した Variant S1 は、**同一ターン内で発生する空ステージ PASS ループ停滞を確実に検知する**。
  - **Variant S2 (Turn-Invariant)**:
    - `turnCount` を意図的に除外してハッシュを算出する。
    - **厳密な用途規定**: **「実際にターンが進行した後、turnCount 差を無視したときに、その他の semantic gameplay state（手札、ライフ、フィールド、墓地、フォグ、turnPlayer、chancePlayer 等）が周期的に再訪しているかを見る診断候補」**。
    - **非主張境界**:
      - S2 は「End ループの証明」でも「無限ループの証明」でもない。
      - 通常の BlackPoker において「End を連打するだけで盤面が一切変化しない」という人工的挙動を仮定しない。
      - 実際の End $\rightarrow$ Charge $\rightarrow$ Draw ライフサイクルを経た上で、ゲームプレイ状態が可逆的・周期的に再訪した場合にのみ S2 再訪シグナルが出力される。
- **非保証境界**: `same Structural Fingerprint != same future`（将来の同一分岐を保証しない）。

---

## 11. Player Observation Fingerprint Specification
- **プレフィックス**: `pof1-<64 hex>`
- **目的**: 特定の Viewer（`request.playerId`）から合法的に観測可能な情報の等価性判定。
- **対象ソース**: `Readonly<PlayerObservation>`。
- **サンプリング点**: `PRE_DECISION`。
- **秘匿性保護**: 相手の伏せ手札、伏せ防壁、10枚以上の正確なライフ枚数、未開封パック中身等の秘密情報は完全に排除されている。
- **非保証境界**: `same Observation Fingerprint != same Full State`（相手の隠蔽情報が異なる可能性がある）。

---

## 12. Decision Request Root Type Audit
`DecisionRequest.ts` の全 9 個のルートフィールドを監査しました：

| フィールド名 | 型 | declaringType | 分類 | 根拠 |
|:---|:---|:---|:---:|:---|
| `protocolVersion` | `string` | `DecisionRequest` | `INCLUDE` | 通信・インターフェース互換性を識別する重要メタデータ。 |
| `matchId` | `string` | `DecisionRequest` | `EXCLUDE_BOOKKEEPING` | マッチインスタンスID。マッチ間比較を阻害するため除外。 |
| `decisionId` | `string` | `DecisionRequest` | `EXCLUDE_BOOKKEEPING` | 判断要求発番UUID/連番。決定文脈そのものには無関係。 |
| `stateVersion` | `number` | `DecisionRequest` | `EXCLUDE_BOOKKEEPING` | 盤面バージョンカウンタ。楽観的ロック用であり除外。 |
| `playerId` | `PlayerKey` | `DecisionRequest` | `INCLUDE` | 判断を行うプレイヤー（Viewer基準）。特徴量の全相関基準。 |
| `source` | `DecisionSource` | `DecisionRequest` | `INCLUDE` | 判断の起因理由（ACTION_REQUEST, EFFECT_RESOLUTION等）。 |
| `observation` | `PlayerObservation` | `DecisionRequest` | `INCLUDE` | 合法的観測モデル。 |
| `catalog` | `DecisionCatalog` | `DecisionRequest` | `INCLUDE` | パターン群から共有参照される実体カタログ。 |
| `patterns` | `readonly LegalPattern[]` | `DecisionRequest` | `INCLUDE` | 現在選べる合法パターン配列。順序保持必須。 |

---

## 13. LegalPattern Type Audit
`LegalPattern.ts` の全フィールドおよび 7 つのインデックス参照を監査しました：

1. `patternId: string` — **`EXCLUDE_BOOKKEEPING`** (`declaringType: "LegalPattern"`): デバッグ・リプレイ用文字列であり、`DecisionFeatureEncoder` および `GenomeScorer` には一切入力されない。
2. `kind: LegalPatternKind` — **`INCLUDE`** (`declaringType: "LegalPattern"`): パターン種別（ACTION, PASS, EFFECT_SELECTION）。Pattern Feature (0..3) に直結。
3. `actionSelectionRef?: ActionSelectionRef` — **`INCLUDE`** (`declaringType: "LegalPattern"`): `catalog.actions` への参照。
4. `keyCardSelectionRef?: CardSelectionRef` — **`INCLUDE`** (`declaringType: "LegalPattern"`): `catalog.cardSelections` への参照。
5. `keyUnitSelectionRef?: UnitSelectionRef` — **`INCLUDE`** (`declaringType: "LegalPattern"`): `catalog.unitSelections` への参照。
6. `costPaymentRef?: CostPaymentRef` — **`INCLUDE`** (`declaringType: "LegalPattern"`): `catalog.costPayments` への参照。
7. `targetSelectionRef?: TargetSelectionRef` — **`INCLUDE`** (`declaringType: "LegalPattern"`): `catalog.targetSelections` への参照。
8. `effectSelectionRef?: EffectSelectionRef` — **`INCLUDE`** (`declaringType: "LegalPattern"`): `catalog.effectSelections` への参照。
9. `orderSelectionRef?: OrderSelectionRef` — **`INCLUDE`** (`declaringType: "LegalPattern"`): `catalog.orderSelections` への参照。

**重要原則**: Ref 番号単体での等価性判定を厳格に禁止し、必ず参照先の実体データと紐づけて評価する。

---

## 14. DecisionCatalog Type Audit
`DecisionCatalog.ts` の全コレクションおよびプロパティを型ごとに監査しました：

1. `DecisionCatalog`:
   - `actions`, `cardSelections`, `unitSelections`, `costPayments`, `targetSelections`, `effectSelections`, `orderSelections` (`declaringType: "DecisionCatalog"`, `INCLUDE`)。
2. `ActionSelection`:
   - `actionId`, `speed`, `timing`, `cost` (`declaringType: "ActionSelection"`, `INCLUDE`)。
   - `actionName` (`declaringType: "ActionSelection"`, `EXCLUDE_BOOKKEEPING`, 表示用)。
3. `CardSelection`:
   - `cardIds` (`declaringType: "CardSelection"`, `INCLUDE`)。
   - `displayCodes` (`declaringType: "CardSelection"`, `EXCLUDE_BOOKKEEPING`, 表示用)。
4. `UnitSelection`:
   - `unitIds` (`declaringType: "UnitSelection"`, `INCLUDE`)。
   - `displayNames` (`declaringType: "UnitSelection"`, `EXCLUDE_BOOKKEEPING`, 表示用)。
5. `CostPayment`:
   - `discardedCardIds`, `drivenBulwarkUnitIds`, `sacrificedUnitIds`, `lifeCount` (`declaringType: "CostPayment"`, `INCLUDE`)。
   - `summary` (`declaringType: "CostPayment"`, `EXCLUDE_BOOKKEEPING`, 表示用)。
6. `TargetSelection`:
   - `targetType`, `targetPlayerKey`, `targetUnitId`, `targetRequestId`, `targetDefinitionId` (`declaringType: "TargetSelection"`, `INCLUDE`)。
   - `displayName`, `primaryLabel`, `secondaryLabel` (`declaringType: "TargetSelection"`, `EXCLUDE_BOOKKEEPING`, 表示用)。
7. `EffectSelection`:
   - `selectionType`, `selectedValues`, `assignments`, `targetSelection`, `candidateCount`, `cards` (`declaringType: "EffectSelection"`, `INCLUDE`)。
   - `summary` (`declaringType: "EffectSelection"`, `EXCLUDE_BOOKKEEPING`, 表示用)。
8. `OrderSelection`:
   - `orderedIds` (`declaringType: "OrderSelection"`, `INCLUDE`)。
   - `summary` (`declaringType: "OrderSelection"`, `EXCLUDE_BOOKKEEPING`, 表示用)。

---

## 15. Decision Request Semantic Fingerprint Specification
- **プレフィックス**: `drsf1-<64 hex>`
- **目的**: 現在提示された判断要求（`DecisionRequest`）が表す合法な状況の意味論的等価性判定。
- **サンプリング点**: `PRE_DECISION`。
- **構成要素**:
  - `protocolVersion`
  - `playerId`
  - `source`
  - `observation`（サニタイズされた観測情報）
  - 順序を保持した `patterns` 配列
  - 各 `pattern` から参照される `catalog` の解決済み意味的コンテンツ（`actionId`, `speed`, `timing`, `cardIds`, `unitIds`, `costPayment`, `targetSelection`, `effectSelection`, `orderSelection`）
- **除外要素**: `matchId`, `decisionId`, `stateVersion`, `patternId`, 各種表示用文字列（`actionName`, `displayName`, `primaryLabel`, `secondaryLabel`, `summary` 等）。

---

## 16. Genome Policy Input Fingerprint Specification
- **プレフィックス**: `gpif1-<64 hex>`
- **目的**: 現在の `GenomePolicy` に入力され、`GenomeScorer` が受け取る数値特徴量入力が同一であることの判定。
- **サンプリング点**: `PRE_DECISION`。
- **入力ソース**: `DecisionFeatureEncoder.encode(request)` の出力から抽出された `GenomePolicyScoringInputProjection`。
- **厳格な非丸め原則 (No Lossy Rounding)**:
  - 小数点以下固定桁丸め（`toFixed(6)` 等）や epsilon 量子化を厳格に禁止。
  - IEEE 754 浮動小数点を完全な精度でシリアライズする（`-0` は `0` に正規化）。
  - `NaN` または `Infinity` が検出された場合は fail-closed（例外スロー）とする。
- **パターン順序の保持**:
  - `GenomePolicy` は同点時に scoredPatterns / request pattern 配列で先に現れた手（first encountered pattern）を選択するため、パターンの並び順は変更せずそのままハッシュ化する（ソート禁止）。
- **等価性が意味する最大範囲**:
  "GenomeScorer receives the same canonical scoring-input projection under Feature Schema v5."

---

## 17. GenomePolicyScoringInputProjection Specification
`gpif1` のハッシュ化対象となる正規論理プロジェクションの仕様：

### 17.1 TypeScript Interface
```typescript
export interface GenomePolicyScoringInputProjection {
  readonly featureSchemaVersion: 5;
  readonly contextValues: readonly number[]; // Exactly 163 IEEE 754 floats (from EncodedDecisionFeatures.context.values)
  readonly patterns: readonly {
    readonly patternRef: number;
    readonly values: readonly number[]; // Exactly 143 IEEE 754 floats (from EncodedDecisionFeatures.patterns[].values)
  }[];
}
```

### 17.2 JSON Schema
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GenomePolicyScoringInputProjection",
  "type": "object",
  "required": ["featureSchemaVersion", "contextValues", "patterns"],
  "additionalProperties": false,
  "properties": {
    "featureSchemaVersion": {
      "type": "integer",
      "const": 5
    },
    "contextValues": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 163,
      "maxItems": 163
    },
    "patterns": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["patternRef", "values"],
        "additionalProperties": false,
        "properties": {
          "patternRef": { "type": "integer", "minimum": 0 },
          "values": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 143,
            "maxItems": 143
          }
        }
      }
    }
  }
}
```

### 17.3 ソース境界の厳密化: EncodedDecisionFeatures vs DecisionDNA
- **`gpif1.featureSchemaVersion` の出所**:
  `DecisionFeatureEncoder.encode(request)` が返す `EncodedDecisionFeatures.featureSchemaVersion`（数値 5）。
- **`DecisionDNA.featureSchemaVersion` との分離**:
  `DecisionDNA.featureSchemaVersion` は Policy DNA 側の互換性照合用フィールドであり、`gpif1` の入力ソースではない。
- **`EncodedDecisionFeatures` と `GenomePolicyScoringInputProjection` の差異**:
  `EncodedDecisionFeatures` に含まれる `context.featureNames` や `patterns[].kind`, `patterns[].logicalPatternKey` 等は `GenomeScorer.score` で計算に直接使用されないため、`gpif1` プロジェクションには含めない。

---

## 18. Policy Identity & Configuration Boundary (Behavioral vs Provenance)
- **ポリシー入力とポリシー本体・設定の厳格な分離**:
  - `gpif1` にはポリシーの DNA 重み、設定値、DNA ID を含めない。
  - これにより、「異なるポリシーが全く同じ状況に直面しているか」を比較可能とする。
- **Behavioral Continuation と Provenance Identity の直交分離**:
  - **Behavioral Continuation**: 将来の同一行動・スコアリング決定を規定する要素。同一の重み・次元・モデルであれば、個体 ID や表示名が異なっていても完全に同一のスコアリング結果が生じる。
  - **Provenance Identity**: 進化学習の家系図、個体識別、親ペアリング、世代ログの追跡用概念。スコアリング動作には一切関与しないため、Behavioral Continuation Fingerprint からは除外する。
- **DecisionDNA 構成要素の完全監査**:
  - `scoringModel`: "linear-bilinear-v1" (`declaringType: "DecisionDNA"`, Behavioral Continuation `INCLUDE`)
  - `contextDimension`: 163 (`declaringType: "DecisionDNA"`, Behavioral Continuation `INCLUDE`)
  - `patternDimension`: 143 (`declaringType: "DecisionDNA"`, Behavioral Continuation `INCLUDE`)
  - `patternWeights`: 143 次元ベクトル (`declaringType: "DecisionDNA"`, Behavioral Continuation `INCLUDE`)
  - `contextPatternWeights`: 23,309 次元行列 (`declaringType: "DecisionDNA"`, Behavioral Continuation `INCLUDE`)
  - `dnaFormatVersion`: 1 (`declaringType: "DecisionDNA"`, Behavioral Continuation `INCLUDE`)
  - `featureSchemaVersion`: 5 (`declaringType: "DecisionDNA"`, Behavioral Continuation `INCLUDE`)
  - `metadata.id`: 個体識別子 (`declaringType: "DecisionDNAMetadata"`, `POLICY_PROVENANCE_IDENTITY`, `EXCLUDE_BOOKKEEPING`)
  - `metadata.*`: 任意キーインデックスシグネチャ (`declaringType: "DecisionDNAMetadata"`, `TYPE_INDEX_SIGNATURE`, `PRESENTATION_METADATA`, `EXCLUDE_BOOKKEEPING`)
- **PolicyDescriptor 構成要素の監査**:
  - `descriptor.kind`: ポリシー種別 ("genome", "random", "firstLegal" 等, `declaringType: "PolicyDescriptor"`, Behavioral Continuation `INCLUDE`)
  - `descriptor.policyVersion`: 実装バージョン (1, `declaringType: "PolicyDescriptor"`, Behavioral Continuation `INCLUDE`)
  - `descriptor.name`: 人間可読表示名 (`declaringType: "PolicyDescriptor"`, `EXCLUDE_BOOKKEEPING`)
  - `descriptor.metadata`: 補助辞書 (`declaringType: "PolicyDescriptor"`, `EXCLUDE_BOOKKEEPING`)

---

## 19. Continuation Context Research Boundary & Policy Scope
- **ステータス**: **RESEARCH CANDIDATE**
- **公式見解**: **CONTINUATION EQUIVALENCE: NOT PROVEN**
- **CCF V1 Policy Scope: GenomePolicy ONLY**:
  - Immediate AI evidence target は `GenomePolicy` に限定する。
  - `FirstLegalPolicy`（private `preferPass`）、`RandomPolicy`（private `rng`）、`ScriptedPolicy`（private `chooser` / `fallbackPolicy`）の完全な Behavioral Continuation modeling は **OUT OF SCOPE / RESEARCH GAP** とする。
  - `descriptor.kind` + `policyVersion` だけで全ポリシーの同一未来を保証できるとは主張しない。
- **GenomePolicy Behavioral Continuation 候補要素**:
  1. ルール上の完全な内部シミュレータ状態（`GameState` + `GameSession` 意味論的サイドステート）
  2. 現在の決定文脈（`DecisionRequest`）
  3. ポリシー実装識別子（`descriptor.kind = "genome"`, `descriptor.policyVersion = 1`）
  4. ポリシー DNA 設定・重み（`dnaFormatVersion`, `featureSchemaVersion`, `scoringModel`, `contextDimension`, `patternDimension`, `patternWeights`, `contextPatternWeights`）
  5. ルールパッケージ内容ダイジェスト（`rulePackage.contentDigest` [DERIVED_RESEARCH_CANDIDATE]）
  6. シミュレータエンジンビルド識別子（`simulator.buildSha` [DERIVED_RESEARCH_CANDIDATE]）
  7. 特徴量スキーマバージョン（`Feature Schema v5`）
  8. PRNG / シャッフル継続状態（`matchSeed`, `runtimeShuffleCount`, 内部 PRNG 状態）

---

## 20. RulePackage / Build Identity Boundary (Runtime vs Derived)
- **Current Runtime Properties**:
  - `rulePackage.id`: `RulePackage.ts` の実在プロパティ（例: `"rules-vnext"`, `declaringType: "RulePackage"`）。
  - `rulePackage.version`: `RulePackage.ts` の実在プロパティ（例: `"9.1.2"`, `declaringType: "RulePackage"`）。
- **Derived Research Candidates (Current Source に実在しない派生候補値)**:
  - `rulePackage.contentDigest`:
    - `RulePackage.ts` には実在しない。
    - 将来の診断実装において、RulePackage の正規化 JSON（actions, components）から SHA-256 で導出する digest の候補値。
  - `simulator.buildSha`:
    - `package.json` には実在しない。
    - 将来の診断実装において、ビルド時環境変数（`BP_BUILD_SHA` / `VITE_BUILD_SHA`）または Git コミット SHA から導出する識別子の候補値。

---

## 21. RNG / Shuffle Accessibility Boundary
コード監査に基づく乱数アクセシビリティの厳格な事実：

1. **`SeededRandom` のカプセル化**:
   - `tools/simulator/src/engine/random/RandomSource.ts` において、`SeededRandom` の内部状態 `state` は `private` である（`declaringType: "SeededRandom"`）。
   - 公開 `RandomSource` インターフェースからはシード値のみが取得可能であり、内部状態は取得できない。
   - **設計原則**: 本診断設計のためにプロダクションコードのカプセル化を破壊して `state` を公開することは禁止する。
   - **レジストリ上のステータス**: `random.seededRandom.state` は `CURRENT_RUNTIME_FIELD` / `PRIVATE_RUNTIME_DECLARATION` であるが、`SOURCE_AUDITED_NOT_RUNTIME_ACCESSIBLE` と定義する。
2. **ランタイムシャッフルの決定論性**:
   - `DeterministicShuffle.ts` において、ゲーム中シャッフルは `deriveRuntimeShuffleSeed(matchSeed, state.runtimeShuffleCount)` によって直接派生される。
   - したがって、ランタイムシャッフルに関しては `matchSeed` と `state.runtimeShuffleCount` があれば完全に再現可能である。

---

## 22. Field Registry Contract
作成された `ai-semantic-fingerprint-field-registry-v1-r8.json` の仕様契約：

- **監査対象総エントリ数**: 140
- **Origin 内訳**:
  - `CURRENT_RUNTIME_FIELD`: 138
  - `DERIVED_RESEARCH_CANDIDATE`: 2（`rulePackage.contentDigest`, `simulator.buildSha`）
- **EvidenceKind 内訳**:
  - `TYPE_DECLARATION`: 79（TypeScript Compiler API AST による明示的型・インターフェースプロパティ宣言検証済み）
  - `TYPE_INDEX_SIGNATURE`: 1（`DecisionDNAMetadata` の `[key: string]: JSONValue | undefined` AST 検証済み）
  - `RUNTIME_ACCESS`: 57（producer / consumer / StateHasher コード根拠検証済み）
  - `PRIVATE_RUNTIME_DECLARATION`: 1（`SeededRandom.state` AST 検証済み）
  - `DERIVED_RESEARCH_CANDIDATE`: 2
- **ソースカバレッジ分類**:
  - `GameState`: Audited (49 Runtime Access Fields)
  - `GameSessionSideState`: Audited (8 Runtime Access Fields)
  - `DecisionRequestRoot`: Audited (9 Type Declaration Fields: `declaringType: "DecisionRequest"`)
  - `LegalPattern`: Audited (9 Type Declaration Fields: `declaringType: "LegalPattern"`)
  - `DecisionCatalog`: Audited (38 Type Declaration Fields across `DecisionCatalog`, `ActionSelection`, `CardSelection`, `UnitSelection`, `CostPayment`, `TargetSelection`, `EffectSelection`, `OrderSelection`)
  - `PlayerObservation`: Audited (9 Type Declaration Fields: `declaringType: "PlayerObservation"`)
  - `PolicyState`: Audited (8 Type Declaration Fields + 1 Type Index Signature Field: `declaringType: "DecisionDNA"` / `"DecisionDNAMetadata"`)
  - `PolicyDescriptor`: Audited (4 Type Declaration Fields: `declaringType: "PolicyDescriptor"`)
  - `RNGShuffleContext`: Audited (1 Private Runtime Declaration Field: `declaringType: "SeededRandom"`)
  - `RulePackageBuildIdentity`: Audited (2 Type Declaration Fields + 2 Derived Research Candidates)
- **分類集計**:
  - `INCLUDE`: 99
  - `EXCLUDE_BOOKKEEPING`: 24
  - `INCLUDE_CONDITIONAL`: 17
  - `REVIEW_REQUIRED`: 0
  - `UNKNOWN`: 0
- **ステータス集計 (Fail-Closed Verified)**:
  - `SOURCE_AUDITED`: 137
  - `SOURCE_AUDITED_NOT_RUNTIME_ACCESSIBLE`: 1
  - `REQUIRES_IMPLEMENTATION_TEST`: 2
  - `INVALID_STATUS_COUNT`: **0**
- **ポリシー関連未分類フィールド数**: 0
- **R7 $\rightarrow$ R8 変更点**: `state.turnCount` の `rationale` を正確な意味論（S1 turnCount 包含、S2 はターン進行後の複数ターン再訪候補検知用）へ改訂。その他 139 フィールドは 100% ディープイコール。

---

## 23. Identity Canonicalization
- **動的ランタイム ID の課題**:
  - シミュレータ実行中、`unit-cost-1788...` や `req-trg-1788...` などの動的 ID が採番される。
  - 生の ID を直接比較すると、同じ状況であっても採番カウンタの進み方によりハッシュが不一致となる。
- **Canonicalization 戦略**:
  - `StateHasher.ts` の実績ある 2-Pass Traversal を継承：
    1. 決定論的走査順序で全エンティティの動的 ID を検出し、出現順の canonical ID（例: `unit#1`, `req#1`）へマッピング。
    2. 全オブジェクトおよび参照フィールドを探索し、参照関係を保ったまま canonical ID へ置換。
- **ID 縮約の禁止 (No ID Collapse)**:
  - 異なるカード、異なるユニット、異なるリクエストを同一の ID へ潰してはならない。グラフ構造のトポロジーを厳格に保存する。

---

## 24. Ordering Semantics & Tie-Break Contract
コード監査に基づく全コンテナの順序意味論：

| コンテナ / ゾーン | 順序意味論 | 根拠 |
|:---|:---:|:---|
| **Stage Requests** | `Order-Preserving` (LIFO) | ステージはスタックであり、配列順序がそのまま解決順序（後入れ先出し）を規定する。再ソート厳禁。 |
| **Request Buffer** | `Order-Preserving` (FIFO) | 誘発キュー。配列順序がトリガー解決順序に影響する。 |
| **Life Cards** | `Order-Preserving` (TOP) | ライフ先頭（インデックス 0）への unshift や先頭からのダメージ消費。 |
| **Hand Cards** | `Order-Preserving` | `LegalPatternGenerator` が手札順でキーカード組合せを生成し、タイブレークに直結する。ソート禁止。 |
| **Field Units** | `Order-Preserving` | 戦闘解決や走査順序に影響。 |
| **Grave Cards/Units** | `Order-Preserving` (TOP) | 墓地先頭（`graveTopCardId`）および配置順。 |
| **Trumps / Fog** | `Order-Preserving` | 配置順および参照整合性。 |
| **Legal Patterns** | `Order-Preserving` | `GenomePolicy` の first-encountered tie-break に直結。ソート厳禁。 |

### 24.1 GenomePolicy Tie-Break 厳密仕様
- **実装実態**: `GenomePolicy.ts` において、`bestScore = -Infinity` で初期化され、`scoredPatterns` 配列を順次走査して `p.score > bestScore` の時のみ更新される。
- **同点時の確定挙動**: スコアが完全同点の場合、更新条件を満たさないため **「scoredPatterns / request pattern order において先に現れた手（first encountered pattern）が維持される」**。
- **Source Comment Debt**: `GenomePolicy.ts` L15, L57 に記載されている「最小 patternRef 優先」というコメントは実装実態と一致しない既存のコメント負債である。

---

## 25. Hidden Information & Visibility Boundaries
- **合法的観測と完全状態の分離**:
  - `PlayerObservation` は、Viewer プレイヤーがルール上知り得る情報のみで構成される。
  - 相手の手札中身、相手の伏せ防壁カード中身、相手の10枚以上のライフ正確値、未開封パック中身などは安全に HIDDEN 化されている。
  - 診断アーキテクチャでは、Viewer 視点の判断文脈比較（Tier 1）と、客観的盤面停滞検知（Tier 2）を明確に分離して処理する。

---

## 26. Diagnostic Observer Architecture & Canonical Sampling
診断アーキテクチャのコンポーネント構成およびサンプリング境界：

```
+---------------------------------------------------------------------------------+
|                                GameSession                                      |
|                                                                                 |
|   +-------------------+                     +-------------------------------+   |
|   |   pendingDecision |                     |      CoreFlowCoordinator      |   |
|   +-------------------+                     +-------------------------------+   |
+---------------------------------------------------------------------------------+
                                       |
                   session.advance() returns WAITING_FOR_DECISION
                                       |
    [CANONICAL SAMPLING POINT: PRE_DECISION / DECISION_BOUNDARY]
    (Before calling policy.choose(step.request))
                                       v
+---------------------------------------------------------------------------------+
|                       SemanticStallCycleDetector (Passive)                      |
|                                                                                 |
|  1. Capture Snapshot at PRE_DECISION (Single Time Boundary)                     |
|  2. Canonicalize Dynamic IDs (Preserve Topology)                                |
|  3. Serialize Canonical JSON (Sorted Keys, Preserved Array Order, Exact Floats) |
|  4. Compute 5 Canonical Fingerprints:                                           |
|       - sgf1 (Structural Gameplay Fingerprint, Turn-Aware)                      |
|       - sgf1-ti (Structural Gameplay Fingerprint, Turn-Invariant)               |
|       - pof1 (Player Observation Fingerprint)                                   |
|       - drsf1 (Decision Request Semantic Fingerprint)                           |
|       - gpif1 (Genome Policy Input Fingerprint)                                 |
|  5. Update Ring Buffer (M=64) & Inverted Hash Index                             |
|  6. Evaluate Signals (Stall Count, Recurrence Window, Period Length)            |
|  7. Associate Chosen Decision Metadata (post policy.choose, pre submitDecision)  |
|  8. Emit Diagnostic Trace (Telemetry Only, No Feedback into Engine)             |
+---------------------------------------------------------------------------------+
```

- **非侵襲性**: エンジンの内部状態、意思決定、勝敗判定、乱数列へ一切フィードバックしない。
- **無効時設計**: 診断フラグが無効（デフォルト）の場合、一切のオーバーヘッドおよびメモリ確保を行わない設計目標（`near-zero/no allocation when disabled`）を追求する。

---

## 27. Detection Signals
診断検出器が出力するシグナル仕様（すべて診断テレメトリであり、対戦結果ではない）：

1. `NO_SIGNAL`: 正常なゲーム進展。
2. `REPEATED_STRUCTURAL_FINGERPRINT`: 同一の構造的盤面フィンガープリント（Tier 2）が $N$ 回連続して観測された（意味的盤面停滞）。
3. `REPEATED_DECISION_REQUEST`: 同一の判断要求意味的フィンガープリント（`drsf1`）が $N$ 回連続して観測された。
4. `REPEATED_POLICY_INPUT`: 同一のポリシー入力数値フィンガープリント（`gpif1`）が $N$ 回連続して観測された。
5. `PERIODIC_FINGERPRINT_CANDIDATE`: リングバッファ（$M=64$）内において、周期 $k$ ステップ前に同一のフィンガープリントが存在し、それが複数回繰り返された（周期循環候補）。
6. `NO_SEMANTIC_CHANGE_WINDOW`: 指定した決定ウィンドウ（例: 20 決定）の間、意味的状態の更新回数が閾値未満であった。

---

## 28. Cycle Proof Boundary
- **保守的用語の徹底**:
  - `DETERMINISTIC_CYCLE として確定`、`無限ループの数学的証明`、`完全デッドロック` などの表現を厳禁とする。
  - 使用する用語は **`Periodic Fingerprint Candidate`**、**`Repeated Structural Fingerprint`**、**`Repeated Decision Context`**、**`Cycle Candidate`** に限定する。
- **理由**:
  - 同一のフィンガープリントが再訪されたとしても、未消費の乱数ストリーム（シャッフル）、非対称なプレイヤー思考、手札の隠匿情報によって将来ループを脱出する可能性が数学的に存在する。

---

## 29. False Positive Analysis
1. **意図的なロングゲーム**:
   - プレイヤー双方が防御的な好手を打ち続け、盤面が膠着しているが、わずかなリソース消費（手札枚数やライフ等）が発生しているケース。
   - **対策**: 単に決定数が長いだけのゲームを誤検知しないよう、リソース更新があればフィンガープリントが変化する設計とする。
2. **偶発的な盤面再訪**:
   - 一進一退の攻防（アタックと回復）により、数ターン後に偶然同じライフ・手札・ユニット構成に戻るケース。
   - **対策**: 単発の再訪をもってサイクルと判定せず、周期的な反復（$k$ ステップごとの 2 回以上の反復）を確認する。

---

## 30. False Negative Analysis (R8 Corrected)
1. **同一ターン内の空ステージ PASS ループ停滞**:
   - プレイヤー双方が何もせず PASS を連打するケース。
   - **コアフロー事実**: 空ステージでの連続 PASS は `TurnManager.startTurn` / `endTurn` を呼び出さないため、**`turnCount` は一切進まず同一ターン内に留まる**。
   - **検知メカニズム**: Variant S1 (Turn-Aware) は `turnCount` を含んでいるが、`turnCount` 自体が変化しないため、動的 ID や `stateVersion` を抽象化した S1 ハッシュは P1 PASS $\rightarrow$ P2 PASS $\rightarrow$ リセットの 2 ステップ周期で完全一致し、**確実に検知される**。
2. **ターン進行を伴う周期的盤面循環 (Cross-Turn Periodic Recurrence)**:
   - ターンが実際に進行した（`turnCount` がインクリメントされた）上で、相互の攻防やリソース消費・補充が可逆的に一周し、数ターン後に元の盤面・リソース構成に戻るケース。
   - `turnCount` が変化しているため、Turn-Aware フィンガープリント（Variant S1）では異なるハッシュ値となり見逃す。
   - **対策**: `turnCount` を意図的に除外した **Variant S2 (Turn-Invariant)** フィンガープリントを併用して捕捉する。
3. **Bookkeeping の漏れによる偽の差異**:
   - リクエストの絶対シーケンス番号や動的 ID のプレフィックス違いにより、同じ状況が異なるハッシュ値となるリスク。
   - **対策**: Canonical ID 置換およびシーケンス番号の相対インデックス化により確実に抽象化する。

---

## 31. Hash / Serialization Contract
新診断フィンガープリントのシリアライズおよびハッシュ仕様：

1. **暗号学的ハッシュ関数**:
   - **アルゴリズム**: SHA-256（`crypto.createHash('sha256')`）
   - **ダイジェストサイズ**: 32 bytes
   - **文字列表現**: 64 文字の小文字 Hex 文字列
   - **プレフィックス体系**:
     - `sgf1-<64 hex>`: Structural Gameplay Fingerprint (Variant S1)
     - `sgf1-ti-<64 hex>`: Structural Gameplay Fingerprint (Variant S2, Turn-Invariant)
     - `pof1-<64 hex>`: Player Observation Fingerprint
     - `drsf1-<64 hex>`: Decision Request Semantic Fingerprint
     - `gpif1-<64 hex>`: Genome Policy Input Fingerprint
     - `ccf1-<64 hex>`: Continuation Context Fingerprint (Research Candidate)
2. **正規化シリアライザ (Canonical JSON Serialization)**:
   - オブジェクトのキーを Unicode コードポイント昇順で再帰的にソート。
   - 余分な空白・改行を含まないコンパクト表現。
   - 浮動小数点数は完全な精度でシリアライズ（`-0` は `0` に正規化）。丸め処理は行わない。
3. **Existing StateHasher との厳格な分離**:
   - `StateHasher.ts` は FNV-1a 64-bit（`sh2-<16 hex>`）であり、本診断ハッシュと混同しない。

---

## 32. Memory / History Bound Design
- **リングバッファサイズ ($M=64$)**:
  - 直近 $M$ ステップのフィンガープリントおよび決定情報を保持。
  - 周期 $k \in [1, M/2]$ の反復パターンを効率的に検出。
- **逆引きハッシュインデックス ($U_{\text{map}}$)**:
  - フィンガープリント文字列から直近出現インデックスへのマッピング。
  - $O(1)$ lookup で過去の再訪有無を判定。
- **メモリ上限と非主張**:
  - 1 検出器あたりのヒストリ保持量は $M=64$ に制限されるが、プロセス全体の総フットプリントは同時実行マッチ数に依存するため、固定の「5MB 未満保証」は行わない。

---

## 33. Complexity Analysis & Performance Non-Claims
- **フィンガープリント生成時間計算量**:
  $O(N_{\text{entities}} + N_{\text{patterns}} \cdot (D_{\text{pattern}} + D_{\text{context}}))$
  ここで $N_{\text{entities}}$ は盤面要素数、$N_{\text{patterns}}$ は合法手候補数、$D_{\text{context}} = 163$、$D_{\text{pattern}} = 143$。
- **再訪・周期検索時間計算量**:
  ハッシュマップ lookup による平均 $O(1)$、最悪 $O(M)$（$M=64$）。
- **空間計算量**:
  $O(M \cdot H_{\text{size}} + U_{\text{map}})$
  ここで $M=64$、$H_{\text{size}}=64$ 文字。
- **未計測パフォーマンス主張の厳格な排除 (`DESIGN ESTIMATE / NOT BENCHMARKED`)**:
  - 本設計作業において実行時ベンチマークは一切実施されていない。
  - 診断無効時の「一切のオーバーヘッドなし」や、特定の実測時間（ミリ秒/マイクロ秒）に関する断定的主張は行わない。
  - 実測オーバーヘッドは将来の Implementation Evidence 作業において正式に計測・報告する。

---

## 34. Diagnostic Trace Contract (R8 Corrected)
診断機能が有効化された場合に出力されるトレースイベントのスキーマ：

```json
{
  "stepIndex": 42,
  "boundary": "PRE_DECISION",
  "turnCount": 3,
  "activePlayer": "p1",
  "decisionSource": "ACTION_REQUEST",
  "fingerprints": {
    "structural": "sgf1-a1b2c3...",
    "structuralTurnInvariant": "sgf1-ti-d4e5f6...",
    "observation": "pof1-789abc...",
    "decisionRequest": "drsf1-def012...",
    "policyInput": "gpif1-345678..."
  },
  "selectedDecision": {
    "selectedPatternRef": 0,
    "selectedPatternKind": "PASS",
    "actionId": null,
    "selectedLogicalPatternKey": "kind:PASS"
  },
  "diagnostics": {
    "structuralStallCount": 0,
    "policyInputStallCount": 0,
    "cycleCandidate": null,
    "signal": "NO_SIGNAL"
  }
}
```

- **境界の明示**: `"boundary": "PRE_DECISION"` により、全フィンガープリントが意思決定直前スナップショット由来であることを明示。
- **メタデータの分離**: 選択結果は `"selectedDecision"` フィールドとして関連付け、プレ状態フィンガープリントとポスト状態フィンガープリントを混在させない。
- **ポスト状態の扱い**: 実装で submitDecision 前後差分を記録する場合は、`postStructuralFingerprint` などの別名補助テレメトリとし、Canonical な recurrence 履歴には混入させない。

---

## 35. Match Outcome Contract
- **対戦結果への不干渉**:
  - 診断シグナル（例: `REPEATED_STRUCTURAL_FINGERPRINT` や `PERIODIC_FINGERPRINT_CANDIDATE`）が発生した場合でも、対戦結果（`GameResult`）を `DRAW` や `FAILED` へ強制変更しない。
  - `SimulationRunner` は、最大判断回数（`maxDecisions = 500`）到達時に既存実装通り `completed: false` を返す。
  - 上位の BatchRunner / GenerationRunner は、`completed === false` の結果を公式ステータス **`INCOMPLETE`** として記録する契約を維持する。
  - 診断シグナルはメタデータおよびテレメトリとしてのみ記録される。

---

## 36. Future Test Matrix (R8 Corrected)
将来の実装フェーズ（Implementation）において必須となるテストケース体系：

### 36.1 Decision Request Semantic Tests (`drsf1`)
1. **意味的アクション識別子の検知**:
   - `actionSelectionRef` が同一でも、参照先 `catalog.actions` の `actionId` や `speed` が異なる場合、`drsf1` が不一致となること。
2. **解決済みカタログコンテンツの検知**:
   - `keyCardSelectionRef`, `keyUnitSelectionRef`, `costPaymentRef`, `targetSelectionRef`, `effectSelectionRef`, `orderSelectionRef` の参照先実体データが異なる場合、`drsf1` が不一致となること。
3. **表示用文字列の透過性**:
   - `actionName`, `displayName`, `primaryLabel`, `secondaryLabel`, `summary` などの表示用ラベルのみが異なり、意味的プロパティが完全同一である場合、`drsf1` が完全一致すること。

### 36.2 Genome Policy Input Tests (`gpif1`)
1. **正規射影の一致によるハッシュ一致**:
   - `GenomePolicyScoringInputProjection(A)` と `GenomePolicyScoringInputProjection(B)` がディープイコールである場合、`gpif1(A) === gpif1(B)` となること。
2. **特徴量数値差異の検知**:
   - `contextValues` のいずれかの数値が異なる場合、`gpif1` が不一致となること。
   - `patterns[].values` のいずれかの数値が異なる場合、`gpif1` が不一致となること。
3. **パターン識別子および順序感度**:
   - `patterns[].patternRef` が異なる場合、`gpif1` が不一致となること。
   - パターン集合が同一で並び順のみが異なる場合、first-encountered tie-break に直結するため `gpif1` が不一致となること。
4. **補助プロパティの透過性**:
   - `patterns[].logicalPatternKey` や `context.featureNames` のみが異なる場合、`gpif1` プロジェクションに含まれないため `gpif1` が完全一致すること。
5. **Policy DNA / Metadata 非干渉**:
   - Policy DNA の重み配列が異なっていても、同一 Request に対しては `gpif1` が完全一致すること。
   - `policy.dna.metadata.id` が異なっていても、同一 Request に対しては `gpif1` が完全一致すること。

### 36.3 Continuation Candidate Tests (`ccf1`)
1. **同一 gpif / 異なる Policy 重み**:
   - 同一の `gpif1` であっても、対戦者である `GenomePolicy` の重み配列が異なる場合、`ccf1` 候補値が不一致となること。
2. **Metadata.id 単独差異の透過性**:
   - `policy.dna.metadata.id` のみが異なり、全重み・全設定・全盤面が完全同一である場合、Behavioral Continuation Context 候補値は完全一致すること（Provenance Identity 分離の検証）。
3. **ScoringModel / Dimension 差異の検知**:
   - `scoringModel`, `contextDimension`, `patternDimension` が異なる場合、Behavioral Continuation Context 候補値が不一致となること。

### 36.4 Canonical PRE_DECISION Sampling & Simultaneous Generation Test (R8 Added)
- `SimulationRunner` の対戦ループにおいて、`WAITING_FOR_DECISION` 到達時に採取される `sgf1`, `sgf1-ti`, `pof1`, `drsf1`, `gpif1` が**すべて同一の PRE_DECISION 境界由来**であり、時間のズレがないことを検証。

### 36.5 Stage-Empty PASS Recurrence Canonical Example Test (R8 Added)
- **テストシナリオ**:
  - ステージ空の初期盤面：
    - Snapshot 0: `turnPlayer = "p1"`, `chancePlayer = "p1"`, `passCount = 0`, `turnCount = T`
  - P1 が PASS を選択：
    - Snapshot 1: `turnPlayer = "p1"`, `chancePlayer = "p2"`, `passCount = 1`, `turnCount = T`
  - P2 が PASS を選択：
    - `GameSession.advance()` 内で `passTracker.reset()` が行われ、チャンスが `turnPlayer` ("p1") へ返却される。
    - Snapshot 2: `turnPlayer = "p1"`, `chancePlayer = "p1"`, `passCount = 0`, `turnCount = T`
- **検証アサーション**:
  - 単調増加カウンタ（`stateVersion`, `decisionId`, `nextRequestSeq`）を除外した際、`sgf1(Snapshot 0) === sgf1(Snapshot 2)` となること。
  - これは決定論的サイクルの証明ではなく、再訪候補（Recurrence Candidate）の検知であることを検証。

### 36.6 Full End Lifecycle Test (R8 Added)
- **テストシナリオ**:
  - A. 手番プレイヤーが `action.end` をリクエスト（Stage へ積載、チャンス維持）
  - B. 双方 PASS により 2-PASS 成立
  - C. `action.end` 解決（フォグ墓地送還、`cleanupFogs`）
  - D. ターン交代（`turnPlayer` 交代、`turnCount` が +1）
  - E. ターン開始時チャージが即時解決（ユニット状態が charge へ変化）
  - F. ターン開始時ドローが Stage へ積載
  - G. ドロー解決（カードがライフから手札へ移動）
- **検証アサーション**:
  - この一連のライフサイクル進行に伴い、フォグ・ユニット状態・ライフ・手札が実際に更新されるため、`sgf1-ti` が初期状態から正しく変化し、偽の停滞と判定されないこと。

### 36.7 Turn-Invariant Recurrence Controlled Fixture Test (R8 Added)
- **テスト目的**:
  - Variant S2（`sgf1-ti`）の感度を単体検証するための制御された診断用フィクスチャ。
- **テストシナリオ**:
  - ターンが実際に進行（`turnCount` がインクリメント）した後、`turnCount` 以外の全 S2 対象意味論的盤面状態（プレイヤーの手札、ライフ、フィールド、墓地、フォグ、turnPlayer、chancePlayer 等）をフィクスチャ上で意図的に同一へ戻す。
- **検証アサーション**:
  - `sgf1(Turn A) !== sgf1(Turn B)`（`turnCount` 差により S1 は不一致）。
  - `sgf1-ti(Turn A) === sgf1-ti(Turn B)`（`turnCount` 以外の同一性により S2 は一致）。
  - ※本テストは診断 Fingerprint 単体の感度検証フィクスチャであり、通常の BlackPoker ゲームプレイにおいて End だけで盤面が同一に戻ると主張するものではないことを明記。

### 36.8 Hash Collision & Equivalence Boundary
- 暗号学的ハッシュ（SHA-256）の一致を数学的完全等価性の証明とは主張しない。

---

## 37. Future Performance Evidence Plan
実装完了後に実施すべき性能評価計画：

1. **ベースライン計測**: 診断機能無効時の対戦スループット（decisions/sec）およびメモリ消費。
2. **診断有効時計測**: 診断機能を有効化した際のスループット低下率および決定あたりの平均/p95 オーバーヘッド。
3. **ピークメモリ計測**: リングバッファおよびハッシュインデックスによるプロセスあたりの追加メモリ消費。
4. **Controlled N=6 診断実行**: A/B Evidence で特定された 28 件の INCOMPLETE 対戦に診断を適用し、停滞・サイクルの発生状況を実測。

---

## 38. Future Implementation Boundary
- **本成果物のスコープ**:
  - 本設計書 (V1-R8) およびフィールドレジストリ (V1-R8) は **DESIGN ONLY** である。
  - プロダクションコード（`src/**`）、テストコード（`tests/**`）、ルール定義、ビルド成果物（`dist/**`）への変更は一切含まれない。
- **次期タスク境界**:
  - 実装は独立レビュー通過後、次期 Work ID: `BP-SIM-AI-SEMANTIC-STALL-CYCLE-IMPL-V1` において着手する。

---

## 39. Roadmap Position & Acceptance Criteria
`tools/simulator/docs/ai-self-play-roadmap.md` における本設計の位置づけ：

- `BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1-R1`: `FORMAL ACCEPTED` (SHA: `97d2ac1fa2db79f459c75e4f1fd19486125d1ef6`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1`: `NOT ACCEPTED / SUPERSEDED BY R1` (SHA: `6ab04120fb3cfc9dccf4cf04f9c824e091af374d`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R1`: `NOT ACCEPTED / SUPERSEDED BY R2` (SHA: `81433f8e5cdcec44bcffca51ce476f0d2e1b8fbe`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R2`: `NOT ACCEPTED / SUPERSEDED BY R3` (SHA: `14de5ffd567a099b27ec7c23389741d2859e2491`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R3`: `NOT ACCEPTED / SUPERSEDED BY R4` (SHA: `e96a6bef80492b62eb86935096658604bdc4ba09`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R4`: `NOT ACCEPTED / SUPERSEDED BY R5` (SHA: `a697ee02d23e239ff9fffffbad9d8a4a7464ff80`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R5`: `NOT ACCEPTED / SUPERSEDED BY R6` (SHA: `34e773a01aed53a6c76806d0332b10754e0a4ec2`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R6`: `NOT ACCEPTED / SUPERSEDED BY R7` (SHA: `c7306755d42a68c859ef084826451f6f0189ea9e`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R7`: `NOT ACCEPTED / SUPERSEDED BY R8` (SHA: `fec61f3b449d87833768e90cdb5405f6b82801ba`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R8`: **`DESIGNED / PENDING INDEPENDENT REVIEW`** (本作業)
- `Semantic Diagnostic Implementation`: `NOT STARTED / WAITING FOR INDEPENDENT REVIEW`
- `Diagnostic Controlled Evidence`: `NOT STARTED`
- `Competitive Stall Escape`: `NOT STARTED`
- `Test / Adversarial DNA`: `NOT STARTED`
- `Controlled Multi-Generation`: `WAITING`

---

## 40. Final Design Status
本設計書 `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R8` は、V1-R7 レビューで指摘された Registry `state.turnCount` rationale の是正、End ライフサイクル（Normal Action $\rightarrow$ 2-PASS $\rightarrow$ End 解決 $\rightarrow$ ターン交代 $\rightarrow$ Charge 即時解決 $\rightarrow$ Draw Stage 積載 $\rightarrow$ Draw 解決）の厳密な実態整合と「End = semantic no-op」モデルの完全撤回、および全 5 つの Fingerprint の単一サンプリング境界（`PRE_DECISION`）への統一を完備し、プロダクション実装へ進むための正当な設計仕様を最終確定しました。

**Final Status**: **`READY FOR INDEPENDENT REVIEW`**
