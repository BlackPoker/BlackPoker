==============================
第8版の主な変更点
==============================

次はBlackPoker第8版における主要な変更点です。


能力の解釈を変更
------------------------------

第7版では、能力は「常在型能力」と「誘発型能力」の2種類が定義されていました。  

第8版では、能力の解釈を整理し、アクションに「起動条件」と「誘発条件」を追加することで、能力は常在型能力のみを指すものとしました。  

この変更により、エクストラリストに大きな影響が生じたため、エクストラは一旦非表示としています。  
なお、コアルール内において能力の影響範囲についての記載を追加しています。


フォグ領域追加
------------------------------

新たに「フォグ領域」を追加しました。  

この領域は、「アップ」や「ダウン」など、ターン終了時まで効果が持続する要素を配置するためのもので、効果が視認しやすくなっています。  
また、領域追加に伴い、新たにフォグリストも導入しました。


用語追加
------------------------------

ルールの分かりやすさ向上を目的として、以下の用語を新たに導入しました。

【キャラクター関連】
    - ラベル
    - サイズ

【アクション関連】
    - リクエスト
    - トリガー
    - スピード
    - 起動条件
    - 誘発条件


オプション削除とフレームへの統合
------------------------------------------------------------

第7版では対戦レギュレーションにオプションが存在していましたが、  
第8版ではオプションを削除し、各フレームに統合することで全体の遊び方の整理を図りました。  

また、新たな構築要素として「ストラテジー」を導入しています。  
結果として、フレームは以下の4種類のみとし、その他は廃止しました。

- エントリー20
- パック
- レアパック
- ストラテジー

さらに、ハーフ系が廃止されたため、マッチに関する説明も削除しています。  
今後、エクストラをフレームとして復活させる予定です。


曖昧なルールの明確化
------------------------------

以下の点について、ルールの曖昧な部分を明確化しました。

- 能力の影響範囲をコアルールに明記
- 誘発チェックのフローを詳細化
- コアフロー内で能力を確認するタイミングを追加
- 共通ルールおよびコアルールにおいて、リクエストの解決が完了するまでリクエストがステージ上に残ることを明記
- フォグを配置する際のカードの向きを記載
- ステージ上にあるキーカードの配置方法を記載
- コンポーネントインスタンスの概念を導入
- 共通ルールに記載されていた引き分けの記述を修正し、引き分けとならないよう変更


ルール外変更点
------------------------------

ルール本体に直接関係しない部分について、以下の変更を実施しました。

- コアルールの章を後ろに配置し、最初から読めばルール全体が理解できる章構成に変更
- 新たにフレームの章を設け、フォーマットや章内にアクションリストなどを含む構成に変更
- HTML版のアクションリストで、フレーム依存のアクションも表示されるよう修正
- 各アクション、キャラクター、フォグの導入バージョンなど、細かな情報を記載
- PDF版に索引を追加
- PDF版の表紙を、新ロゴをあしらった新デザインに変更
- アクションなどのyaml定義に対してjsonスキーマを作成
- 変更履歴を公式ルール内に記載
- 中綴じ印刷用のPDFを追加
