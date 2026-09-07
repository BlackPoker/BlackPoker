# BlackPoker Simulator AI Self-Play Phase 3.4 & Phase 3.4.1
# 公式AI未完走原因およびポリシー識別性 診断報告書

- 作業ID: `BP-SIM-AI-3.4.1-20260906-1841` (親作業ID: `BP-SIM-AI-3.4-20260906-1601`)
- 実施日時: 2026-09-06 JST
- Workstream: AI Self-Play / Official Regulation Diagnostics
- 前提Official Regulation作業ID: `BP-SIM-REG-1.0.1-20260905-1805`
- 関連UI作業ID: `BP-SIM-UI-2.4.1-20260906-1320`
- 診断対象リポジトリ: `BlackPoker/BlackPoker`
- 診断対象ブランチ: `BlackPoker/issue551-core-flow`
- 診断バージョン: `1.1.0` (v1.0.0 後方互換保持)
- 診断論理ダイジェスト (Diagnostics Digest v1.1): `0ee51e74dc28ab761123f58ff2d58a26757bc85445ff43428e745bdd42cceb20`
- 参照元ベースラインダイジェスト (Source Baseline Digest): `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`

> [!WARNING]
> **HEAVY / MANUAL ONLY / DO NOT RUN IN CI**
> `npm run measure:official-baseline` および `npm run diagnose:official-baseline` は、600戦以上の完全対戦シミュレーションおよび最大2,000ステップの再実行を伴う**重い手動診断専用コマンド**です。
> `npm test`、`npm run build`、`npm run playable:check`、GitHub Actions（push / schedule / refresh_docs.yaml）等のCIワークフローからは**絶対に呼び出さないでください**。
> CIワークフローへの混入抑止はアーキテクチャ境界テスト（`src/tests/architecture/architectureBoundary.test.ts`）によって厳格に自動検証されています。

---

## 1. Phase 3.4 の観測と成果 (Phase 3.4 Observations)

Phase 3.4 において、公式レギュレーション（Light + Entry16）600 戦（3 カード × 2 レグ × 100 戦）のベースライン未完走 111 件およびポリシー選択ログを対象に、初期診断を実施した。その結果、次の主要事実が観測された：

1. **ステップ予算拡大（1000 / 2000 ステップ）**:
   - 1000 ステップでも 111/111 件が未完走（完走率 0.0%）。
   - 2000 ステップでも 111/111 件が未完走（完走率 0.0%）。
2. **ターン進行の停滞**:
   - 未完走 111 件中 99 件（89.2%）において、ターン数は 1 のまま一度も進展せず（Turn 1 停滞）、残り 12 件（10.8%）も Turn 4（6件）または Turn 5（6件）へ進展した後に停滞した。全 111 件において 2000 回の意思決定上限に到達した。
3. **ポリシー反実仮想一致率**:
   - FirstLegal, ZeroGenome, ManualGenericGenome の 3 者間において、観測された全 87,888 回の `DecisionRequest` に対する選択一致率は 100.0%（差分 0 件）であった。
4. **Stage-Empty TP+CP PASS の不発**:
   - `Stage 深度 0 かつ decisionPlayer === turnPlayer かつ chancePlayer === turnPlayer` の条件下で PASS が選択された回数は 0 回であった。

---

## 2. Phase 3.4.1 補修理由 (Phase 3.4.1 Repair Rationale)

Phase 3.4 の診断結果に対する独立技術レビューにより、次の 5 つの診断精度上の課題・計測不備が指摘された：

1. **State Hash v2 による周期判定の偽陰性**:
   - `StateHasher` (v2) には毎ステップ単調増加する `stateVersion` および `nextRequestSeq` が含まれていた。このため、実質的に盤面・手札・未解決要求が全く同一のゲーム論理状態へ循環していても、ハッシュ値が毎ステップ異なり、「状態再訪 0 件」と誤認されていた。
