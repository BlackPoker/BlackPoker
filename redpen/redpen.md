
# インストール

```
curl -L -o redpen-1.10.4.tar.gz https://github.com/redpen-cc/redpen/releases/download/redpen-1.10.4/redpen-1.10.4.tar.gz 
tar xvf redpen-*.tar.gz
cd redpen-distribution-1.10.4
bin/redpen -c conf/redpen-conf-en.xml sample-doc/en/sampledoc-en.txt
```

# rstに対して実行

以下のコマンドをvscodeのターミナルで実行する。ファイルリンクをcmdを押しながらクリックし遷移した後、修正する
```
redpen/redpen-distribution-1.10.4/bin/redpen -c redpen/redpen-config-ja.xml -f rest -r plain2 source/**/*.rst
```