#!/bin/bash
# 利用可能な Python コマンドを自動で選択する
if command -v python >/dev/null 2>&1; then
    PYTHON=python
elif command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
elif command -v py >/dev/null 2>&1; then
    PYTHON=py
else
    echo "Python interpreter not found. Please install Python."
    exit 1
fi
set -e

sphinx-build -b html ./source ./docs
sphinx-build -b latex ./source ./docs

# sed /①/\raise0.2ex\hbox{\textcircled{\scriptsize{1}}}/ *.tex

# 索引設定
# mendex -g -d ./source/_mysetting/mydict.dic -s ./source/_mysetting/mystyle.ist docs/blackpoker.idx

cd ./docs

echo "xxxxxxxxxxxxxxxxxxxxx"
rm -f blackpoker.pdf
rm -f blackpoker_book.pdf
rm -f *.toc *.aux *.out *.idx *.ind *.ilg

sed -i -e 's/♡/\\heartsym{} /g' blackpoker.tex
sed -i -e 's/♥/\\heartsym{} /g' blackpoker.tex
sed -i -e 's/♠/\\spadesym{} /g' blackpoker.tex
sed -i -e 's/♢/\\diamondsym{} /g' blackpoker.tex
sed -i -e 's/♦/\\diamondsym{} /g' blackpoker.tex
sed -i -e 's/♣/\\clobsym{} /g' blackpoker.tex

# TODO 全面的に囲み数字は廃止する予定だが、action-beginに残っており今後修正予定
sed -i -e 's/①/\\circlednum{1} /g' blackpoker.tex
sed -i -e 's/②/\\circlednum{2} /g' blackpoker.tex
sed -i -e 's/③/\\circlednum{3} /g' blackpoker.tex
sed -i -e 's/④/\\circlednum{4} /g' blackpoker.tex
sed -i -e 's/⑤/\\circlednum{5} /g' blackpoker.tex
sed -i -e 's/⑥/\\circlednum{6} /g' blackpoker.tex
sed -i -e 's/⑦/\\circlednum{7} /g' blackpoker.tex
sed -i -e 's/⑧/\\circlednum{8} /g' blackpoker.tex
sed -i -e 's/⑨/\\circlednum{9} /g' blackpoker.tex
sed -i -e 's/⑩/\\circlednum{10} /g' blackpoker.tex
sed -i -e 's/⑪/\\circlednum{11} /g' blackpoker.tex
sed -i -e 's/⑫/\\circlednum{12} /g' blackpoker.tex
sed -i -e 's/⑬/\\circlednum{13} /g' blackpoker.tex
sed -i -e 's/⑭/\\circlednum{14} /g' blackpoker.tex
sed -i -e 's/⑮/\\circlednum{15} /g' blackpoker.tex
sed -i -e 's/⑯/\\circlednum{16} /g' blackpoker.tex
sed -i -e 's/⑰/\\circlednum{17} /g' blackpoker.tex
sed -i -e 's/⑱/\\circlednum{18} /g' blackpoker.tex
sed -i -e 's/⑲/\\circlednum{19} /g' blackpoker.tex
sed -i -e 's/⑳/\\circlednum{20} /g' blackpoker.tex


# sphinx-build -b latex ./source ./docs で LaTeX ソースが生成された後
# ここで画像の PDF を変換する
for f in *.pdf; do
  echo "Fixing bounding box for $f"
  gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite \
     -dEPSCrop \
     -dCompatibilityLevel=1.4 \
     -sOutputFile="fixed_$f" "$f"
  mv "fixed_$f" "$f"
done


# sphinx-build -M latexpdf ./source ./docs

# 以下のwarn解消のため複数回実行
# Package hyperref Warning: Rerun to get /PageLabels entry.
platex "blackpoker.tex"

#mendex -g -d ../source/_mysetting/mydict.dic -s ../source/_mysetting/mystyle.ist blackpoker.idx
mendex -g -d ../source/_mysetting/mydict.dic blackpoker.idx

platex "blackpoker.tex"
platex "blackpoker.tex"

dvipdfmx "blackpoker"


# SphinxビルドでletterサイズのPDF (blackpoker.pdf) が生成された後

# まず、ghostscriptでletterサイズのPDFをA5に縮小して出力する
gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite \
   -dFIXEDMEDIA -dPDFFitPage \
   -dDEVICEWIDTHPOINTS=420 -dDEVICEHEIGHTPOINTS=595 \
   -sOutputFile=blackpoker_a5.pdf blackpoker.pdf

# その後、冊子印刷用の再配置スクリプト（pdfrw等）を実行して、中綴じレイアウトのPDFを生成
# python ../source/_mysetting/booklet_pdfrw.py blackpoker_a5.pdf blackpoker_book.pdf
$PYTHON ../source/_mysetting/booklet_pdfrw.py --padding blackpoker_a5.pdf

# python ../source/_mysetting/booklet_pdfrw.py blackpoker.pdf blackpoker_book.pdf

# cd docs/latex
# make latexpdf
