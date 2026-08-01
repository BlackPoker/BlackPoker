
```
$ mvn compile exec:java -Dexec.mainClass=example.Main -Dexec.args="'Hello World'"
```
```
compile exec:java -Dexec.args="-i original/v5-QA.ods -o ${sitedir}/static/v5-QA.html -t v5-QA"
```

mvn compile exec:java -Dexec.args="'Hello World'"


# TODO
* mavenでjava実行
  * 同じプラグインを複数定義してコマンドからどのargで実行するかをきりかえられうのか？
* tex→pdf生成
  * dockerでやりたい
* ods→yaml
* yamlの構成を最適化


## 実行方法

```
# yaml -> html
mvn install
```

```
docker build --pull --rm -f "Dockerfile" -t actionlist:latest "."
docker run --rm -it -v `pwd`/dist:/dist actionlist:latest
```

## 変更箇所の赤字表示（changed）の自動制御について

HTML出力時に、指定したバージョンで追加・更新された箇所を赤字（`changed` クラス）で強調表示する機能が備わっています。

### 制御方法

`original/version.json` の設定値によって、赤字にするかどうかを自動制御します。

```json
{
  "ver": "第9.1版",
  "lastupdate": "2026/06/30",
  "target_ver": "9.1",
  "beta": false
}
```

- **`target_ver`**: 現在調整中（または赤字表示したい）ターゲットバージョン（例: `"9.1"`, `"10"`)。
- **`beta`**: ベータ調整中フラグ (`true` または `false`)。
  - `beta` が `true` の場合、YAML 内の `since` または `update` に指定されたバージョンが `target_ver` と一致するアクション・キャラクターのみがHTML上で自動的に赤字で強調表示されます。
  - `beta` が `false` の場合は、すべての赤字表示が無効（黒字）になります。正式リリース時には `beta` を `false` にするだけで赤字を消すことができます。
  - 比較の際、`v9.1` と `9.1` のような先頭の `v` の有無は自動的に無視（正規化）されます。

### データ側の書き方

アクションやキャラクターなどのYAMLに `changed: changed` を記述する必要は**ありません**。
通常通り `since: v10.0` や `update: v10.0` のようにバージョン情報を設定するだけで、上記設定と一致した際に自動的に赤字に切り替わります。