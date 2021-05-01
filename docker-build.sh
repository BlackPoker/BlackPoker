#!/bin/bash
sphinx-build -b html ./source ./docs
sphinx-build -b latex ./source ./docs

# sed /①/\raise0.2ex\hbox{\textcircled{\scriptsize{1}}}/ *.tex

cd ./docs

echo "xxxxxxxxxxxxxxxxxxxxx"

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


# sphinx-build -M latexpdf ./source ./docs
platex "blackpoker.tex"
dvipdfmx "blackpoker"

# cd docs/latex
# make latexpdf
