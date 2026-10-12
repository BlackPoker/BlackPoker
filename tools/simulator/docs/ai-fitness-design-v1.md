# BlackPoker Simulator: AI Fitness Design V1 (Outcome-First)

- **Document ID**: `BP-SIM-AI-FITNESS-DESIGN-V1`
- **Status**: Draft / Ready for Independent Review
- **Author**: BlackPoker Simulator Team
- **Created Date**: 2026-10-12
- **Target Component**: AI Self-Play Evolution Engine (Phase 4.0 Foundation)

---

## 1. Purpose (目的)

本ドキュメントは、Decision Feature Schema v4 / Decision DNA v1 / GenomePolicy に基づく AI プレイヤー（Decision DNA）を次世代へ進化（Evolution）させるための、**適応度（Fitness）評価の設計仕様**を定義する。

BlackPoker Simulator では、先行フェーズにおいて以下の因果鎖を決定論的・再現可能なエビデンスとして確立した（`BP-SIM-AI-GENOME-SENSITIVITY-V1 / V1-R1`）：
$$\text{DNA Difference} \longrightarrow \text{Feature Weight Delta} \longrightarrow \text{Score Delta} \longrightarrow \text{Decision Difference} \longrightarrow \text{Match Behavior Difference}$$

Fitness 層は、この因果鎖の上に立ち、次の根本的な問いに答える責任を負う：
> **「異なる行動特性（Behavior）を示す Decision DNA 群のうち、どちらを次世代へ残し、増殖させるべきか？」**

本設計は、BlackPoker のゲーム本質を歪めることなく、自己対戦進化（Self-Play Evolution）を健全に駆動するための最小かつ堅牢な Fitness Contract を確立することを目的とする。

---

## 2. BlackPoker Fitness Principles (固有の最重要設計原則)

BlackPoker におけるプレイ設計・AI 評価において、最も中核となる原則は以下である：

> **Victory is the objective. Life is a resource, not a score.**
> （勝利こそが目的である。ライフは資源であり、スコアではない。）

### 2.1 「残りライフが多いほど強い」の完全否定
一般的な対戦ゲームや単純なエージェント評価では、「残りHP（ライフ）の多さ」や「被ダメージの少なさ」を高評価として扱う設計が散見される。
しかし、**BlackPoker においてこの前提は完全に誤りである。**

BlackPoker の熟練した対戦プレイングでは、ライフは温存すべき得点ではなく、**戦略的に消費・投資すべき主要ゲーム内リソース**として扱われる：
1. **ダメージ受容によるテンポ維持**:
   防御（ブロック）を行わずにあえてライフでダメージを受け、手札や戦場ユニットを攻撃・展開リソースとして温存する。
2. **ライフを代償とした手札・盤面アドバンテージ**:
   ライフを犠牲にしてでも、相手の主要戦力を除去する、あるいは決定的な攻撃陣形を構築する。
3. **終盤のリーサル優先（肉を切らせて骨を断つ）**:
   自身のライフが 1 まで削られようとも、相手のライフを先に 0 にしたプレイヤーが完全な勝者となる。

したがって、以下を「強さを直接表す Fitness」として扱うことを厳格に禁止する：
- 試合終了時の残りライフ（`remainingLife`）
- 残りライフ比率（`remainingLifeRatio`）
- 被ダメージ量（`damageReceived`）
- 与ダメージ量（`damageDealt`）

### 2.2 勝利そのものの絶対性
BlackPoker のルール上、残ライフ 8 で勝とうが、残ライフ 1 で勝とうが、勝利の価値は完全に同一である。
AI に学習・進化させるべき第一目的は**「いかに安全にライフを残すか」ではなく、「いかにゲームに勝利するか」**である。

---

## 3. Outcome-First Philosophy (Outcome最優先思想)

Fitness V1 は **Outcome-First（勝敗結果最優先）** を設計思想とする。

