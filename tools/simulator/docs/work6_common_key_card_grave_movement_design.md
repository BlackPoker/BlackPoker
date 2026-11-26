# 作業6：共通キーカード墓地移動処理 設計・監査レポート

- **関連 Issue**: `#551` (`BlackPoker/BlackPoker`)
- **対象ブランチ**: `BlackPoker/issue551-core-flow`
- **基準コミット (作業6開始前 HEAD)**: `b5714393b20e315b126ac08b801a34ad81374ade`
- **ドキュメント種別**: 作業6 共通キーカード墓地移動修正 設計・分類監査・検証記録

---

## 1. 修正目的と公式ルール対応

### 1.1 従来の不具合と根本原因
作業6以前は、`tools/simulator/src/engine/rules/CommandRegistry.ts` の `finalizeRequestKeyCards()` が残存キーカードを `for` ループにより **1枚ずつ順次** `GraveTopCoordinator.addCardToGrave` へ投入していた。このため、複数枚のキーカードを持つリクエスト（`action.surprise`, `action.kill`, `action.reverse`, `action.rsf`, `action.swordRain`, `action.bj`, `action.recruit` 等）を解決・打ち消しした際、以下の公式ルール違反が発生していた。

1. **同時移動の欠落**: 最後の1枚が常に機械的に墓地 TOP となり、`ZONE_TOP_SELECTION`（`reason: "MULTI_CARD_GRAVE_MOVE"`）が発生しない。
2. **解決完了境界の不整合**: キーカード墓地TOP選択の完了前にリクエスト解決が完了してしまうリスクへの根本制御が不足していた。
3. **ゾーン判定の不備**: `cardUtils.ts` の `isCardInGameZones()` が `unit?.card?.id` および `player.trumps` を走査しておらず、既配置カードの誤検出余地があった。

### 1.2 公式ルール v9.1.2 準拠仕様
本修正は新規ゲームルールの追加ではなく、公式ルール v9.1.2 の既存規定を共通基盤に正確に実装したものである。

| ルール節 | 要件内容 | 本修正での担保箇所 |
|---|---|---|
| 5.4.3〜5.6 | 効果により他領域へ移動しなかった残存キーカードを、解決完了／打ち消し時にコントローラーの墓地へ移動 | `CommandRegistry.finalizeRequestKeyCards`, `isCardInGameZones` |
| 6.1.1 | 同時に複数枚のカードが墓地へ移動した場合、その移動カードの集合からのみ墓地 TOP を選択（1枚時は自動TOP、0枚時は移動なし） | `GraveTopCoordinator.addCardsBatchToGrave` + `ZONE_TOP_SELECTION` |
| 10.6 / Stage 解決境界 | 墓地 TOP 選択が保留されている間は、リクエスト完了・Stage 履歴確定・勝敗判定・誘発解決・手番/チャンス返却・次リクエスト進行を行わない | `EffectContinuation` (`REQUEST_KEY_CARD_FINALIZATION_STEP_ID`, `CANCELLED_REQUEST_KEY_CARD_FINALIZATION_STEP_ID`) |

---

## 2. アーキテクチャ設計と作業6B 不具合（分類 D）の根本解消

### 2.1 作業6B 試作版における設計上の欠陥（分類 D 監査）
作業6B の初期試作では、`state.pendingRequestFinalizations` キューと `GameSession.advance()` 内 Step `0.7` を用いてキーカード後処理を遅延させていたが、以下の構造的不備が確認された。

1. `finalizeRequestResolution` が `status: "resolving"` のまま偽の `{ type: "COMPLETED" }` を返却してしまい、`CommandRegistry` / `EffectInterpreter` を直接利用する低レベル実行経路や通常再開フロー（`reverse` 17.1 等）と契約が衝突した。
2. `finalizeRequestKeyCards` がループ開始前に全要素の妥当性（`isDirectCard` 判定・ID重複）を一括検証していなかったため、不正カード混入時に先頭カードだけ移動する部分状態破壊を起こし得た（`KT-09`, `KT-10`）。
3. `executeAction` が `resolveRequest` / `resolveTopRequest` の中断戻り値を呼び出し元へ返却せず、`resolveRequest` のキャンセル時分岐でも中断返却が統一されていなかった。

