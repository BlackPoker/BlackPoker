#!/bin/bash

create () {
    cd /tex

    # export PATH="/Applications/TeXLive/Library/texlive/2016/bin/x86_64-darwin:$PATH"

    # 移動
    # SCRIPT_DIR=$(cd $(dirname $0); pwd)
    # cd $SCRIPT_DIR

    echo "$1.tex"

    ls -la .

    rm -f "$1.dvi"
    rm -f "$1.pdf"
    rm -f "$1.aux"
    rm -f "$1.log"

    #/Applications/TeXLive/Library/texlive/2016/bin/x86_64-darwin/platex "$1.tex"
    #/Applications/TeXLive/Library/texlive/2016/bin/x86_64-darwin/dvipdfmx "$1"

    if [ -f "$1.tex" ]; then
        platex "$1.tex"
        dvipdfmx "$1"

        cd ../
        if [ -f "./python/2up-pdf.1.py" ]; then
            python3 ./python/2up-pdf.1.py "./tex/$1.pdf"
        fi
        cp "./tex/$1.pdf" ./dist/ 2>/dev/null || true
    else
        echo "File $1.tex not found, skipping."
        cd ../
    fi
    cp -r ./web-site ./dist/ || true
}

create blackpoker-lite
create blackpoker-std
create blackpoker-pro
create blackpoker-mast
create blackpoker-all
create blackpoker-extra

echo "ls -la ."
ls -la .

echo "ls -la .."
ls -la ..

echo "ls -la /usr/local/source/auto"
ls -la /usr/local/source/auto

mkdir -p ./dist/source/auto
cp -r /usr/local/source/auto/* ./dist/source/auto/

echo "ls -la ./dist/source/auto"
ls -la ./dist/source/auto