### 3.1 Proxy Metric Optimization（代理指標の最適化）の排除
試合時間（ターン数）、残りライフ、手札枚数、チャージ数等の内部状態は、勝利に至るための「手段・状態（State / Process）」に過ぎず、「目的（Outcome）」ではない。
手段を Fitness に組み込むと、AI は本来の目的である勝利を歪め、代理指標を最大化する奇異な行動（Reward Hacking / Proxy Gaming）を学習してしまう。

### 3.2 単純加重式（Weighted Composite）の禁止
以下の形式による Fitness 計算は、V1 において**原則禁止**とする：

$$\text{fitness} = w_{\text{win}} \times \text{win} + w_{\text{life}} \times \text{life} - w_{\text{turn}} \times \text{turnCount} \quad \text{【禁止】}$$

**禁止理由**:
- 重み係数（$w_{\text{life}}, w_{\text{turn}}$ 等）の決定に客観的・数学的根拠が存在しない。
- 人為的な係数がゲームの最適戦略を歪め、AI が「勝つこと」よりも「ライフを減らさないこと」や「試合を早く終わらせること」を優先するようになる。
- ルール上合法かつ強力な「ライフを限界まで削って耐えるコントロール戦略」や「じっくり盤面を固める長期戦戦略」が不当に淘汰される。

V1 では加重結合（Composite Weighted Score）を排し、純粋な対戦結果（Outcome）に基づく構成に統一する。

---

## 4. Fitness vs Telemetry (適応度と遠隔測定の厳格な分離)

本設計において最も重要なアーキテクチャ規約は、**「次世代選択に使う値（Fitness）」**と**「研究・分析のために記録する値（Telemetry）」**の完全な分離である。

| 区分 | 定義 | 用途 | V1 での採用 |
|---|---|---|---|
| **Fitness Metric** | 次世代 DNA の淘汰・選択（Selection）に**直接使用する**決定論的指標 | 親世代選択、個体ランキング、世代更新 | **採用（Outcome のみ）** |
| **Telemetry Metric** | 研究、ゲームバランス分析、行動特性解析のために**記録・集計するが、選択には一切使用しない**指標 | メタゲーム分析、デバッグ、異常行動検知 | **分析用としてのみ保持** |

### 4.1 指標の帰属一覧

```text
[Match Evaluation Data]
        │
        ├─► [Fitness Metrics] (次世代選択に直接使用)
        │     ├─ Wins (勝利数)
        │     ├─ Losses (敗北数)
        │     ├─ Draws (引き分け数)
        │     ├─ Completed Matches (完了試合数)
        │     └─ Evaluation Validity Status (検証十分性ステータス)
        │
        └─► [Telemetry Metrics] (記録のみ / 選択・順位付けには一切使用しない)
              ├─ Remaining Life / Opponent Remaining Life
              ├─ Damage Received / Damage Dealt
              ├─ Turn Count (平均ターン数、最大ターン数)
              ├─ Decision Count (意思決定手数)
              ├─ Action Rate / Pass Rate / Effect Rate (行動選択傾向)
              └─ Incomplete Reasons (タイムアウト、最大手数到達等)
```

---

## 5. Result Semantics (対戦結果の意味論)

既存の `PolicyExperimentRunner` および `BatchSimulationRunner` における対戦結果セマンティクスを継承し、各ステータスを厳格に定義する。

### 5.1 各結果の定義
1. **`WIN`（勝利）**:
   ルールおよびレギュレーションに基づき、対戦が正常に終了し、当該プレイヤーが勝利した状態。
2. **`LOSS`（敗北）**:
   対戦が正常に終了し、相手プレイヤーが勝利した（または自身が敗北条件を満たした）状態。
3. **`DRAW`（引き分け）**:
   ルールに基づき、対戦が正常に終了し、両プレイヤーが同時に勝利・敗北条件を満たすなどして公式に引き分けとなった状態。
4. **`INCOMPLETE`（未決着・中断）**:
   最大意思決定手数（`maxDecisionsPerMatch`）到達などにより、ゲームが勝敗決定に至る前に打ち切られた状態。
5. **`FAILED`（異常終了・クラッシュ）**:
   エンジン例外、未補足エラー、ポリシー異常等により、シミュレーションが異常中断した状態。

