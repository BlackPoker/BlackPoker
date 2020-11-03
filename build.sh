# activateして実行する

rm -rf ./docs/*

sphinx-build -b html ./source ./docs

mkdir -p docs/actionlist/html
mkdir -p docs/actionlist/pdf

cp -r tools/actionlist/dist/web-site/static/* docs/actionlist/html