#!/bin/sh
# tools/drawio_export.sh
# このスクリプトは rlespinasse/drawio-export コンテナ内で実行されることを想定しています。

set -e

# 作業ディレクトリを確認 (/data にマウントされている前提)
cd /data

# Start Xvfb (required for headless drawio)
# すでに起動している可能性も考慮し、エラーは無視する
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99
 sleep 1
 
 # .drawio ファイルを再帰的に検索
IFS='
'
for f in $(find source -name "*.drawio"); do
    base="${f%.drawio}"
    
    for ext in svg png pdf; do
        target="${base}.${ext}"
        # 出力ファイルが存在しない、またはソースの方が新しい場合
        if [ ! -f "$target" ] || [ "$f" -nt "$target" ]; then
            echo "Updating $f -> $ext"
            # --crop でPDFの余白をカット
            # -b 5 で少しだけ余白(5px)を追加
            /opt/drawio-exporter/drawio-exporter -o . --remove-page-suffix --crop -b 5 --format "$ext" "$f" > /dev/null
        fi
    done
done

echo "Draw.io export process completed."