### 5.2 重要な禁止事項
- **`INCOMPLETE != DRAW`**:
  未決着の中断試合を「引き分け（DRAW）」へ暗黙変換・加算してはならない。未決着はゲームの結論が出ていない状態であり、ルールの引き分けとは明確に区別する。
- **`FAILED != LOSS`**:
  クラッシュやエンジン例外を「単なる敗北（LOSS）」へ暗黙変換してはならない。FAILED はルールの敗北ではなくシステム・実装上の異常であり、通常の勝敗計算から完全に隔離する。

---

## 6. Evaluation Validity & Evidence Sufficiency (検証十分性)

Fitness を安全に計算するためには、**「計算されたスコア」**と**「そのスコアを信用してよいかという証拠十分性」**を独立した概念として扱う必要がある。

### 6.1 少数試合における勝率の過大評価問題
例えば以下の 2 個体を単純勝率で比較した場合：
- **DNA A**: スケジュール 100 試合中、2 試合のみ完了（2 勝 0 敗）、98 試合が未決着（INCOMPLETE）。$\rightarrow$ 勝率 $100\%$
- **DNA B**: スケジュール 100 試合中、90 試合完了（60 勝 30 敗）、10 試合が未決着。$\rightarrow$ 勝率 $66.7\%$

DNA A を「勝率 $100\%$ だから最強」と判定して次世代に残すと、**「決着がつかない千日手・遅延行動ばかりを選び、偶然完了した極小試合だけで高評価を得る」という重大な Reward Hacking（遅延エージェントの優遇）**が発生する。

### 6.2 3値 Evaluation Status と Score 保有契約
個体の評価結果は、スコア数値とは独立して以下の 3 つのステータスを持つ。
特に、**`INVALID` 個体は「通常 Fitness として使用可能な 0.0」と誤認されることを完全に防ぐため、Authoritative Fitness Score を保有しない（`fitnessScore: null`）** という厳格な型契約（Contract）とする：

```typescript
type FitnessEvaluationStatus =
  | "VALID"                  // 評価証拠が十分であり、Authoritative Fitness Score を持つ
  | "INSUFFICIENT_EVIDENCE"  // 完了試合数または完了率が不足。Authoritative Score は持たず保留
  | "INVALID";               // FAILED 試合が存在し失格。Authoritative Score を一切持たない

type FitnessEvaluationResult =
  | {
      readonly status: "VALID";
      readonly fitnessScore: number; // [0.0, 1.0] 有界の実数値 (Authoritative)
      readonly completedMatches: number; // >= minimumCompletedMatches (> 0)
      readonly completionRate: number; // >= minimumCompletionRate
      readonly scheduledMatches: number;
      readonly wins: number;
      readonly losses: number;
      readonly draws: number;
    }
  | {
      readonly status: "INSUFFICIENT_EVIDENCE";
      readonly fitnessScore: null; // Authoritative スコアなし（通常の次世代選択対象外）
      readonly provisionalScore: number | null; // 参考用 MPA (completedMatches > 0 のみ算出。completedMatches === 0 では null)
      readonly completedMatches: number;
      readonly completionRate: number;
      readonly scheduledMatches: number;
      readonly wins: number;
      readonly losses: number;
      readonly draws: number;
    }
  | {
      readonly status: "INVALID";
      readonly fitnessScore: null; // Authoritative スコアなし（失格・除外）
      readonly failedMatches: number; // > 0
      readonly scheduledMatches: number;
    };
```

> **重要: 0 試合完了時の `provisionalScore` 契約**
> `completedMatches === 0`（1 試合も完了していない）場合、`provisionalScore` は `0.0` ではなく厳格に **`null`** とする。
> 0 試合完了は「全敗（0 勝）」ではなく「データ不在」であり、安易に `0.0` と縮退・推測してはならない。


### 6.3 VALID 条件と判定規則
評価ステータスは、以下の論理式に基づき決定論的に判定される。

#### A. VALID 判定条件 (厳格な論理積: AND)
個体が **`VALID`** と判定されるための必要十分条件は、以下の 3 条件がすべて同時に成立することである：

