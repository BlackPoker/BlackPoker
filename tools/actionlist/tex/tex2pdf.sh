#!/bin/sh

export PATH="/Applications/TeXLive/Library/texlive/2016/bin/x86_64-darwin:$PATH"

# 移動
SCRIPT_DIR=$(cd $(dirname $0); pwd)
cd $SCRIPT_DIR

echo "$1.tex"

rm "$1.dvi"
rm "$1.pdf"
rm "$1.aux"
rm "$1.log"

#/Applications/TeXLive/Library/texlive/2016/bin/x86_64-darwin/platex "$1.tex"
#/Applications/TeXLive/Library/texlive/2016/bin/x86_64-darwin/dvipdfmx "$1"

platex "$1.tex"
dvipdfmx "$1"
