# BlackPoker Standard＋Pack Evolution Pilot V1 — R3 レポート

- **Work ID:** `BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R3`
- **Base SHA:** `69246844cad56a425c0bc8563a9aa2bd1416110d`
- **Core Fix Commit:** `69246844cad56a425c0bc8563a9aa2bd1416110d`
- **Regulation:** `standard-pack` (`standard-pack` v1.0.0)
- **Campaign Seed:** `20261031`
- **生成日時:** `2026-11-01T01:55:00.365Z`

---

## 1. エグゼクティブサマリ

本レポートは、R2 で判明した **① 終了時手番取得による先攻/後攻集計の誤り** および **② 墓地 Unit wrapper 誤認に伴う Seed 92023 の例外（fail-closed）停止** を解消し、Production Core 修正後の同一 576 試合条件にて再検証を実施した結果を報告するものです。

> [!IMPORTANT]
> **本検証の位置付け（重要）**  
> 今回の 576 試合は、Core 修正前後の正確な比較を目的とした**再評価（Validation）**であり、新しい未知の Holdout 評価ではありません。Seed 92001〜92032 は将来の Holdout 評価からは除外されます。

### 主要な検証結果

1. **DNA 同一性検証ゲートの通過 (100% 一致)**:
   Stage G 開始前に事前検証を行い、Candidate, Offspring #2, Offspring #1 の Full DNA Digest が指定値と完全一致することを確認しました。
   - **Candidate**: `8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa` (完全一致)
   - **Offspring #2**: `4cfa4dc731bb4d5ef4eeb91ba48739b215c79df07d5f25438a9e11d62048e15d` (完全一致)
   - **Offspring #1**: `f882c794c57717d7808eef0fdf1695c002ccb2c2667ac9947e41e23dbb6fc853` (完全一致)

2. **Seed 92023 の例外解消と 100% 完走**:
   - R2 で例外停止（FAILED）した **Seed 92023 (Candidate p1 vs TransferG1Best p2)** が、Production Core 修正により **正常に完走（COMPLETED: 160 decisions, 10 turns, Winner: p1）** しました。
   - 576 試合全体の完了率は **100.0% (576/576, FAILED: 0, INCOMPLETE: 0)** を達成しました。

3. **初期手番集計の是正による先攻・後攻成績**:
   対戦初期の `session.state.turnPlayer` を厳格に取得することにより、有効な先攻/後攻成績が集計されました。
   - **Candidate**: 先攻 **84.4%** (81/96) / 後攻 **77.1%** (74/96)
   - **Offspring #2**: 先攻 **68.8%** (66/96) / 後攻 **69.8%** (67/96)
   - **Offspring #1**: 先攻 **41.7%** (40/96) / 後攻 **53.1%** (51/96)

4. **統計的有意差とクラスター・ブートストラップ信頼区間**:
   - **Candidate vs Offspring #2**:
     - 全体勝率: **80.7%** vs **69.3%**
     - McNemar 検定: 不一致ペア $b=43, c=21$、$chi^2 = 6.8906$、**p = 0.0081**（有意水準 $alpha = 0.05$ で有意差あり）
     - **95% クラスター・ブートストラップ信頼区間**: **[+3.65%, +19.27%]**（0 を跨がず、Candidate の優位性が維持）
   - **Candidate vs Offspring #1**:
     - 全体勝率: **80.7%** vs **47.4%**
     - McNemar 検定: 不一致ペア $b=79, c=15$、$chi^2 = 42.2234$、**p < 0.0001**（有意差あり）
     - **95% クラスター・ブートストラップ信頼区間**: **[+24.48%, +42.19%]**

---

## 2. R2 と R3 の試合別比較 (Deltas)

576 試合中、R2 と R3 で結果に変化が生じた試合は **47 件** でした。

### 2.1 差分の内訳
- **vs TransferG1Best (1 件)**:
  - Seed 92023（Candidate as p1）: R2 で FAILED（墓地 Unit wrapper 例外）だった対戦が、Core 修正により正常完走（Winner: p1、160 decisions、10 turns）。
  - 残る 191 試合は、Trace Digest まで **100% 完全一致**。
- **vs SeededRandom (0 件)**:
  - 全 192 試合で勝者・着手系列（Trace Digest）が **100% 完全一致**。
- **vs FirstLegal (46 件)**:
  - 46 試合で勝者が変化（Candidate: 55勝→63勝 [勝者変更 10 件]、Offspring #2: 51勝→58勝 [勝者変更 13 件]、Offspring #1: 26勝→31勝 [勝者変更 23 件]）。
  - 192 試合すべての Trace Digest が変化。