$$\text{status} = \text{"VALID"} \iff \begin{cases} \text{failedMatches} = 0 \\ \text{AND} \\ \text{completedMatches} \ge \text{minimumCompletedMatches} \\ \text{AND} \\ \text{completionRate} \ge \text{minimumCompletionRate} \end{cases}$$

※ ここで $\text{completionRate} = \frac{\text{completedMatches}}{\text{scheduledMatches}}$ である。

#### B. 各ステータスの優先判定フロー
1. **Fail-Closed 判定**:
   - `failedMatches > 0` $\Longrightarrow$ 即座に **`INVALID`**。
   - クラッシュや例外を起こした DNA は、どれほど勝率が高くとも Authoritative スコアを剥奪され、失格（Tier 3）となる。通常個体の「0勝全敗によるスコア 0.0」とは明確に区別される。
2. **Evidence Sufficiency 判定**:
   - `failedMatches === 0` かつ (`completedMatches < minimumCompletedMatches` OR `completionRate < minimumCompletionRate`) $\Longrightarrow$ **`INSUFFICIENT_EVIDENCE`**。
   - 完了試合の絶対数不足、または完了率の不足のいずれか一方でも該当する場合、評価不十分として保留（Tier 2）となる。
3. **VALID 判定**:
   - 上記のいずれにも該当しない場合のみ、**`VALID`**（Tier 1）となり、正式な Authoritative Fitness Score が確定する。

#### C. パラメータの性質 (Provisional Defaults: 初期仮値)
`minimumCompletedMatches` および `minimumCompletionRate` は**固定仕様ではなく、初期仮値（Provisional Defaults）**である。
- **初期仮値**:
  - `minimumCompletedMatches`: 10 試合
  - `minimumCompletionRate`: 50% (0.50)
- **根拠と将来調整**:
  - 実験規模（スケジュール試合数）やレギュレーションの平均手数に応じて調整可能なハイパーパラメータ（Configurable Hyperparameters）であり、固定コードとして不変に焼き込むものではない。

---

## 7. Fitness Formula Candidates (計算式の比較検討)

Completed Matches（正常完了試合）を対象とした Outcome Fitness の計算方式として、以下の 3 案を検討・比較した。

### 案 A: 純粋勝率方式 (Pure Win Rate)
$$\text{Fitness}_{\text{A}} = \frac{\text{Wins}}{\text{CompletedMatches}}$$
- **特徴**: 勝利のみを評価。引き分け（Draw）は 0 点（敗北と同等）扱い。
- **欠点**: ルール上不利な局面において「粘って引き分けに持ち込む」プレイが敗北と同価値になり、リスク度外視の暴走プレイを誘発する恐れがある。

### 案 B: マッチポイント平均方式 (Match Point Average: MPA)
$$\text{Fitness}_{\text{B}} = \frac{\text{Wins} \times 1.0 + \text{Draws} \times 0.5 + \text{Losses} \times 0.0}{\text{CompletedMatches}}$$
- **特徴**: チェス、TCG公式大会、サッカー等で広く用いられる標準勝ち点方式。
- **利点**:
  - スコアが $[0.0, 1.0]$ の有界な実数値に正規化される。
  - 引き分けが敗北（0.0）と勝利（1.0）の中間（0.5）として正当に評価される。
  - トーナメント選択、ルーレット選択等の一般的な遺伝的アルゴリズム（GA）演算子と極めて親和性が高い。

### 案 C: 辞書式順序ランキング (Lexicographic Ordering)
優先度順に多段階比較を行う：
1. `EvaluationStatus`（`VALID` > `INSUFFICIENT` > `INVALID`）
2. 勝利数（Wins）
3. 引き分け数（Draws）
4. 未決着の少なさ（Incomplete の低さ）
- **特徴**: 数値スコアを作らず、個体間のソート規則のみを定義。
- **欠点**: 順位付け（Tournament Selection）には使えるが、適応度比例ルーレット選択や、将来のスコア差分を用いた統計検定（t検定など）に利用しにくい。