2. **finalStageDepth の計測バグ**:
   - `session.state.stage?.length` を参照していたため、オブジェクト構造 `state.stage.requests` を正しく読めず、深度が常に `0` と誤判定されていた。
3. **Turn 1 内の進行証跡（Generic Evidence）の不足**:
   - ログメッセージ上の文字列を過剰に信頼し、機械可読 Artifact 側に Request Buffer 深度や構造化ライフサイクルイベントの客観的証跡が不足していた。
4. **アーキテクチャ責務境界の不整合**:
   - `OfficialBaselineDiagnosticsRunner` が `src/engine/regulation/` 配下に置かれており、Core/Regulation から AI 診断コードへの不要な逆依存リスクが存在した。
5. **Gameplay 上の「Phase」表現の誤記**:
   - BlackPoker のゲームルールには「Phase」概念が存在しないにもかかわらず、レポート内に「Turn 1 の特定フェーズ」「メインフェーズ」という不適切な表現が混入していた。

Phase 3.4.1 では、Core Flow やゲームルール、Feature Schema、DNA 等のゲームロジックには一切手を触れず、**診断の精度と客観的証跡の補修のみ**を実施した。

---

## 3. State Hash v2 と Cycle Fingerprint の違い (State Hash vs Cycle Fingerprint)

| 観点 | State Hash v2 (`sh2-...`) | Cycle State Fingerprint v1 (`csf1-...`) |
| :--- | :--- | :--- |
| **主目的** | 完全論理状態の不可逆的一意同定 | ゲームプレイ実質状態の周期・再帰検知 |
| **バージョン** | 2 (`StateHasher.VERSION = 2`) | 1 (`CYCLE_STATE_FINGERPRINT_VERSION = 1`) |
| **単調カウンタ** | **含む** (`stateVersion`, `nextRequestSeq`, `sequence`) | **完全除外** (`stateVersion`, `nextRequestSeq`, `sequence` 除外) |
| **実行時 ID** | `req-xxx` 等の動的 ID をそのまま含みうる | スロット相対参照 (`stage#0`, `buffer#0` 等) へ正準化 |
| **実行時メタデータ** | timestamp, sequence を除外 | timestamp, sequence, wall clock を除外 |
| **配列順序保持** | Stage, Hand 等を保持 | Stage (LIFO 解決順), Buffer (キュー順) を**厳格保持** |
| **ゲームプレイ感応性** | 手札・ライフ・盤面・ステージ差分に感応 | 手札・ライフ・盤面・ステージ・バッファ・ターン使用回数差分に感応 |
| **未完走対戦での挙動** | 2000 ステップ中 2000 ユニーク（再訪 0 件） | **実質再帰を検知（21 ユニーク、1979 回再訪）** |

---

## 4. 111件未完走の再診断結果 (111 Incomplete Matches Re-diagnostics)