### 2.2 FirstLegal 差分に関する分析と未解決の再現性課題 (Unresolved Reproducibility Issue)
- **観察事実**:
  - R2 コードベース（Base SHA `82d5c5a`）を用いた Seed 92001 Leg 0 の直接実行では、R3 と同一結果（Decisions: 124, Winner: p1, TraceDigest: `cf982b06...`）が再現されることが確認されています。
  - また、TransferG1Best（191/192試合一致）および SeededRandom（192/192試合一致）では高い決定論的一致が確認されており、Candidate・Offspring の DNA や初期状態生成に差異はありません。
- **原因未確定の扱い**:
  - GitHub 上の R2 および R3 Runner はいずれも `new FirstLegalPolicy(false)` を指定して実装されています。
  - R2 Evidence JSON 生成時に記録された FirstLegal の数値（Decisions: 175, Winner: p2 等）と再実行結果との不一致の原因については、当時の実行環境や設定差異を示す客観的なログ・履歴等の証拠が揃っていないため、現時点では「Core修正による因果改善」と断定せず、**未解決の再現性課題**として管理します。

### 2.3 差分全件リスト (47 件)

| 試合 ID / 条件 | R2 状態 | R3 状態 | 勝者 (R2 -> R3) | 備考 |
|---|---|---|---|---|
| `candidate:transfer-g1-best:92023:model_as_p1` | FAILED | COMPLETED | none -> p1 | FAILED in R2 (Seed 92023 issue) -> COMPLETED in R3 (Winner: p1) |
| `candidate:first-legal:92001:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `candidate:first-legal:92015:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `candidate:first-legal:92017:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `candidate:first-legal:92017:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `candidate:first-legal:92020:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `candidate:first-legal:92022:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `candidate:first-legal:92024:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `candidate:first-legal:92029:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `candidate:first-legal:92030:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `candidate:first-legal:92031:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-2:first-legal:92001:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-2:first-legal:92005:model_as_p2` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-2:first-legal:92009:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-2:first-legal:92010:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-2:first-legal:92017:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-2:first-legal:92018:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-2:first-legal:92018:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-2:first-legal:92021:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-2:first-legal:92024:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-2:first-legal:92024:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-2:first-legal:92028:model_as_p2` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-2:first-legal:92030:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-2:first-legal:92031:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92001:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92002:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-1:first-legal:92003:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92004:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92006:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-1:first-legal:92010:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92013:model_as_p2` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-1:first-legal:92014:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-1:first-legal:92015:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92017:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92017:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92018:model_as_p2` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-1:first-legal:92019:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92021:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92022:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92024:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92024:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92025:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92026:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92027:model_as_p1` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92030:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |
| `offspring-1:first-legal:92032:model_as_p1` | COMPLETED | COMPLETED | p2 -> p1 | Winner changed: R2(p2) -> R3(p1) |
| `offspring-1:first-legal:92032:model_as_p2` | COMPLETED | COMPLETED | p1 -> p2 | Winner changed: R2(p1) -> R3(p2) |

---

## 3. モデル別詳細成績

### 3.1 総合成績と Wilson 95% 信頼区間

| モデル | 完了試合 | 勝 | 敗 | 分 | 勝率 | Wilson 95% 信頼区間 |
|---|---|---|---|---|---|---|
| **Candidate** (`genome-sp-g0-004`) | 192 | 155 | 37 | 0 | **80.7%** | [74.6%, 85.7%] |
| **Offspring #2** (`gen-000001-offspring-000001`) | 192 | 133 | 59 | 0 | **69.3%** | [62.4%, 75.4%] |
| **Offspring #1** (`gen-000001-offspring-000000`) | 192 | 91 | 101 | 0 | **47.4%** | [40.5%, 54.4%] |

### 3.2 座席 (P1/P2) および 手番 (先攻/後攻) 成績

| モデル | P1 勝率 (勝/試) | P2 勝率 (勝/試) | 先攻勝率 (勝/試) | 後攻勝率 (勝/試) |
|---|---|---|---|---|
| **Candidate** | 81.3% (78/96) | 80.2% (77/96) | **84.4%** (81/96) | **77.1%** (74/96) |
| **Offspring #2** | 70.8% (68/96) | 67.7% (65/96) | **68.8%** (66/96) | **69.8%** (67/96) |
| **Offspring #1** | 42.7% (41/96) | 52.1% (50/96) | **41.7%** (40/96) | **53.1%** (51/96) |

### 3.3 対戦相手別成績と座席反転ペア分析

| モデル | 対戦相手 | 勝率 (勝/試) | ペア平均スコア | ペアスコア 95% CI | 両勝 | 分割 | 両敗 |
|---|---|---|---|---|---|---|---|
| **Candidate** | TransferG1Best | 75.0% (48/64) | 0.500 | [0.276, 0.724] | 18 | 12 | 2 |
| Candidate | SeededRandom | 68.8% (44/64) | 0.375 | [0.175, 0.575] | 13 | 18 | 1 |
| Candidate | FirstLegal | 98.4% (63/64) | 0.969 | [0.905, 1.032] | 31 | 1 | 0 |
| **Offspring #2** | TransferG1Best | 64.1% (41/64) | 0.281 | [0.018, 0.544] | 14 | 13 | 5 |
| Offspring #2 | SeededRandom | 53.1% (34/64) | 0.063 | [-0.179, 0.304] | 8 | 18 | 6 |
| Offspring #2 | FirstLegal | 90.6% (58/64) | 0.813 | [0.670, 0.955] | 26 | 6 | 0 |
| **Offspring #1** | TransferG1Best | 35.9% (23/64) | -0.281 | [-0.491, -0.072] | 2 | 19 | 11 |
| Offspring #1 | SeededRandom | 57.8% (37/64) | 0.156 | [-0.105, 0.417] | 11 | 15 | 6 |
| Offspring #1 | FirstLegal | 48.4% (31/64) | -0.031 | [-0.264, 0.202] | 6 | 19 | 7 |

---

## 4. 統計的評価と考察

### 4.1 McNemar 検定（同一試合ペアの直接比較）

同一 Seed・同一相手・同一座席の 192 試合条件で Candidate と Offspring をペア比較しました。

#### Candidate vs Offspring #2
- **分割表**:
  - 両者勝利 ($a$): **112** 試合
  - Candidate のみ勝利 ($b$): **43** 試合
  - Offspring #2 のみ勝利 ($c$): **21** 試合
  - 両者敗北 ($d$): **16** 試合
- **検定結果**:
  - 不一致ペア数 ($b + c$): 64
  - 連続性補正 McNemar 統計量 ($chi^2$): 6.8906
  - **$p$ 値**: **p = 0.0081**
  - **判定**: 統計的有意差あり (p = 0.0081 < 0.05)。帰無仮説は棄却されます。

#### Candidate vs Offspring #1
- **分割表**:
  - 両者勝利 ($a$): **76** 試合
  - Candidate のみ勝利 ($b$): **79** 試合
  - Offspring #1 のみ勝利 ($c$): **15** 試合
  - 両者敗北 ($d$): **22** 試合
- **検定結果**:
  - 不一致ペア数 ($b + c$): 94
  - 連続性補正 McNemar 統計量 ($chi^2$): 42.2234
  - **$p$ 値**: **p < 0.0001**
  - **判定**: 統計的有意差あり (p < 0.0001 < 0.05)。帰無仮説は棄却されます。

### 4.2 Seed 単位のクラスター・ブートストラップ信頼区間

同一 Seed から生成される試合間の依存関係（クラスター効果）を考慮するため、32 個の Seed をクラスター単位として 10,000 回のブートストラップ抽出を実施しました。

- **Candidate vs Offspring #2 の勝率差**:
  - 実測勝率差: **+11.46%**
  - **95% クラスター・ブートストラップ信頼区間**: **[+3.65%, +19.27%]**
  - 信頼区間が 0 を含まず正の領域にあることから、Seed 間のばらつきや依存性を考慮しても、Candidate が共通ベースライン相手に対して統計的に有意に高い汎用勝率を記録していることが確認されます。

- **Candidate vs Offspring #1 の勝率差**:
  - 実測勝率差: **+33.33%**
  - **95% クラスター・ブートストラップ信頼区間**: **[+24.48%, +42.19%]**

---

## 5. 結論と次のステップ

1. **初期手番集計の修正完了**:
   対戦初期の手番プレイヤーから先攻/後攻を判定するよう改修し、先攻・後攻それぞれにおける信頼性の高い勝率データを取得しました。
2. **Seed 92023 の解決**:
   Core 修正により墓地 Unit wrapper 混入が完全に防止され、576 試合が 100% 完走しました。
3. **g0 と g1 の評価結論**:
   - g1 の Offspring #2 は直接対決（Stage C）では Candidate に 19 勝 13 敗で勝ち越した事実が存在するものの、独立した共通ベースライン対戦相手群（TransferG1Best, SeededRandom, FirstLegal）に対する汎用性能では、Candidate の方が統計的に有意に高い勝率を示しました。
   - 1 世代の小規模進化学習（N=6, G=1）では、全般的な性能向上（汎化性能）を統計的に証明するには至っておらず、現在の最優秀個体は初期変異による獲得個体（Candidate）にとどまります。
4. **推奨される次の Work**:
   - 多世代進化学習（G=10 以上）や母集団拡大（N=12 以上）、エリート保存・ホール・オブ・フェイムの導入による本格的な進化検証（Work 2 / Work 3）への移行を推奨します。
