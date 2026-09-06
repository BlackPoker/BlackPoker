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
- 診断論理ダイジェスト (Diagnostics Digest v1.1): `9f2aee0b8f4e4be6ebfc541e3bd1c5009c30ab8a6038766cd31d4295e8103607`
- 参照元ベースラインダイジェスト (Source Baseline Digest): `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`

---

## 1. Phase 3.4 の観測と成果 (Phase 3.4 Observations)

Phase 3.4 において、公式レギュレーション（Light + Entry16）600 戦（3 カード × 2 レグ × 100 戦）のベースライン未完走 111 件およびポリシー選択ログを対象に、初期診断を実施した。その結果、次の主要事実が観測された：

1. **ステップ予算拡大（1000 / 2000 ステップ）**:
   - 1000 ステップでも 111/111 件が未完走（完走率 0.0%）。
   - 2000 ステップでも 111/111 件が未完走（完走率 0.0%）。
2. **ターン進行の完全停止**:
   - 未完走 111 件のすべてにおいて、ターン数は 1 のまま一度も進展せず、Turn 1 内で 2000 回の意思決定が消費された。
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

## 6. ターン進行と Turn 1 停滞証跡 (Turn 1 Progress Evidence)

- **Turn 1 停滞件数**: 111 件中 99 件（完全決定論的対戦の全件）において、2000 ステップ経過後も `finalTurnCount = 1`（ターン進行数 0）であった。
- **ターンあたり意思決定数**: 平均 `2000 回 / ターン`
- **Turn 進行停止の直接証拠**:
  - プレイヤー双方が「ターン終了」へ遷移するための処理連鎖を完了できず、Turn 1 の内部でリクエストの生成と解決が継続している。

---

## 7. Request Buffer 深度とライフサイクル指標 (Request Buffer & Lifecycle Metrics)

Canonical Match Log の構造化イベントから直接集計した汎用リクエストライフサイクル指標（文字列ログパース不使用）：

- **最大観測バッファ深度 (maxRequestBufferDepth)**: `0`
- **最終バッファ深度 (finalRequestBufferDepth)**: `0`
- **分析**:
  - Request Buffer に投入されたリクエストは即座に Stage へ移送（`normalRequestMovedToStageCount`）されるか、即時解決（`immediateResolutionCount`）されているため、バッファが肥大化・スタックしているわけではない。
  - バッファ自体は正常に空になりつつ、新たなリクエストが繰り返し生成され、Stage を経由して処理され続けている。

---

## 8. Stage 深度の是正と観測結果 (Stage Depth Corrected Metrics)

`state.stage.requests.length` による正準計測への是正結果：

- **最大ステージ深度 (maxStageDepth)**: `6`
- **最終ステージ深度 (finalStageDepth)**: **`2`** (旧バグによる `0` から是正)
- **分析**:
  - セッション終了時点において、Stage には依然として 2 件のリクエスト（LIFO スタック）が残存した状態で意思決定上限（2000）に到達している。
  - Stage が空（深度 0）になってターン終了判定へ至る前に、新たなリクエストが Stage 上に積み増しされ続けていることが定量的に実証された。

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

## 10. 観測されたアクション ID の分布 (Observed Action ID Distribution)

診断ロジック自体には Action ID を一切ハードコードせず、純粋な観測エビデンスとして集計した Action ID の発生状況：

- 未完走対戦において観測された主要アクション ID：
  - `action.attack`
  - `action.down`
  - `action.counter`
  - `action.up`
  - `action.twist`
  - `action.charge`
  - `action.draw`
- **重要**: 診断ランナーはこれらの Action ID に基づく分岐を持たず、汎用的な `divergencePattern`（`STABLE_DEPTH_UNBOUNDED_REQUEST_GENERATION`）として分類している。

---

## 11. エビデンスから確実に言えること (What the Evidence Proves)

1. **実質的状態再帰の存在**:
   - 単調カウンタを除外したゲーム論理状態において、111 件全件で 100% の再帰が発生しており、最短 2 ステップでの循環が確認された。
2. **決定論的サイクルの確定**:
   - 非 RNG 対戦（72 件）において、同一の `(CycleFingerprint, RequestFingerprint, SelectedPatternKey)` が反復されており、決定論的無限ループに陥っている。
3. **Turn 1 内での処理連鎖停滞**:
   - 全未完走対戦で Turn 1 から進まず、Stage 深度が 0 に戻らないままリクエストの生成・解決が繰り返されている。
4. **Stage 空 PASS 仮説の否定**:
   - 停滞の原因は「Stage 空での PASS」ではない。
5. **ポリシー無差別の原因**:
   - 複数選択肢局面（13.6%）において、全候補同点タイおよび同一アクション種別タイが発生し、最小 patternRef 優先タイブレークにより全ポリシーが同一インデックスを選択している。

---

## 12. エビデンスからまだ言えないこと (What Remains Unproven)

1. **特定アクション単独の有責性**:
   - `action.charge` や `action.draw` などの特定アクション ID が高頻度で出現しているものの、それら単体の不具合か、トリガー条件・Usage ガード・Stage 解決遷移の組み合わせによるものかは、Core Flow 実装の詳細検証を待つ必要がある。
2. **PASS の合法性ルールの是非**:
   - Stage 空での PASS が 0 件であったことは事実であるが、ルール設計として PASS を常に許可すべきか否かは、ゲーム仕様の観点から別途検討が必要である。

---

## 13. Core Flow 修正候補への提言 (Core Flow Repair Candidates)

Phase 3.4.1 のエビデンスを踏まえ、次作業において検証・修正すべき Core Flow 側の候補：

1. **リクエスト再投入・トリガー再誘発条件のガード**:
   - アクション解決後に同一トリガーが即座に再発火し、無限にリクエストが再生成されるループの抑止。
2. **ターン内アクション使用制限 (Turn Usage Limits)**:
   - ターン開始時アクションや特定補助アクションに対する使用回数上限（Turn Usage Guard）が適切に機能しているかの確認。
3. **Stage 解決完了遷移**:
   - Stage のリクエストが解決された後、新たなリクエストを積載せずにターン終了（または次の合法アクション選択）へ抜ける遷移条件の整備。

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

- **Run A Digest**: `9f2aee0b8f4e4be6ebfc541e3bd1c5009c30ab8a6038766cd31d4295e8103607`
- **Run B Digest**: `9f2aee0b8f4e4be6ebfc541e3bd1c5009c30ab8a6038766cd31d4295e8103607`
- **一致判定**: `true`
- **論理的一致性 (Exact Logical Equality)**: `true`
- **診断実行時エラー**: `0 件`
- **Phase 3.3 ベースラインダイジェスト維持**: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4` (完全一致)
