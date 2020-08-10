
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
# ods->html
mvn compile exec:java
```

```
docker build --pull --rm -f "Dockerfile" -t actionlist:latest "."
docker run --rm -it -v `pwd`/dist:/dist actionlist:latest
```