### 2.2 作業6C/6D 採用アーキテクチャ（`EffectContinuation` 一本化）
上記を踏まえ、`pendingRequestFinalizations` および Step `0.7` を完全撤廃し、既存の `EffectContinuation` / `resumeRequest` 機構へ統一した。

- **定数定義 (`tools/simulator/src/engine/session/GameSession.ts`)**:
  - `REQUEST_KEY_CARD_FINALIZATION_STEP_ID = "requestKeyCardFinalization"`
  - `CANCELLED_REQUEST_KEY_CARD_FINALIZATION_STEP_ID = "cancelledRequestKeyCardFinalization"`
  - `EffectContinuation` に JSON セーフな `finalizationOptions` を追加（Snapshot V2 で無損失保存・復元可能）。

#### 処理フロー（通常リクエスト / 即時アクション / 対象喪失フィズル）
1. 通常リクエストは解決開始時点では Stage 上に保持され（公式ルール 5.4.5〜5.4.7）、対象有効性検証および効果（`EffectInterpreter`）を実行する。対象喪失時は `effectExecuted: false`（`effectSkipped: true`）として効果本体をスキップしつつ `finalizeRequestResolution` へ進む。
2. `finalizeRequestResolution` は、まず Stage 先頭から対象リクエストを1回だけ除去（`stage.popped`）し、続いて `finalizeRequestKeyCards` を呼び出す。
3. `finalizeRequestKeyCards` は `isDirectCard` チェックと重複 ID チェックを **状態変更前に全要素一括** で実施したうえで（fail-closed 原子的拒否）、`isCardInGameZones` に該当しない残存 `request.keyCards` を抽出する。
   - **0枚**: 移動なし。
   - **1枚以上**: `GraveTopCoordinator.addCardsBatchToGrave` へ一括渡し（1枚なら自動TOP、`2枚以上` なら `ZONE_TOP_SELECTION` をキュー積載）。
   - `logRecorder` が引数・コンテキストに無い場合は `(effectInterpreter as any)?.registry?.logRecorder` へフォールバック。
4. `finalizeRequestKeyCards` により `pendingGraveTopSelections` が発生した場合、`finalizeRequestResolution` は `request.status` を `"resolving"` のまま維持し、`stage.history` 追加・`request.resolved` 記録・`actionResolved` 発行を行わずに `{ type: "WAITING_FOR_DECISION", continuation: { effectStepId: REQUEST_KEY_CARD_FINALIZATION_STEP_ID, finalizationOptions } }` を返却する。
5. `ZONE_TOP_SELECTION` 選択後に `resumeRequest`（`action`/`action.effect` 存在チェックより前の最上位分岐で処理）が呼ばれると、`completeRequestResolutionBody` を実行し、ここで初めて `status = "resolved"` 確定・`stage.history` 追加・`request.resolved` 記録・`actionResolved` 発行を行う。

#### 処理フロー（カウンター・トラップカウンターによる打ち消し：`cancelStageRequest`）
1. 解決中のカウンター（例: `action.counter` 解決中は規則 5.4.5〜5.4.7 に従いカウンター自身は `stage.requests` 上に留まる、即時 `action.trapCounter` は Stage 未積載で `resolvingRequest` として実行）が `cancelStageRequest(targetRequest, ...)` を実行する。
2. 被カウンター側 `targetRequest` を即座に `stage.requests` から除去し（`request.cancelled` 記録、`request.resolved` は一切記録しない）、`targetRequest.keyCards` の残存分のみを `targetRequest.controller` の墓地へ同時移動する。
3. 2枚以上の残存キーカードがあった場合、カウンター自身の残余効果・自身のキーカード後処理よりも **先に**、被カウンター側所有者の `ZONE_TOP_SELECTION` で中断する。候補にはカウンター側のキーカードは一切混在しない。
4. 被カウンター側の墓地 TOP 選択完了後にカウンター側の処理とキーカード後処理が進む。もし通常キャンセル側が自身の残余処理ではなく `resolveRequest` のキャンセル側経路で `CANCELLED_REQUEST_KEY_CARD_FINALIZATION_STEP_ID` に停滞した場合も、`resumeRequest` が同一の中断前リクエストに対して重複のない履歴・解決完了抑止を維持して再開する。

