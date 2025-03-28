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

sphinx-build -b html ./source ./docs
sphinx-build -b latex ./source ./docs

# sed /①/\raise0.2ex\hbox{\textcircled{\scriptsize{1}}}/ *.tex

# 索引設定
# mendex -g -d ./source/_mysetting/mydict.dic -s ./source/_mysetting/mystyle.ist docs/blackpoker.idx

cd ./docs

echo "xxxxxxxxxxxxxxxxxxxxx"
rm -f blackpoker.pdf
rm -f blackpoker_book.pdf

sed -i -e 's/♡/{\\normalsize \$\\heartsuit\$} /g' blackpoker.tex
sed -i -e 's/♥/{\\normalsize \$\\heartsuit\$} /g' blackpoker.tex
sed -i -e 's/♠/{\\normalsize \$\\spadesuit\$} /g' blackpoker.tex
sed -i -e 's/♢/{\\normalsize \$\\diamondsuit\$} /g' blackpoker.tex
sed -i -e 's/♦/{\\normalsize \$\\diamondsuit\$} /g' blackpoker.tex
sed -i -e 's/♣/{\\normalsize \$\\clubsuit\$} /g' blackpoker.tex

# TODO 全面的に囲み数字は廃止する予定だが、action-beginに残っており今後修正予定
sed -i -e 's/①/\raise0.2ex\hbox{\textcircled{\scriptsize{1}}} /g' blackpoker.tex
sed -i -e 's/②/\raise0.2ex\hbox{\textcircled{\scriptsize{2}}} /g' blackpoker.tex
sed -i -e 's/③/\raise0.2ex\hbox{\textcircled{\scriptsize{3}}} /g' blackpoker.tex
sed -i -e 's/④/\raise0.2ex\hbox{\textcircled{\scriptsize{4}}} /g' blackpoker.tex
sed -i -e 's/⑤/\raise0.2ex\hbox{\textcircled{\scriptsize{5}}} /g' blackpoker.tex
sed -i -e 's/⑥/\raise0.2ex\hbox{\textcircled{\scriptsize{6}}} /g' blackpoker.tex
sed -i -e 's/⑦/\raise0.2ex\hbox{\textcircled{\scriptsize{7}}} /g' blackpoker.tex
sed -i -e 's/⑧/\raise0.2ex\hbox{\textcircled{\scriptsize{8}}} /g' blackpoker.tex
sed -i -e 's/⑨/\raise0.2ex\hbox{\textcircled{\scriptsize{9}}} /g' blackpoker.tex
sed -i -e 's/⑩/\raise0.2ex\hbox{\textcircled{\scriptsize{10}}} /g' blackpoker.tex
sed -i -e 's/⑪/\raise0.2ex\hbox{\textcircled{\scriptsize{11}}} /g' blackpoker.tex
sed -i -e 's/⑫/\raise0.2ex\hbox{\textcircled{\scriptsize{12}}} /g' blackpoker.tex
sed -i -e 's/⑬/\raise0.2ex\hbox{\textcircled{\scriptsize{13}}} /g' blackpoker.tex
sed -i -e 's/⑭/\raise0.2ex\hbox{\textcircled{\scriptsize{14}}} /g' blackpoker.tex
sed -i -e 's/⑮/\raise0.2ex\hbox{\textcircled{\scriptsize{15}}} /g' blackpoker.tex
sed -i -e 's/⑯/\raise0.2ex\hbox{\textcircled{\scriptsize{16}}} /g' blackpoker.tex
sed -i -e 's/⑰/\raise0.2ex\hbox{\textcircled{\scriptsize{17}}} /g' blackpoker.tex
sed -i -e 's/⑱/\raise0.2ex\hbox{\textcircled{\scriptsize{18}}} /g' blackpoker.tex
sed -i -e 's/⑲/\raise0.2ex\hbox{\textcircled{\scriptsize{19}}} /g' blackpoker.tex
sed -i -e 's/⑳/\raise0.2ex\hbox{\textcircled{\scriptsize{20}}} /g' blackpoker.tex


# sphinx-build -b latex ./source ./docs で LaTeX ソースが生成された後
# ここで画像の PDF を変換する
for f in *.pdf; do
  echo "Fixing bounding box for $f"
  gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite \
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
gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite \
   -dFIXEDMEDIA -dPDFFitPage \
   -dDEVICEWIDTHPOINTS=420 -dDEVICEHEIGHTPOINTS=595 \
   -sOutputFile=blackpoker_a5.pdf blackpoker.pdf

# その後、冊子印刷用の再配置スクリプト（pdfrw等）を実行して、中綴じレイアウトのPDFを生成
# python ../source/_mysetting/booklet_pdfrw.py blackpoker_a5.pdf blackpoker_book.pdf
$PYTHON ../source/_mysetting/booklet_pdfrw.py --padding blackpoker_a5.pdf

# python ../source/_mysetting/booklet_pdfrw.py blackpoker.pdf blackpoker_book.pdf

# cd docs/latex
# make latexpdf