---

## 8. Recommended Fitness V1 (推奨設計仕様)

Fitness V1 として、**案 B（Match Point Average: MPA）をベースとした 4 フェーズ評価パイプライン**を推奨仕様として確定する。

```text
================================================================================
  FITNESS V1 EVALUATION PIPELINE
================================================================================

[Input: Pairwise / Batch Match Results]
  │
  ├─► [Phase 1: Validity & Sufficiency Gate]
  │     ├─ If failedMatches > 0:
  │     │     Status = "INVALID"
  │     │     FitnessScore = null (Authoritative スコア剥奪・失格)
  │     │
  │     ├─ Else if completedMatches < minCompletedMatches
  │     │       OR completionRate < minCompletionRate:
  │     │     Status = "INSUFFICIENT_EVIDENCE"
  │     │     FitnessScore = null (Authoritative スコアなし・通常選択対象外)
  │     │     ProvisionalScore = (completedMatches > 0) ? MPA : null
  │     │
  │     └─ Else (failedMatches === 0
  │              AND completedMatches >= minCompletedMatches
  │              AND completionRate >= minCompletionRate):
  │           Status = "VALID"
  │           FitnessScore = MPA (Authoritative 公式スコア)
  │
  ├─► [Phase 2: Outcome Fitness Calculation]
  │     MPA = (Wins * 1.0 + Draws * 0.5) / CompletedMatches
  │     (※ VALID 個体のみが Authoritative FitnessScore として確定)
  │     (※ INSUFFICIENT 個体は completedMatches > 0 の場合のみ参考暫定値として保持)
  │
  ├─► [Phase 3: Population Selection Priority]
  │     次世代選択プールの構造:
  │       [通常選択プール (Standard Selection Pool)]:
  │         Tier 1: Status === "VALID" のみ
  │                 （Authoritative FitnessScore 降順で淘汰・選択を実行）
  │
  │       [通常選択除外 / 保留 (Quarantined)]:
  │         Tier 2: Status === "INSUFFICIENT_EVIDENCE"
  │                 （通常の次世代親個体選択対象から除外。
  │                   母集団全滅時のフォールバック扱いは Evolution Selection 設計へ委ねる）
  │
  │       [即時破棄 / 失格 (Disqualified & Discarded)]:
  │         Tier 3: Status === "INVALID"
  │                 （FitnessScore 不在、選択プールから即時完全破棄）
  │
  └─► [Phase 4: Telemetry Separation (Sidecar Archive)]
        Life, Turns, Damage, Action Rates をメタデータとして保存
        (次世代選択アルゴリズムからは完全に不可視化)
================================================================================
```

### 設計推奨理由
1. **ゲーム性の歪みゼロ**: 勝利（1.0）と引き分け（0.5）のみを評価し、ライフ残量等の戦略的リソースに干渉しない。
2. **完全な Fail-Closed**: クラッシュした個体は `FitnessScore = null` として Tier 3 に隔離され、絶対に増殖・生存しない（「通常個体のスコア 0.0」と誤認されない）。
3. **遅延戦法の抑止**: 未決着多発個体は完了数または完了率不足により `FitnessScore = null`（Tier 2）として**通常の選択プールから完全に除外**され、過大評価・次世代拡散されない。
4. **0 試合完了の厳格な扱い**: 完了試合が 0 試合の個体は `provisionalScore = null` となり、勝率 0.0（全敗）と誤認されない。

---

## 9. Seat Swap & Seed Fairness (対戦の公平性保証)

Fitness 評価においても、`BP-SIM-AI-GENOME-SENSITIVITY-V1` で実証された決定論的公平性原則を厳格に継承する。

1. **Seat Swap（先後入替）の必須化**:
   すべての対戦ペア（Participant A vs Participant B）は、`p1 = A, p2 = B`（Leg 1）と `p1 = B, p2 = A`（Leg 2）の両座席で同数試合を行う。BlackPoker における先攻・後攻のアドバンテージを完全に中和する。