Phase 3.3 元ベースライン成果物（Digest: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`）から動的抽出した 111 件の未完走対戦について、補修後の診断ランナーで再実行した結果：

- **Primary 500 未完走数**: `111 件 / 600 戦 (18.5%)`
- **Secondary 1000 ステップ完走数**: `0 件` (111 件すべて未完走)
- **Tertiary 2000 ステップ完走数**: `0 件` (111 件すべて未完走)
- **State Hash v2 再帰対戦数**: `0 / 111 件` (最大訪問数: 1)
- **Cycle Fingerprint v1 再帰対戦数**: **`111 / 111 件 (100.0%)`**
- **決定論的サイクル候補 (Deterministic Cycle Candidates)**: **`72 件`**
- **確率的再帰観測 (CYCLE_STATE_RECURRENCE_OBSERVED)**: **`39 件`** (SeededRandom 含む対戦)

---

## 5. Cycle Fingerprint 再帰の詳細 (Cycle Fingerprint Recurrence Analysis)

Cycle State Fingerprint v1 を導入したことで、Phase 3.4 では見えなかった「実質的な状態循環」が明確に可視化された：

- **全 111 件で再帰を観測**: 未完走対戦の 100% において、同一のゲーム論理状態への周期的再訪が確認された。
- **最短再帰ステップ距離 (shortestRepeatDistance)**: **`2`**
  - 最短で 2 ステップ（アクション実行 $\rightarrow$ トリガー解決 $\rightarrow$ 同一盤面）という極めて短い周期で同一状態が再訪されている。
- **最大訪問回数 (maxVisitsObserved)**: **`995 回 / 2000 ステップ`**
  - 1 つの論理状態に対して 995 回もの再訪が記録されており、実質的に同一の処理連鎖が 1000 回近くループしている。
- **決定論的サイクル判定**:
  - `(CycleFingerprint, DecisionRequestFingerprint, SelectedLogicalPatternKey)` の 3 つ組が同一となった対戦が 72 件（決定論的ポリシー対戦の 100%）存在し、これらは数学的に無限ループに陥っていることが確定した。
  - 残り 39 件は SeededRandom を含む対戦であり、RNG 状態が外部にあるため決定論的サイクルとは断定せず、`CYCLE_STATE_RECURRENCE_OBSERVED` として記録した。

---

## 6. ターン進行と Turn 1 / 複数ターン停滞証跡 (Turn Progress Evidence)

- **Turn 1 停滞件数**: 111 件中 99 件（89.2%）において、2000 ステップ経過後も `finalTurnCount = 1`（ターン進行数 `turnsAdvanced = 0`）であった。
- **複数ターン進展後停滞件数**: 111 件中 12 件（10.8%）は Turn 4 または Turn 5 へ進展した後に停滞した。
  - **Turn 4 停滞**: 6 件（`turnsAdvanced = 3`, 全マッチアップの seed m005）
  - **Turn 5 停滞**: 6 件（`turnsAdvanced = 4`, 全マッチアップの seed m035）
- **ターンあたり意思決定数**:
  - Turn 1 停滞群（99 件）: 平均 `2,000 回 / ターン`
  - Turn 4 停滞群（6 件）: 平均 `666.7 回 / ターン`
  - Turn 5 停滞群（6 件）: 平均 `500.0 回 / ターン`
- **進行停止の直接証拠**:
  - Turn 1 停滞群（99件）および Turn 4/5 停滞群（12件）の双方が、特定ターンにおいて Stage スタック上のリクエスト解決とターン終了遷移の処理連鎖を完了できず、意思決定上限（2000）を消費した。

---

## 7. Request Buffer 深度とライフサイクル指標 (Request Buffer & Lifecycle Metrics)

Canonical Match Log の構造化イベントから直接集計した汎用リクエストライフサイクル指標（文字列ログパース不使用）：

- **最大観測バッファ深度 (maxRequestBufferDepth)**: `0`
- **最終バッファ深度 (finalRequestBufferDepth)**: `0`
- **リクエスト生成総数 (requestCreatedCount)**: 平均 `7 件`（最大 `7 件`）
- **リクエスト解決総数 (requestResolvedCount)**: 平均 `4 件`（最大 `4 件`）
- **通常リクエストのステージ移送数 (normalRequestMovedToStageCount)**: `7 件`
- **分析**:
  - Request Buffer に投入されたリクエストは即座に Stage へ移送（`normalRequestMovedToStageCount`）されるか、即時解決されているため、バッファが肥大化・スタックしているわけではない。
  - 初期に 7 件のリクエストが生成・移送された後、新たなリクエストの追加生成は行われていない。

---

## 8. Stage 深度と未解決リクエストの残存 (Stage Depth Corrected Metrics)

`state.stage.requests.length` による正準計測への是正結果：

- **最大ステージ深度 (maxStageDepth)**: `6`
- **最終ステージ深度 (finalStageDepth)**: **`2`** (旧バグによる `0` から是正)
- **分析**:
  - セッション終了時点において、Stage には依然として 2 件の未解決リクエスト（LIFO スタック）が残存した状態で意思決定上限（2000）に到達している。
  - Stage スタックの最上位（TOP: 配列末尾 `state.stage.requests[state.stage.requests.length - 1]`）に積まれたアクション（代表対戦 Case 0 では `action.counter`、全111件集計でも `action.counter` が 83.35%、`action.twist` が 16.35%）が解決・ポップされず、Stage が空（深度 0）になってターン終了判定へ至る遷移が発生していない。

---

## 9. Stage 空 PASS 診断結果の維持 (Stage-Empty PASS Diagnostics)

Core Flow の generic 指標として追跡された Stage 空 PASS 観測結果：

- **Stage 空 PASS 件数**: `0 件`
- **TP=CP Stage 空 PASS 件数**: `0 件`
- **最大連続回数**: `0 回`
- **考察**:
  - 111 件の未完走において、「Stage が空の状態でターンプレイヤーが PASS を選択して停滞している」という仮説は完全に棄却された。
  - 停滞は Stage が空になる前（Stage 深度 $\ge 1$）のアクション処理連鎖内で発生している。

---

## 10. 意思決定種別の客観的内訳と進行発散分類 (Decision Kind Evidence & Divergence Classification)

ログ文字列パースを行わず、実行時データ構造（`record.selectedPatternKind`, `request.source.type`, `state.stage.requests[state.stage.requests.length - 1].actionId`）から動的集計した客観的証跡：

### 代表対戦（Case 0: seed 1468640084）の内訳
- **意思決定種別の内訳 (selectedPatternKindCounts)**:
  - `ACTION`: `7 回`（対戦初期のアクション選択）
  - `PASS`: `1,993 回`（全体の 99.65%）
  - `EFFECT_SELECTION`: `0 回`
- **意思決定要求ソースの内訳 (decisionSourceTypeCounts)**:
  - `ACTION_REQUEST`: `2,000 回`（手札からの通常/クイックアクション選択要求: 100.0%）
  - `EFFECT_RESOLUTION`: `0 回`
- **ステージ最上位アクションIDの内訳 (stageTopActionIdCounts: LIFO スタック末尾要素)**:
  - `action.counter`: `1,989 回`（意思決定時にステージ最上位に積まれていたアクションの 99.45%）
  - `action.up`: `6 回`
  - `action.twist`: `2 回`
  - `action.attack`: `1 回`
  - `action.down`: `1 回`
- **観測されたアクション実行ID (observedActionIdCounts)**:
  - `action.counter`: `2 回`
  - `action.up`: `2 回`
  - `action.attack`: `1 回`
  - `action.down`: `1 回`
  - `action.twist`: `1 回`
- **リクエストライフサイクル指標 (requestLifecycleMetrics)**:
  - `requestCreatedCount`: `7 件`
  - `requestResolvedCount`: `4 件`
  - `immediateResolutionCount`: `0 件`
  - `normalRequestMovedToStageCount`: `7 件`
  - `triggeredRequestObservedCount`: `0 件`

### 全 111 件未完走対戦の総合集計 (Total Across All 111 Incomplete Matches)
- **意思決定要求ソースの総合内訳 (decisionSourceTypeCounts)**:
  - `ACTION_REQUEST`: `221,952 回`（全体の **99.98%**）
  - `EFFECT_RESOLUTION`: `48 回`（全体の **0.02%**）
- **意思決定種別の総合内訳 (selectedPatternKindCounts)**:
  - `ACTION`: `927 回`（全体の 0.42%）
  - `PASS`: `221,025 回`（全体の **99.56%**）
  - `EFFECT_SELECTION`: `48 回`（全体の 0.02%）
- **ステージ最上位アクションIDの総合内訳 (stageTopActionIdCounts)**:
  - `action.counter`: `184,884 回`（全体の **83.35%**）
  - `action.twist`: `36,267 回`（全体の **16.35%**）
  - `action.attack`: `240 回`
  - `action.down`: `156 回`
  - `action.end`: `84 回`
  - `action.draw`: `84 回`
  - `action.up`: `51 回`
  - `action.destroyBulwark`: `21 回`
  - `action.summonSoldier`: `3 回`
  - `action.summonAce`: `3 回`
- **観測されたアクション実行IDの総合内訳 (observedActionIdCounts)**:
  - `action.counter`: `342 回`
  - `action.twist`: `264 回`
  - `action.attack`: `132 回`
  - `action.down`: `99 回`
  - `action.end`: `42 回`
  - `action.up`: `27 回`
  - `action.destroyBulwark`: `15 回`
  - `action.summonSoldier`: `3 回`
  - `action.summonAce`: `3 回`
- **リクエストライフサイクルの総合集計 (requestLifecycleMetrics)**:
  - `requestCreatedCount`: `1,011 件`
  - `requestResolvedCount`: `492 件`
  - `immediateResolutionCount`: `0 件`
  - `normalRequestMovedToStageCount`: `969 件`
  - `triggeredRequestObservedCount`: `42 件`

### 進行発散パターンの是正分類
- **分類内訳**:
  - **`TURN_STALLED_WITH_CYCLE_RECURRENCE`**: **`99 / 111 件 (89.2%)`**（Turn 1 で周期再帰停滞）
  - **`UNKNOWN_DIVERGENCE`**: **`12 / 111 件 (10.8%)`**（Turn 4 または Turn 5 へ進展後に周期再帰停滞）
  - ※ 全 111 件（100.0%）において、`cycleFingerprintRecurrence.repeatedFingerprintVisitCount > 0` による実質的状態再帰が確認されている。
- **メカニズムと停滞の真の根拠**:
  - BlackPoker では、Stage スタック上に未解決リクエストが存在する間、クイックアクション等の機会確認としてプレイヤーへ `ACTION_REQUEST`（`source.type = ACTION_REQUEST`）が提示される。
  - 両プレイヤーが `PASS` を選択し続けても、Stage TOP（`stageReqs[stageReqs.length - 1]`）にある未解決リクエスト（Case 0 では `action.counter`、他対戦では `action.twist` 等）が解決・ポップされない場合、Stage 深度が維持されたまま再度 `ACTION_REQUEST` が提示され、両者が再び `PASS` を選択する無限循環に陥る。
  - これにより、`ACTION_REQUEST` に対する `PASS` 選択が延々と反復され（全決定の 99.5% 以上）、ターン進行およびゲーム進行が停止する。

---

## 11. エビデンスから確実に言えること (What the Evidence Proves)

1. **実質的状態再帰の存在**:
   - 単調カウンタを除外したゲーム論理状態（CSF1）において、111 件全件（100.0%）で周期再帰が発生しており、最短 2 ステップでの循環が確認された。
2. **決定論的サイクルの確定**:
   - 非 RNG 対戦（72 件）において、同一の `(CycleFingerprint, RequestFingerprint, SelectedPatternKey)` が反復されており、決定論的無限ループに陥っている。
3. **Stage 上の未解決リクエスト残存と `ACTION_REQUEST` 停滞**:
   - 111 件中 99 件は Turn 1 で停滞し、12 件は Turn 4 または 5 へ進んだ後に停滞した。いずれも Stage 深度が維持されたまま、Stage TOP に未解決リクエスト（全体で `action.counter` が 83.35%、`action.twist` が 16.35%）が残存し、`ACTION_REQUEST` に対する `PASS` が数千回繰り返されている。
   - 「無限にリクエストが生成されている」のではなく、「未解決リクエストが Stage 上に残ったまま、`ACTION_REQUEST` に対する PASS 選択の循環によってリクエスト解決・ターン進行へ進まない」ことが確定した。
4. **Stage 空 PASS 仮説の否定**:
   - `Stage 深度 0 かつ TP=CP` での PASS は 0 件であり、停滞の原因は Stage が空になった後の PASS ではない。
5. **ポリシー無差別の原因**:
   - 複数選択肢局面（13.6%）において、全候補同点タイおよび同一アクション種別タイが発生し、最小 patternRef 優先タイブレークにより全ポリシーが同一インデックスを選択している。

---

## 12. エビデンスからまだ言えないこと (What Remains Unproven)

1. **`action.counter` / `action.twist` やクイックアクション機会判定の有責性**:
   - Stage 最上位に `action.counter` や `action.twist` が残存した状態で `ACTION_REQUEST` への PASS が繰り返されているが、これが特定アクション独自の実装不備によるものか、Stage のクイックアクション処理／スタック解決遷移全般の設計によるものかは、Core Flow 実装の詳細検証を待つ必要がある。
2. **PASS 選択時の Stage 解消遷移仕様**:
   - Stage 上にリクエストが存在する状態で両者が PASS を選択した場合に、最上位リクエストが解決・破棄されて Stage からポップされるべきか、どのような条件で解決遷移が進むべきかは、BlackPoker の公式ルール・Core Flow 設計仕様に基づく判断が必要である。

---

## 13. Core Flow 修正候補への提言 (Core Flow Repair Candidates)

Phase 3.4.1 の補修エビデンスを踏まえ、次作業（Phase 4 等）において検証・修正すべき Core Flow 側の候補：

1. **Stage 上のアクション滞留と `ACTION_REQUEST` における PASS 処理・解決完了遷移**:
   - Stage 上に未解決リクエストが存在する際の `ACTION_REQUEST` に対し、プレイヤー双方が PASS を選択した際、最上位リクエスト（`action.counter` 等）が適切に解決・ポップされ、次の処理またはターン進行へ進む遷移の確認・整備。
2. **トリガー即時解決・Stage 移送後の後続遷移**:
   - 即時誘発（`action.charge`）や通常誘発（`action.draw`）の処理後、Stage に残されたリクエストのライフサイクルが正しく終了判定へ至るかの検証。
3. **ターン内アクション使用制限 (Turn Usage Limits)**:
   - ターン開始時アクションや特定補助アクションに対する使用回数上限（Turn Usage Guard）が適切に機能しているかの確認。

---

## 14. AI 側ポリシー診断のまとめ (AI Policy Distinguishability Summary)

- **反実仮想比較対象要求数**: `87,888 件`
- **単一選択肢要求数**: `75,894 件 (86.4%)`
- **複数選択肢要求数**: `11,994 件 (13.6%)`
- **FirstLegal vs ZeroGenome 一致率**: `100.0%`
- **FirstLegal vs ManualGenericGenome 一致率**: `100.0%`
- **ZeroGenome vs ManualGenericGenome 一致率**: `100.0%`
- **Feature Collision と Argmax Tie の共起率**: `63.13% (7,314 件)`
- **考察**:
  - ポリシーの差別化を実現するには、Core Flow の完走性確保に加えて、特徴量エンコーダーの解像度向上（Feature Collision 解消）と、アクション差別化重みの付与が不可欠である。

---

## 15. 次フェーズへの推奨事項 (Next Recommendations)

1. **最優先**: Core Flow の未完走原因（Turn 1 内の処理連鎖ループ）の特定と修正。
2. **次点**: Core Flow 完走確認後のベースライン再測定（Phase 3.3 再実行）。
3. **その後**: Feature Schema の拡張（打点、対象、コスト等の差別化特徴量追加）および遺伝的学習（Fitness、交叉、突然変異）の実装。

---

## 16. 決定論的再現性の検証 (Repeatability Verification)

- **Run A Digest**: `0ee51e74dc28ab761123f58ff2d58a26757bc85445ff43428e745bdd42cceb20`
- **Run B Digest**: `0ee51e74dc28ab761123f58ff2d58a26757bc85445ff43428e745bdd42cceb20`
- **一致判定**: `true`
- **論理的一致性 (Exact Logical Equality)**: `true`
- **診断実行時エラー**: `0 件`
- **Phase 3.3 ベースラインダイジェスト維持**: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4` (完全一致)
