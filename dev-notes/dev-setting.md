# 修正環境構築方法

<!-- @import "[TOC]" {cmd="toc" depthFrom=1 depthTo=6 orderedList=false} -->

<!-- code_chunk_output -->

- [修正環境構築方法](#修正環境構築方法)
- [remote-container有り](#remote-container有り)
- [remote-container無し](#remote-container無し)
  - [pythonインストール](#pythonインストール)
    - [window (choco使用時)](#window-choco使用時)
    - [mac (brew使用時)](#mac-brew使用時)
  - [plantumlインストール](#plantumlインストール)
    - [window (choco使用時)](#window-choco使用時-1)
    - [mac (brew使用時)](#mac-brew使用時-1)
  - [venv環境](#venv環境)
    - [.venv作成](#venv作成)
    - [ライブラリインストール](#ライブラリインストール)
    - [ライブラリの追加](#ライブラリの追加)
  - [autobuild起動](#autobuild起動)
  - [HTML生成](#html生成)
- [PDF生成コマンド](#pdf生成コマンド)
- [redpen実行](#redpen実行)
- [フォルダ構成](#フォルダ構成)

<!-- /code_chunk_output -->



# remote-container有り
1. dockerインストール
1. vscodeインストール
1. remote-containerプラグインインストール
1. dockerを起動してremote-containerに入る


# remote-container無し

## pythonインストール

pythonは3.7系がsphinx-autobuildが利用できるためおすすめです。

すでに入っている方は、飛ばしてください。

### window (choco使用時)
```
choco install -y python --version=3.7.5
```
### mac (brew使用時)
```
$ brew install pyenv
```
~/.bash_profileまたは、~/.zshrcに以下を追加
```
export PYENV_ROOT=${HOME}/.pyenv
if [ -d "${PYENV_ROOT}" ]; then
    export PATH=${PYENV_ROOT}/bin:$PATH
    eval "$(pyenv init -)"
fi
```
pythonをバージョン指定してインストールし
```
$ pyenv install 3.7.7
$ pyenv global 3.7.7
```

## plantumlインストール
### window (choco使用時)
```
choco install plantuml
```
### mac (brew使用時)
```
$ brew install plantuml
```


## venv環境
### .venv作成
```
$ python -m venv .venv
```

### ライブラリインストール
```
# venv環境を有効化
. .venv/bin/activate
# もしくは
source .venv/bin/activate
# venvライブラリインストール
(.venv) $ pip install -r ./requirements.txt
```

```
# venv環境を無効化する場合
deactivate
```

### ライブラリの追加
ライブラリの一覧をファイルに出力し、インストールするライブラリ一覧を更新する
```
pip freeze > requirements.txt
```

## autobuild起動
autobuildを起動するとブラウザで確認しながら執筆できます。
```
(.venv) $ sphinx-autobuild ./source ./docs
# もしくは
(.venv) $ make livehtml
```

## HTML生成
autobuildで反映されない部分が実行すると、反映されるかもしれません。
```
(.venv) $ make buildhtml
```


# PDF生成コマンド
PDF生成は、dockerコマンドで実行します。
リモートコンテナを使っている場合は、リモートコンテナ外で実行してください。

```
docker build --pull --rm -f "Dockerfile" -t blackpoker-doc:latest "."
docker run --rm -it -v `pwd`/docs:/docs blackpoker-doc:latest 
```

# redpen実行
文章の確認でredpenを使うことができます。
実行方法は、以下を参照してください。

[[../redpen/redpen.md]]


# フォルダ構成
```
BlackPoker
├── Dockerfile                  :公式ルール用HTML,PDF生成Dockerfile
├── Makefile                    :sphinxのビルド設定
├── README.md                   : 
├── base-docker                 :blackpoker-doc-baseのイメージ
├── build                       :make livehtml/buildhtmlのビルド結果格納
├── build.sh                    :不要か？
├── dev-notes                   :開発者用メモ
├── docker-build.sh             :公式ルール用Dockerfile内で利用
├── docs                        :公式ルール用Dockerfile内でマウントし結果を出力
├── drawio                      :未使用
├── make.bat                    :windows用makeファイル。未使用、未メンテナンス
├── node_modules                :node.jsでダウンロードされたライブラリ郡
├── out                         :plantumlで画像出力した際の出力先
├── redpen                      :文書検証ツールredpen関連の設定など格納
├── requirements.txt            :pythonの必要ライブラリ郡
├── source                      :BlackPoker公式ルール
│   ├── _build                  :不要か？
│   ├── _static                 :静的ファイル
│   ├── _templates              :レイアウトテンプレート
│   ├── appendix                :章（付録）
│   ├── common                  :章（共通ルール）
│   ├── conf.py                 :sphinx設定ファイル
│   ├── core                    :章（コアルール）
│   ├── format                  :章（フォーマット）
│   ├── glossary
│   │   └── glossary._rst
│   ├── index.rst               :章（目次）
│   ├── init                    :章（はじめに）
│   └── match-regulations       :章（対戦レギュレーション）
├── src                         :用途不明。不要？
└── tools                       :ツール関連
    └── actionlist              :アクションリスト、エクストラリスト生成ツール
        ├── Dockerfile          :使用しているか不明。アクションリスト生成用
        ├── README.md
        ├── base-docker         :使用しているか不明。actionlist-base用Dockerイメージ
        ├── docker-resource     :Dockerfile内で利用するリソースファイル
        ├── original            :アクションリスト、エクストラリスト定義
        │   ├── act.yaml        :アクションリスト定義
        │   ├── extra.yaml      :エクストラリスト定義
        │   └ ...
        ├── pom.xml             :ツール用pom.xml
        ├── python              :pythonツール
        ├── src
        │   ├── main
        │   │   ├── java        :ツール用javaソース
        │   │   └── resources   :velocityテンプレート
        │   └── test            :テストケース
        ├── target              :ビルド結果
        ├── tex                 :生成されたtexファイル
        └── web-site            :生成されたHTMLファイル
```