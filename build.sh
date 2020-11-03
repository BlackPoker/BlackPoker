# activateして実行する

rm -rf ./docs/*

sphinx-build -b html ./source ./docs

# TODO PDFの生成を追加

mkdir -p docs/actionlist/html
mkdir -p docs/actionlist/pdf

cp -r tools/actionlist/dist/web-site/static/* docs/actionlist/html

# TODO ActionListnoPDFコピーも行う。