# BlackPoker Simulator 第9.2版コアフロー適合化：調査・設計判断・Phase 1 実装計画書

- **文書ID**: BP-SIM-COREFLOW-V92-MIGRATION-PLAN-V3
- **更新日**: 2026-10-29 (Phase 1 最終設計判断・実装反映版)
- **対象リポジトリ**: `BlackPoker/BlackPoker`
- **対象ブランチ**: `BlackPoker/issue551-core-flow`
- **基準コミット（Git SHA）**: `6dd18d86a849728e3fbaf7f0d4401ac0377e5d51` (merge: origin/masterの公式ルール改訂(第9.2版/Issue #642)を取り込み)
- **祖先コミット**: `origin/master` (`5249f3c71ef0f41f63b70467ed3d42116c060cea`)
- **共通祖先（Merge Base）**: `bad23d3cc07c966a3f03a9cd958a071d6c447eac`

---

## 1. 調査時点のGit SHAと作業ツリーの状態

### 1.1 Git状態の確認
作業開始時の `git status -sb`、`git log -1 --oneline`、および祖先関係の確認結果：

```text
## BlackPoker/issue551-core-flow...origin/BlackPoker/issue551-core-flow
6dd18d86a merge: origin/masterの公式ルール改訂(第9.2版/Issue #642)を取り込み
ancestor check exit code: 0
```

- **基準作業ツリー**: クリーン（`6dd18d86a849728e3fbaf7f0d4401ac0377e5d51`）
- **公式ルール取り込み確認**: `git merge-base --is-ancestor 5249f3c71 HEAD` が正常終了（コード 0）し、Issue #642 の公式ルール改訂を含む `master` の全内容が確実に取り込まれていることを確認。

---

## 2. 変更前テスト・ビルドの基準結果

Docker コンテナ `bp-simulator`（Node.js 20-slim、作業ディレクトリ `/src/tools/simulator`）内において、改修前に取得した基準値は以下の通りです。

| コマンド | 判定 | テスト件数 / 詳細 | 所要時間 | 失敗テストと原因 | 備考 |
| :--- | :---: | :--- | :---: | :--- | :--- |
| `npm test` | **成功** | 204 / 204 files passed<br>2,856 / 2,856 tests passed (100%) | 184.12s (全体188.41s) | なし | 全テスト合格 |
| `npm run build` | **成功** | 305 modules transformed<br>`dist/` 生成完了 | 12.88s | なし | ビルド成果物はクリーンアップ済み |
| `npm run playable:check` | **成功** | CORE-BATTLE-001 (1戦通しの全コアフロー完走) | 約21s | なし | 勝者: Player A (Turn 3決着) |
| `npm run scenario:rules-vnext` | **失敗** | シナリオ1 (アップ・エンド): 成功<br>シナリオ2 (ダウン): 成功<br>シナリオ3 (防壁破壊〜世代交代): 失敗 | 約20s | `ValidationError: キーカード 'key-heart-A' が指定元ゾーン 'hand' に存在しません。` (`scenarioRunner.ts:453`) | マージ前から存在する既知のテストフィクスチャ不備（非回帰） |
| `npm run compare:rules-vnext` | **成功** | 比較レポート正常出力 (`rules-vnext-compare.md`) | 約20s | なし | 生成差分はクリーンアップ済み |

---

## 3. 公式ルールの変更内容（第9.2版）と改修内容の対照表

公式ルールの正本（`source/core/core.rst`、`source/core/coreflow.puml`、`source/revision-history/9.2th.rst`）の規定と、Phase 1 で反映した実装仕様の対照表です。

| 項目 / 処理番号 | 公式ルール第9.2版（正本）の規定 | 旧シミュレーター実装の状態 | Phase 1 実装仕様（最終方針） |
| :--- | :--- | :--- | :--- |
| **1. ゲーム開始時**<br>`[1]` | 先攻プレイヤーを決定し、そのプレイヤーに**ターン、チャンス、フォーカス**の3要素を設定する。 | `TurnManager.startTurn` により `turnPlayer`, `chancePlayer` のみ設定。<br>`focusPlayer` は存在しない。 | `TurnManager.startTurn`, `initializeToMain`, 各種セットアップ処理で `turnPlayer`, `chancePlayer`, `focusPlayer` の3要素すべてを先攻プレイヤーに設定。 |
| **2. チャンス・フォーカスの確認と移動**<br>`[2]` | 次のいずれかの場合、チャンスとフォーカスを**現在のターンプレイヤー(TP)**に設定する：<br>① いずれのプレイヤーもチャンスを持たない（**ルールシステム保持 `"system"` を含む**）<br>② **ステージにリクエストが存在しない**<br>それ以外は両方を維持する。 | ステージ空時でも直前のチャンス保持者が維持され、空ステージでの全員パスで初めて `turnPlayer` に戻す処理が存在。 | `GameSession.advance()` のステップ `[2]` にて、`chancePlayer === "system"`（または未保持）もしくは `stage.requests.length === 0` の場合、`chancePlayer = turnPlayer` かつ `focusPlayer = turnPlayer` に設定。それ以外は両方を維持。 |
| **3. パスの合法性判定**<br>`[3]` | **ステージにリクエストが存在する場合のみパスを選択できる。**<br>ステージが空の場合はパスできず、何らかのアクション（終了時はエンド）をリクエストする。 | `LegalPatternGenerator` でステージが空でも `pat-pass` パターンを生成。 | `stage.requests.length === 0` のときは `LegalPatternGenerator` で `PASS` パターンを生成せず、`CoreFlowCoordinator.applyDecision` でも `ValidationError` で拒否。UI・AIもCoreの合法手に従う。 |
| **4. アクションリクエストとフォーカス設定**<br>`[4]〜[10]` | 通常アクションをステージに追加するか、即時アクションを解決し、誘発チェック `[5]` を終えた後、**直接リクエストしたプレイヤーにフォーカスを設定**する (`[10]`)。 | アクションリクエスト後、フォーカスは設定されない。 | 直接リクエスト処理および誘発チェック `[5]` 完了後に、`state.focusPlayer = requester` を設定 (`[10]`)。効果解決中断時は解決再開・完了後に `[10]` を実行。 |
| **5. 全員パスの判定**<br>`[11]` | パス選択時、**「次のチャンス移動先がフォーカスか？」** (`nextPlayer === state.focusPlayer`) で判定する。<br>・一致する場合：**全員パス成立** (`[12]`)。<br>・異なる場合：次のプレイヤーへチャンス移動 (`[14]`)。 | `PassTracker` の `consecutivePassCount >= playerCount` による回数カウント方式。 | `nextPlayer === state.focusPlayer` によるフォーカス比較方式へ完全移行。`consecutivePassCount` は全員パス判定に使用しない（診断・メトリクス用として維持）。 |
| **6. ルールシステムのチャンスとステージ解決**<br>`[12], [13]` | 全員パス成立時：<br>① **ルールシステム (`"system"`) にチャンス移動** (`[12]`)<br>② ステージ最上位リクエストを**1件だけ**解決 (`[13]`)<br>③ 勝敗未決着なら誘発チェック `[5]` 後、`[2]` を経てチャンス・フォーカスを**現TP**から再開する。 | 最上位1件解決直後に即時 `chancePlayer = turnPlayer` へ上書き。ルールシステムのチャンス保持状態が存在しない。 | `type ChanceHolder = PlayerKey \| "system"` (`RULE_SYSTEM_CHANCE = "system"`) を定義。全員パス時は `state.chancePlayer = "system"` に設定し、最上位1件解決と誘発チェック `[5]` 完了後に `[2]` で現TPにチャンス・フォーカスを設定。解決中断中も `chancePlayer = "system"` を維持。 |
| **7. 誘発チェックの特性**<br>`[5]` | 誘発チェックはリクエストの分類・解決・ステージ追加を担当し、**その内部でチャンスやフォーカスを変更しない**。 | `GameSession.ts` で通常誘発がステージに積まれた際、`initialChance` で強制的に `chancePlayer` を上書き。 | `GameSession.ts` の `initialChance` 上書き処理を削除。誘発チェック内部で `chancePlayer` や `focusPlayer` を一切変更しない。 |
| **8. エンド・チャージ・ドローの順序** | エンド解決でターン交代後、チャージ（即時解決）→ドロー（通常誘発でステージ積載）を経て、`[2]` によりまず**新TP**にチャンスとフォーカスがあり、新TPのパス後に新NTPが応答する。 | `draw.yaml` の `initialChance: turnPlayer` による上書きに依存。 | `TurnManager.endTurn` は `chancePlayer === "system"` 時に `turnPlayer` のみを新TPへ交代して `chancePlayer = "system"` を維持し、チャージ解決・ドロー積載後の `[2]` で自然に新TPへチャンスとフォーカスを設定。 |

---

## 4. 最終設計判断

### 4.1 Snapshot についての最終方針（Version 2 移行と V1 明示拒否）
旧公式コアフロー（`[4]`）ではアクションをリクエストするたびにパス記録をリセットしていました。第9.2版ではこのパス記録方式を廃止し、フォーカス方式へ移行します。旧Snapshot（Version 1）ではステージにリクエストが存在する途中状態において本来のフォーカスを確実に復元できない場合があるため、推測補完や条件分岐による自動変換は行わず、以下の厳格な Fail-Closed 方針を採用しました。

1. `SNAPSHOT_FORMAT_VERSION` を `2` に変更する（[`GameSessionSnapshot.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/domain/session/GameSessionSnapshot.ts)）。
2. Snapshot V2 では `gameState.focusPlayer`（有効なプレイヤーキー、`"system"` 不可）を必須とし、`gameState.chancePlayer` は有効なプレイヤーキーまたは `"system"` を許容する（[`GameSessionSnapshotCodec.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/session/GameSessionSnapshotCodec.ts)）。
3. 旧 V1 から V2 への自動変換は実装しない。`snapshotFormatVersion === 1` が渡された場合は、第9.2版フォーカス方式への移行に伴い `focusPlayer` が必須である旨の明確な理由を含む `GameSessionSnapshotValidationError` を投げて復元を拒否する。
4. 旧 V1 のデータファイルは勝手に削除せず、テストデータは必要に応じて新ルール（V2）で再作成する。

### 4.2 ルールシステムのチャンス (`"system"`) の表現方針
コアフロー `[12]`「ルールシステムにチャンスを移動」を曖昧な `null` で代用せず、明示的な型と定数で表現しました。

1. **型定義**:
   [`DecisionSource.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/domain/decision/DecisionSource.ts) にて以下を定義：
   ```ts
   export type PlayerKey = "p1" | "p2" | string;
   export type ChanceHolder = PlayerKey | "system";
   export const RULE_SYSTEM_CHANCE = "system" as const;
   ```
2. **ガードと不変条件**:
   - `state.focusPlayer` は常にプレイヤー（`PlayerKey`）のみを取り、`"system"` には決してならない。
   - `"system"` が `state.players` のキーとして参照されたり、合法アクションの候補生成対象になったり、プレイヤー巡回順序（`getNextPlayerKey` / `passChance`）に含まれたりしないよう、[`CoreFlowCoordinator.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/session/CoreFlowCoordinator.ts)、[`LegalPatternGenerator.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/decision/LegalPatternGenerator.ts)、[`TurnManager.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/rules/TurnManager.ts)、[`DecisionFeatureEncoder.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/ai/DecisionFeatureEncoder.ts)、[`PlaytestPerspectiveResolver.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/playtest/PlaytestPerspectiveResolver.ts)、[`GameStatusBar.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/GameStatusBar.tsx) で一貫してガード。
3. **効果解決時のカード選択権とチャンスの分離**:
   - ステージ解決 `[13]` の途中に効果解決判断（`EFFECT_RESOLUTION`）や墓地TOP選択（`ZONE_TOP_SELECTION`）で待機（`WAITING_FOR_DECISION`）となった場合、判断を行う主体は `decisionRequest.playerId` で表され、`state.chancePlayer` は `"system"` のまま維持される。
   - 再開後に解決と誘発チェック `[5]` が完了した時点で、コアフロー `[2]` により `chancePlayer` と `focusPlayer` が現在のターンプレイヤーに設定される。

### 4.3 `initialChance` の整理と調査報告
`tools/simulator/src` 全体における `initialChance` の残存箇所を調査した結果は以下の通りです。

| ファイル | 内容 | 対応方針・影響 |
| :--- | :--- | :--- |
| `src/engine/session/GameSession.ts` | 通常誘発リクエストがステージに積まれた際に `initialChance` で `state.chancePlayer` を強制上書きしていた処理 | **削除完了**。誘発チェック `[5]` はチャンスやフォーカスを変更せず、解決後の `[2]` によって現在のターンプレイヤーへ設定される。 |
| `src/domain/rules/RulePackage.ts` | `ActionRequestConfig.initialChance?: "turnPlayer" \| "nonTurnPlayer"` 型定義 | 既存YAMLスキーマとの互換のため型定義のみ残置（ランタイムのチャンス制御には不使用）。 |
| `src/engine/rules/RuleValidator.ts` | YAMLロード時の `initialChance` フィールド許容バリデーション | 既存YAMLのロード互換性維持のため残置。 |
| `src/data/rules-vnext/actions/draw.yaml`<br>`src/data/rules-vnext/actions/damage-judge.yaml` | `initialChance: turnPlayer` の記述 | YAML DSLファイルは無変更。`GameSession.ts` の上書き処理削除後も、コアフロー `[12]` (`"system"`) → `[13]` → `[5]` → `[2]` (`turnPlayer`) によって自然にターンプレイヤーへチャンスとフォーカスが設定されることをテスト（Case 13）で実証済み。 |

---

## 5. Phase 1 実装対象ファイル一覧

1. [`src/domain/decision/DecisionSource.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/domain/decision/DecisionSource.ts): `ChanceHolder`, `RULE_SYSTEM_CHANCE` の定義。
2. [`src/domain/decision/PlayerObservation.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/domain/decision/PlayerObservation.ts) / [`src/engine/decision/ObservationFactory.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/decision/ObservationFactory.ts): `chancePlayerId?: ChanceHolder`, `focusPlayerId?: PlayerKey` の公開観測反映。
3. [`src/engine/rules/TurnManager.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/rules/TurnManager.ts): `startTurn` / `initializeToMain` での3要素初期化、`endTurn` でのルールシステムチャンス維持下のターン交代。
4. [`src/engine/decision/LegalPatternGenerator.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/decision/LegalPatternGenerator.ts): 空ステージ時および `"system"` チャンス時の `PASS` 生成禁止。
5. [`src/engine/session/CoreFlowCoordinator.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/session/CoreFlowCoordinator.ts): 空ステージPASS拒否、`nextPlayer === state.focusPlayer` による全員パス判定 `[11]`、ルールシステムへのチャンス移動 `[12]`、最上位1件解決 `[13]`。
6. [`src/engine/session/GameSession.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/session/GameSession.ts): コアフロー `[2]`, `[5]`, `[10]`, `[12]`, `[13]` の正確な順序制御、解決中断・再開時の `"system"` チャンス維持、`initialChance` 上書き削除。
7. [`src/domain/session/GameSessionSnapshot.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/domain/session/GameSessionSnapshot.ts) / [`src/engine/session/GameSessionSnapshotCodec.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/session/GameSessionSnapshotCodec.ts): `SNAPSHOT_FORMAT_VERSION = 2`、`focusPlayer` 必須検証、旧 V1 明示拒否。
8. セットアップ・ハッシュ・UI・AI境界:
   - [`src/engine/session/setup/commonSetupProcedures.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/session/setup/commonSetupProcedures.ts)
   - [`src/engine/session/playtest/createCoreBattlePlaytest.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/session/playtest/createCoreBattlePlaytest.ts)
   - [`src/engine/regulation/OfficialRegulationMatchSetup.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/regulation/OfficialRegulationMatchSetup.ts)
   - [`src/engine/regulation/OfficialRegulationMatchFactory.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/regulation/OfficialRegulationMatchFactory.ts)
   - [`src/engine/scenario/ScenarioCompiler.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/scenario/ScenarioCompiler.ts)
   - [`src/engine/simulation/StateHasher.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/simulation/StateHasher.ts)
   - [`src/engine/diagnostics/CycleStateFingerprint.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/diagnostics/CycleStateFingerprint.ts)
   - [`src/engine/ai/SemanticFingerprintCalculator.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/ai/SemanticFingerprintCalculator.ts)
   - [`src/engine/ai/DecisionFeatureEncoder.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/ai/DecisionFeatureEncoder.ts)
   - [`src/ui/playtest/PlaytestPerspectiveResolver.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/playtest/PlaytestPerspectiveResolver.ts)
   - [`src/ui/game/GameStatusBar.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/GameStatusBar.tsx)
   - [`src/engine/rules/commandHandlers.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/rules/commandHandlers.ts) (`takeUntilLegacyCardHandler` の決定論的・衝突防止 `unitId` 修正)
   - [`src/domain/log/CanonicalMatchLog.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/domain/log/CanonicalMatchLog.ts) / [`src/engine/log/MatchLogRecorder.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/log/MatchLogRecorder.ts) (`match.started.focusPlayer` および `focus.changed` イベント追加、`meta.rulesVersion` のハードコード廃止と `RulePackage.version` 参照化)

---

## 6. 必須13ケースの回帰テスト仕様と実装状況

[`src/tests/decision/coreFlow.test.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/tests/decision/coreFlow.test.ts)、[`src/tests/simulation/sessionSnapshot.test.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/tests/simulation/sessionSnapshot.test.ts)、[`src/tests/rules-vnext/endChargeDrawChance.test.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/tests/rules-vnext/endChargeDrawChance.test.ts) にて、必須13ケースすべてを実装・検証済みです。

| # | ケース名 | 検証内容 | 実装テストファイル |
| :-: | :--- | :--- | :--- |
| **1** | ゲーム開始 | `turnPlayer`, `chancePlayer`, `focusPlayer` がすべて先攻プレイヤーに初期化されること | `coreFlow.test.ts` (Case 1) |
| **2** | 空ステージPASS禁止 | ステージ空で PASS パターンが生成されず、直接 PASS 提出時も `ValidationError` で拒否されること | `coreFlow.test.ts` (Case 2) |
| **3** | 通常アクション後の状態 | TP が通常アクションをリクエスト後、ステージに積まれ `chancePlayer === TP`, `focusPlayer === TP` で PASS が選択可能になること | `coreFlow.test.ts` (Case 3) |
| **4** | 即時アクション後のフォーカス設定 | ステージ空時は `[10]` 後に `[2]` で TP へ設定。ステージあり時は NTP 即時解決後に `chancePlayer === NTP`, `focusPlayer === NTP` を維持し、NTP PASS では全員パスにならず TP PASS で初めて全員パスが成立すること | `coreFlow.test.ts` (Case 4) |
| **5** | 単一リクエストの全員パス解決 | TP 通常アクション → TP PASS → NTP PASS で全員パス成立 → `chancePlayer` が `"system"` を経て1件解決 → `chancePlayer === TP`, `focusPlayer === TP` に戻ること | `coreFlow.test.ts` (Case 5) |
| **6** | チェイン時のフォーカス更新 | TP アクションA → TP PASS → NTP アクションB → `focusPlayer === NTP` → NTP PASS では全員パスにならず TP PASS で B のみ解決し A が残ること | `coreFlow.test.ts` (Cases 6 & 7) |
| **7** | 2件積まれたステージの段階解決 | B 解決後に `chancePlayer === TP`, `focusPlayer === TP` に戻り、A に対して改めて TP PASS → NTP PASS で A が解決されること | `coreFlow.test.ts` (Cases 6 & 7) |
| **8** | アタック→ブロック→ダメージ判定 | アタック解決 → ブロック誘発積載 (`chance=TP, focus=TP`) → TP PASS → NTP PASS → ブロック解決 → ダメージ判定積載 (`chance=TP, focus=TP`) → TP PASS → NTP PASS → ダメージ判定解決 | `coreFlow.test.ts` (Cases 8–13) |
| **9** | エンド→チャージ→ドロー | エンド解決 → ターン交代 → チャージ即時解決 → ドロー通常誘発積載 → 新TPにチャンスとフォーカス → 新TP PASS → 新NTP PASS → ドロー解決 → 新TPにチャンスとフォーカスが戻る | `coreFlow.test.ts` (Cases 8–13)<br>`endChargeDrawChance.test.ts` |
| **10** | 解決中断・再開 | ステージ解決中の `EFFECT_RESOLUTION` 待機時に `chancePlayer === "system"` を維持し、選択プレイヤー (`request.playerId`) と混同せず、再開完了後に正しい順序で `chancePlayer` と `focusPlayer` が設定されること | `coreFlow.test.ts` (Cases 8–13) |
| **11** | Snapshot V2 | 通常判断待ち・ステージあり途中状態・解決中断状態 (`chancePlayer === "system"`) で V2 Snapshot の保存・復元ができ、進行結果と `StateHash` が完全一致すること | `coreFlow.test.ts` (Cases 8–13)<br>`sessionSnapshot.test.ts` |
| **12** | 旧Snapshot V1拒否 | `snapshotFormatVersion: 1` を渡した場合、`GameSessionSnapshotValidationError` で明示的に拒否されること | `coreFlow.test.ts` (Cases 8–13)<br>`sessionSnapshot.test.ts` |
| **13** | `initialChance` 非依存確認 | `GameSession.ts` の `initialChance` 上書き削除およびアクション定義の `initialChance` 除去下でも、アタック→ブロック→ダメージ判定およびエンド→チャージ→ドローが公式ルールどおり動くこと | `coreFlow.test.ts` (Cases 8–13) |
