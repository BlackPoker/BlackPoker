#!/bin/bash

set -e  # コマンドが失敗したらスクリプトを終了

create () {
    cd ./tex

    echo "Processing $1.tex"

    ls -la .

    # 古いファイルを削除
    rm -f "$1.dvi" "$1.pdf" "$1.aux" "$1.log"

    # LaTeX コンパイル
    if ! platex "$1.tex"; then
        echo "Error: LaTeX compilation failed for $1.tex"
        exit 1
    fi

    # DVI から PDF 変換
    if ! dvipdfmx "$1"; then
        echo "Error: DVI to PDF conversion failed for $1.dvi"
        exit 1
    fi

    cd ../

    # pdfrw のインストール確認
    if ! python3 -c "import pdfrw" 2>/dev/null; then
        echo "Error: pdfrw module is not installed. Run 'pip install pdfrw'."
        exit 1
    fi

    python3 ./python/2up-pdf.1.py "./tex/$1.pdf"

    # dist ディレクトリがない場合は作成
    mkdir -p ./dist

    # 生成したPDFを dist にコピー
    cp ./tex/*.pdf ./dist
    cp -r ./web-site ./dist/.
}

# 一括処理
for doc in blackpoker-lite blackpoker-std blackpoker-pro blackpoker-mast blackpoker-extra; do
    create "$doc"
done
