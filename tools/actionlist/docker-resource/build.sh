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

    platex "$1.tex"
    dvipdfmx "$1"

    cd ../

    python3 ./python/2up-pdf.1.py "./tex/$1.pdf"
    cp ./tex/*.pdf ./dist
    cp -r ./web-site ./dist/.
    cp -r ../../source/format/auto ./dist/.
}

create blackpoker-lite
create blackpoker-std
create blackpoker-pro
create blackpoker-mast
# create blackpoker-extra