#### 効果による墓地移動バッチとキーカード墓地移動バッチの厳格分離
- `action.swordRain`（破壊された兵士群）、`action.bj`（バーストした公開ライフ群）、`action.deathLance`（自傷ダメージ群）、`action.recruit`（超過ライフ順序選択）等の **効果中バッチ** は `EffectInterpreter` の中断により先に完結し、その完了後に `finalizeRequestResolution` が **別の独立バッチ** として残存キーカードを `addCardsBatchToGrave` へ渡す。したがって両者の候補集合やプレイヤー帰属が混在することはない。
- 逆に、`action.force`（フォグへ移動）や `action.unsummons`（手札へ返還）のように効果中でキーカードが他ゾーンへ移された場合、`isCardInGameZones` により残存キーカード 0枚と判定され、解決完了時の誤った墓地移動や二重移動は起きない。

---

## 3. 主要変更ファイル一覧

### コアエンジン・CLI
- `tools/simulator/src/engine/session/GameSession.ts`: `REQUEST_KEY_CARD_FINALIZATION_STEP_ID`, `CANCELLED_REQUEST_KEY_CARD_FINALIZATION_STEP_ID`, `EffectContinuation.finalizationOptions` 追加、旧 Step `0.7` (`pendingRequestFinalizations`) 削除
- `tools/simulator/src/engine/rules/CommandRegistry.ts`: `finalizeRequestKeyCards` 原子的事前検証＆`logRecorder` フォールバック、旧 `pendingRequestFinalizations` 撤廃、`finalizeRequestResolution` / `completeRequestResolutionBody` / `cancelStageRequest` / `resolveRequest` / `resumeRequest` / `executeAction` 統一
- `tools/simulator/src/engine/rules/cardUtils.ts`: `isCardInGameZones` に `unit?.card?.id` および `player.trumps` 判定を追加
- `tools/simulator/src/cli/scenarioRunner.ts`: `setupRegistryHook` 戻り値返却、`drainResolutionDecisions`, `executeActionWithDecisions`, `resolveTopRequestWithDecisions` による決定論的 `ZONE_TOP_SELECTION` 解決対応

### Snapshot / Replay / Undo 互換性仕様
- **Snapshot V2 (`GameSessionSnapshotCodec`)**: `session.resolvingRequest` と `session.continuation`（`finalizationOptions` 含む JSON セーフ構造）をそのまま直列化・復元するため、`REQUEST_KEY_CARD_FINALIZATION_STEP_ID` 停止中のキャプチャ／リストア後に同一決定を投入すると `StateHasher.hash(state)` および後続イベント列が完全一致する。
- **Replay / Undo (`ReplayReconstructionService.reconstructMatch`)**: 作業6適用後は 2枚以上キーカード解決地点で `ZONE_TOP_SELECTION` が1決定として決定ログに挿入される。したがって：
  - 作業6準拠トランスクリプト（例: `undoRareSetupReconstruction.test.ts` の `DIAGNOSTIC_TRANSCRIPT_SEQ_1_TO_26` および `work6KeyCardGraveE2E.test.ts`）では完全再現および別候補への Undo 分岐再構成が `SUCCESS` となる。
  - 作業6以前の旧形式トランスクリプト（例: `LEGACY_PRE_WORK6_TRANSCRIPT_SEQ_1_TO_25`）は該当箇所（`seq >= 15`）で意図どおり `DIVERGED`（`PATTERN_REF_OUT_OF_RANGE` 等）として安全に不整合検出される。

---

## 4. 新規テスト・強化テスト仕様

### 4.1 共通キーカード墓地移動単体テスト (`commonKeyCardGraveMovement.test.ts` / `KT-01`〜`KT-10`)
10件すべて PASS：
- `KT-01`: 残存キーカード0枚の場合、墓地および墓地TOPを変更せず決定も要求しない
- `KT-02`: 残存キーカード1枚の場合、決定不要でそのカードが自動的に墓地TOPになる
- `KT-03`: 残存キーカード2枚の場合、同時移動し2枚のみが `ZONE_TOP_SELECTION` 候補になる
- `KT-04`: 残存キーカード3枚・5枚の場合、全移動枚数がTOP選択候補に含まれる
- `KT-05`: 既存墓地カードがある場合でも、新規移動キーカードのみがTOP選択候補になる
- `KT-06`: 一部のキーカードが効果によって他ゾーンへ移動済みの場合、残存カードのみを移動する（残1枚なら選択不要）
- `KT-07`: 全キーカードが効果によって他ゾーン(`fog`/`field`/`hand`/`trumps`等)へ移動済みの場合、墓地移動しない
- `KT-08`: `keyUnits` は共通キーカード墓地移動の対象に含めない (`keyCards` のみ対象)
- `KT-09`: 重複した物理カードIDを含む不正リクエストを fail-closed で拒絶し部分移動を起こさない
- `KT-10`: 不正カード(`suit`/`rank`欠落, ID欠落, `Unit wrapper`混入)を含む場合は事前検証で例外を投げ、先頭カードも含め部分移動を一切起こさない