2. **同一 Seed 群の決定論的ペアリング**:
   Leg 1 の `matchIndex = k` と Leg 2 の `matchIndex = k` は同一の `matchSeed` を使用する。初期デッキ配列やシャッフル結果の「引きの良さ」による偏りを排除する。
3. **新規シミュレーションループの新設禁止**:
   既存の検証済み本番経路である `PolicyExperimentRunner` $\rightarrow$ `BatchSimulationRunner` $\rightarrow$ `SimulationRunner` $\rightarrow$ `GameSession` をそのまま利用し、二重実装による挙動不一致を防ぐ。

---

## 10. Reward Hacking Risks (代理報酬ハッキング分析)

設計段階において想定される Reward Hacking のリスクと、本設計による防御策を整理する。

| 代理指標 | 懸念される Reward Hacking（異常行動） | Fitness V1 での防御策 |
|---|---|---|
| **Remaining Life** | ライフを減らさないために過剰防御や消極的パスを繰り返し、勝機を逃す。また、ライフを犠牲にした強力なコンボを学習できなくなる。 | **Fitness から完全除外**。Telemetry にのみ分離。 |
| **Turn Count** | 「短時間で終わらせる」ために勝率を度外視して無謀な突撃を行い、早期自滅する。または長期戦コントロール戦略が不当に淘汰される。 | **Fitness から完全除外**。Telemetry にのみ分離。 |
| **Damage Dealt** | 相手のライフを削ることだけに執着し、相手の反撃やリソース枯渇を無視して敗北する。 | **Fitness から完全除外**。Telemetry にのみ分離。 |
| **Incomplete Abuse** | 決着をつけずに意図的に引き延ばし、少ない完了試合での偶然の勝率を誇大に見せる。 | **Evidence Sufficiency Gate** により、未決着多発個体を Tier 2（通常選択除外）へ隔離。 |
| **Crash Exploitation** | 不利な局面で意図的または偶発的に例外を発生させ、敗北を免れようとする。 | **Fail-Closed Gate** により、FAILED > 0 は即座に INVALID / 失格。 |

---

## 11. Telemetry Metrics (遠隔測定指標の体系)

Fitness 計算には関与させないが、将来の分析・研究・バランス調整のために収集・保存する Telemetry 指標を整理する。

### 11.1 現在の基盤で安全に取得可能な指標 (Current Ready)
- `totalObservedDecisions`: 観測された意思決定総数
- `actionSelectionRate`, `actionSelections`: 汎用アクション選択率・回数
- `passSelectionRate`, `passSelections`: パス選択率・回数
- `effectSelectionRate`, `effectSelections`: 効果選択率・回数
- `otherSelectionRate`, `otherSelections`: その他選択率・回数
- `scheduledMatches`, `completedMatches`, `incompleteMatches`, `failedMatches`: 試合完了ステータス集計

### 11.2 将来の Canonical Match Log から抽出可能な候補 (Future Extractable)
- `finalSelfLife`: 試合終了時の自己残りライフ
- `finalOpponentLife`: 試合終了時の相手残りライフ
- `turnCount`: 試合終了時の総ターン数
- `damageReceivedTotal`: 試合中の総被ダメージ
- `damageDealtTotal`: 試合中の総与ダメージ
- `terminalReason`: 決着理由（相手ライフ0、山札切れ、投了等）

これらは Match Log 解析パイプライン側で抽出・記録し、DNA の淘汰・選択ロジックへは一切伝搬させない。

---

## 12. Future Opponent Strength Evaluation (対戦相手の強さ補正の展望)

Fitness V1 では計算の透明性と決定論性を最優先し、同一世代内または固定相手との Match Point Average（MPA）を採用する。
しかし、将来の本格的な自己対戦進化（Self-Play Evolution）においては、以下の課題が生じる：
- 「弱い DNA に対する 10 勝」と「歴代最強 DNA に対する 10 勝」が同等に評価されてしまう。

これに対応するため、将来フェーズ（Phase 4.1 以降）で導入可能な対戦相手評価モデルを以下のように整理する（※V1 では実装しない）：