### 4.2 統合・E2E 検証テスト (`work6KeyCardGraveE2E.test.ts` / 15件)
15件すべて PASS：
1. `action.surprise` (奇襲): 2枚キー同時移動・非先頭候補指定による `graveTopCardId` 反映・`enteredFieldTurn` 継承と `action.attack` 召喚酔い判定
2. `action.swordRain` (剣の雨): P1破壊兵士バッチ／P2破壊兵士バッチ／P1キーカード2枚バッチの厳密分離・非混在
3. `action.bj` (B・J): バースト経路（公開カード群 → キーカード群の2バッチ分離）およびスタンド経路（公開カードは手札、キーカード群のみ墓地TOP選択）
4. `action.force` (フォース): 解決時 Fog 移動によるTOP選択なし、ターン終了時 `cleanupFogsHandler` による墓地移動
5. `action.recruit` (徴募): 効果中の `recruitUnitsFromLife` 順序選択後にキーカード2枚TOP選択が走り、効果二重実行が起きないこと
6. `action.rsf` (R・S・F): 5枚同時移動と、相手ライフ0到達時でも5枚墓地TOP選択完了まで `FINISHED` 遷移・勝敗確定を遅延すること
7. 通常カウンター (`action.counter`) による2枚キー `action.kill` 打ち消し：8段階順序（`kill` Stage即除去・解決中 `counter` 規則 5.4.5〜5.4.7 Stage残存・`kill` 所有者先行TOP選択・候補非混在・`counter` 1枚キー後処理・`kill` の `cancelled` 確定・`request.resolved` 未記録・対象兵士生存）
8. 即時トラップカウンター (`action.trapCounter`) による2枚キー `action.reverse` 打ち消し：Stage 未積載・`samePrintedCard` 一致時のみ `reverse` 除去・P1 TOP選択後の P2 レアキー後処理
9. 打ち消し不可のマスター4アクション (`action.swordRain`, `action.force`, `action.surprise`, `action.recruit`) が `action.counter` 対象外であること
10. 対象喪失不発 (`action.kill` LIFO 対象喪失): `effectSkipped: true` でも2枚キー同時墓地移動とTOP選択後に `request.resolved` が記録されること
11. `action.unsummons` (帰還): 2枚キーカード手札返還時の墓地移動0枚・TOP選択なし
12. 即時 (`immediate`) 2枚キーアクション：Stage 未経由のまま `resolvingRequest` 上で `REQUEST_KEY_CARD_FINALIZATION_STEP_ID` 停止・完了すること
13. 停止境界不変条件 & Snapshot V2 (`GameSessionSnapshotCodec`) 中断・復元後の `StateHasher` 完全一致およびイベント順序（`card.moved` → `decision.requested` → `zone.top.changed` → `request.resolved`）
14. 公式 `mast-strategy` (`startMatchAttempt`) 全チェックポイント保存則 (`verifyCardConservation`)、`reconstructMatch` Replay 再現、別候補への Undo 分岐、`selectAutoGraveTopCandidate` 決定論性
15. `core-battle` および全7公式レギュレーションでの起動・進行・保存則スモーク

---

## 5. 作業6B 失敗46件（既存21ファイル）の全件分類・是正表

すべての失敗は原因分類（A〜E）に従って精査し、既存アサーションの削除や無根拠な回避策、および過去の Holdout／DNA／Evidence JSON ファイルの上書きを一切行わずに解消した。