1. **Hall of Fame（殿堂入り）ベンチマーク対戦**:
   過去世代のチャンピオン DNA 群（固定された過去最強個体）を不変の評価基準として常設し、殿堂入り個体に対する MPA を Fitness として算出。
2. **レーティング方式（Elo / Glicko-2）**:
   対戦相手の強さに応じてレーティングを増減させる動的評価。母集団全体のスキル水準向上に追従可能。
3. **Swiss / Round Robin トーナメント**:
   世代内の全個体による総当たり、あるいは同勝率帯同士によるスイスドロー対戦による順位付け。

---

## 13. Worked Examples (ケーススタディによる検証)

### Case A: ライフ温存 vs 勝利優先
- **DNA A**: 100 試合中 70 勝 30 敗、平均残りライフ 1.5
- **DNA B**: 100 試合中 60 勝 40 敗、平均残りライフ 8.0
- **判定**:
  - DNA A の MPA: $70 / 100 = 0.70$
  - DNA B の MPA: $60 / 100 = 0.60$
  - **結果: DNA A が上位**。ライフを極限まで使って勝利を掴み取った DNA A を正当に高く評価する。

### Case B: サンプル十分性ゲート（未決着多発）個体

#### Case B-1: 完了試合の絶対数不足
- **DNA A**: 100 試合スケジュール、2 試合完了（2 勝 0 敗）、98 試合未決着（INCOMPLETE）
- **DNA B**: 100 試合スケジュール、90 試合完了（60 勝 30 敗）、10 試合未決着
- **判定**:
  - DNA A: `completedMatches = 2 < 10`（絶対数不足）のため、Status は **`INSUFFICIENT_EVIDENCE`**（Tier 2）。`fitnessScore = null`、暫定 MPA = 1.0。**通常の次世代親個体選択プールから除外（保留）**。
  - DNA B: `completedMatches = 90 >= 10` かつ `completionRate = 90% >= 50%` のため、Status は **`VALID`**（Tier 1）。`fitnessScore = 60 / 90 = 0.667`。通常の選択対象。
  - **結果: DNA B が選択対象（上位）**。DNA A は完了試合不足により通常選択プールから除外され、見かけの「勝率 100%」による不当な次世代親獲得を阻止する。

#### Case B-2: 完了数は閾値を満たすが完了率（CompletionRate）が低い
- **DNA C**: 1,000 試合スケジュール、20 試合完了（20 勝 0 敗）、980 試合未決着（INCOMPLETE）
- **DNA D**: 1,000 試合スケジュール、800 試合完了（500 勝 300 敗）、200 試合未決着（INCOMPLETE）
- **判定**:
  - DNA C: `completedMatches = 20 >= 10`（絶対数は満たす）だが、`completionRate = 20 / 1000 = 2.0% < 50%`（完了率が閾値未満）。Status は **`INSUFFICIENT_EVIDENCE`**（Tier 2）。`fitnessScore = null`、暫定 MPA = 1.0。**通常の次世代親個体選択プールから除外（保留）**。
  - DNA D: `completedMatches = 800 >= 10` かつ `completionRate = 800 / 1000 = 80.0% >= 50%`。Status は **`VALID`**（Tier 1）。`fitnessScore = 500 / 800 = 0.625`。通常の選択対象。
  - **結果: DNA D が選択対象（上位）**。DNA C は大量の試合を引き延ばして完了率が 2% に留まっているため通常選択プールから除外され、過大評価されない。

#### Case B-3: 完了試合が 0 試合の個体 (provisionalScore = null)
- **DNA E**: 100 試合スケジュール、0 試合完了、100 試合未決着（INCOMPLETE）
- **DNA F**: 100 試合スケジュール、100 試合完了（0 勝 100 敗、全敗）
- **判定**:
  - DNA E: `completedMatches = 0` のため、Status は **`INSUFFICIENT_EVIDENCE`**（Tier 2）。`fitnessScore = null` かつ **`provisionalScore = null`**（「勝率 0.0」ではなく「データ不在」として記録）。通常の選択プールから除外。
  - DNA F: `completedMatches = 100 >= 10` かつ `completionRate = 100% >= 50%`、`failedMatches = 0` のため、Status は **`VALID`**（Tier 1）。`fitnessScore = 0.0`（0 勝全敗による正規の 0.0）。
  - **結果: DNA F は正規のスコア 0.0 を持つ通常個体であり、DNA E（データ不在 null）とは意味論的にも型上も完全に区別される**。

### Case C: クラッシュ発生個体
- **DNA A**: 100 試合スケジュール、90 勝 9 敗 1 FAILED
- **DNA B**: 100 試合スケジュール、50 勝 50 敗 0 FAILED
- **判定**:
  - DNA A: `failedMatches = 1 > 0` のため、Status は **`INVALID`**（Tier 3、失格）。**`fitnessScore = null`**（Authoritative スコアを剥奪され、通常個体のスコア 0.0 とは異なり選択プールから即時破棄）。
  - DNA B: Status は **`VALID`**（Tier 1）、`fitnessScore = 50 / 100 = 0.50`。
  - **結果: DNA B が上位（DNA A は即時淘汰・破棄）**。クラッシュを起こす個体はいかに勝率が高くとも排除される。

### Case D: 同率 MPA におけるライフ差
- **DNA A**: 100 試合中 50 勝 50 敗、平均残りライフ 1.0
- **DNA B**: 100 試合中 50 勝 50 敗、平均残りライフ 9.0
- **判定**:
  - DNA A の MPA: 0.50 (`fitnessScore = 0.50`)
  - DNA B の MPA: 0.50 (`fitnessScore = 0.50`)
  - **結果: 同率タイ（同順位）**。残りライフの多寡を理由に DNA B を上位にしてはならない。タイブレークが必要な場合は決定論的乱数または親世代ID等の客観基準を用い、ライフを指標として持ち込まない。

---

## 14. Non-Goals (今回の非対象スコープ)

本作業（`BP-SIM-AI-FITNESS-DESIGN-V1`）において、以下は明示的にスコープ外とする：

1. **Fitness 計算プロダクションコードの実装**:
   `FitnessCalculator.ts`, `FitnessEvaluator.ts` などの TypeScript 実装コードは一切作成しない。
2. **Evolution Loop の実装**:
   Population、Generation 更新、Selection（選択）、Crossover（交叉）、Mutation（突然変異）、EvolutionRunner は実装しない。
3. **レーティングエンジンの実装**:
   Elo、Glicko、Swiss 等の実装は行わない。
4. **Core Engine / Simulation 側の変更**:
   `GameSession`, `PolicyExperimentRunner`, `BatchSimulationRunner` 等のソースコードは一切変更しない。
5. **テストコードの追加**:
   実装が存在しないため、単体テスト・結合テストコードは作成しない。

---

## 15. Open Questions (今後の検討課題)

1. **公式レギュレーションにおける試合完了ステップ数（maxDecisions）の適正値**:
   現行の公式レギュレーション（`standard-pack`）では、DNA の行動特性によっては手数上限（現在 CLI デフォルト 500）に達して INCOMPLETE となる試合が存在する。進化実験を効率的に回すための推奨ステップ上限、あるいは引き分け判定条件の整備について継続検討する。
2. **Tier 2（INSUFFICIENT_EVIDENCE）個体の非常時フォールバック選択アルゴリズム**:
   初期世代において未決着が多発し、Tier 1（VALID）個体数が次世代親プール定員（Population の指定枠）に満たない場合の**非常時フォールバック（Tier 2 fallback）処理の具体設計**。これは Fitness 評価層の責務ではなく、Phase 4.0 の Evolution Selection（親個体選択アルゴリズム）の設計課題として整理・検討する（例: CompletionRate 降順での暫定救済、あるいは前世代エリートの再起用など）。
3. **対戦相手プールの選定**:
   世代内自己対戦（Population 内ランダムマッチ）とするか、固定された Baseline AI（ランダム、ヒューリスティック等）との対戦とするかの実験プロトコルの策定。