| 分類 | 対象ファイル数・箇所 | 原因内容と対処 |
|---|---|---|
| **A (意思決定対応追加・低レベル8ファイル)** | `kill.test.ts` (25.1 & 27.1, 30.1) / `truce.test.ts` (5.1, 8.2, 9.1) / `reunion.test.ts` (35.1) / `reverse.test.ts` (5.2, 5.3, 15.1, 15.2, 17.1) / `counterPlaytestVisibility.test.ts` (E) / `keyCardLifecycle.test.ts` (12) / `genericTacticalCoreConsistency.test.ts` (2-1) / `proRarePackComprehensiveAudit.test.ts` (`ActionExecutionHarness` および 2.4系/2.6系/3.2〜3.4) | 複数キーカードの正当な `ZONE_TOP_SELECTION` 中断に対し、テストおよび共通ハーネス（`ActionExecutionHarness.resolveAllCommandDecisions` 等）へ墓地TOP選択・再開ステップを追加 |
| **A (意思決定対応追加・E2E 8ファイル)** | `standardDeathLance.test.ts` (Test 30) / `standardHandes.test.ts` (Test 5, 8, 10) / `standardReanimate.test.ts` (Test 10, B, C, F Case F3/F4) / `search.test.ts` (37) / `masterWork3BActions.test.ts` (4.2) / `masterWork3CActions.test.ts` (2.4) / `changeTarget.test.ts` (`resolveStageTopWithPasses`, 9.4) / `surpriseAttackEligibility.test.ts` (`resolveStageToEmpty`) | `GameSession` 進行ヘルパーおよび個別シナリオで効果後・キーカード後の `ZONE_TOP_SELECTION` を明示検証し、正しい決定順で解決完了まで進行するよう更新 |
| **B (決定論的再現系列の正当変化 5ファイル)** | `standardHardening.test.ts` (R1) / `deterministicReplay.test.ts` (Test 4) / `largeScaleBatchBenchmark.test.ts` (Test 10: Match 0, 250, 499 / Test 15: Match 0, 500, 999 / Test 20: Match 0, 5000, 9999) / `genomeSensitivity.test.ts` (11) / `undoRareSetupReconstruction.test.ts` (Test B, C) | 2枚以上キーカード使用時の `ZONE_TOP_SELECTION` 追加により RNG 消費系列およびトランスクリプト長が正当に変化。過去の Evidence/Holdout/DNA JSON は保持したまま実測一致期待値へ更新し、`undoRareSetupReconstruction.test.ts` には作業6前後トランスクリプト両面の検証を実装 |
| **C (ランナー中断対応)** | `src/cli/scenarioRunner.ts` | シナリオ実行ヘルパーに `drainResolutionDecisions` / `executeActionWithDecisions` / `resolveTopRequestWithDecisions` を追加し、8シナリオ全件の決定論的中断・再開を実装 |
| **D (作業6B実装不備の修正)** | `GameSession.ts` / `CommandRegistry.ts` / `cardUtils.ts` | 偽の `COMPLETED` を返していた `pendingRequestFinalizations` + Step `0.7` を廃止して `EffectContinuation` へ統一、`finalizeRequestKeyCards` の事前一括検証（原子的例外送出）、`isCardInGameZones` の `unit?.card?.id`・`trumps` 対応を実施 |
| **E (Fixture・仕様確認)** | `commonKeyCardGraveMovement.test.ts` (`KT-06`, `KT-09`, `KT-10`) / `work6KeyCardGraveE2E.test.ts` | Fixture のスート・ランク整合化、重複ID拒否と不正カード混入原子性テスト分離、および公式規則 5.4.5〜5.4.7・`targetConditionUtils.ts` の仕様整合をテスト上で明確化 |

---

## 6. 全体検証サマリー（Docker `bp-simulator` 内実行結果）

以下の全検証コマンドについて、最終コード・ドキュメント確定後に Docker (`bp-simulator`, `/src/tools/simulator`) 内で終了コード `0` を確認済み（SKIP = 0, FAIL = 0）。

- `npm test`: **282 テストファイル PASS / 3,913 テスト PASS / 0 FAIL / 0 SKIP**
- `npm run build` (`tsc && vite build`): **成功**
- `npm run playable:check`: **成功** (`CORE-BATTLE-001` 対局成立・完了)
- `npm run compare:rules-vnext`: **成功**
- `npm run scenario:rules-vnext`: **成功** (シナリオ 1〜8 全件 PASS)
