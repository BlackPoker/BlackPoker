# activateして実行する

rm -rf ./docs/*

# アクションリスト生成
cd tools/actionlist
rm -rf dist/*
docker build --pull --rm -f "Dockerfile" -t actionlist:latest "."
docker run --rm -it -v `pwd`/dist:/dist actionlist:latest

cd -
. .venv/bin/activate
sphinx-build -b html ./source ./docs

# TODO PDFの生成を追加

mkdir -p docs/actionlist/html
mkdir -p docs/actionlist/pdf

cp -r tools/actionlist/dist/web-site/static/* docs/actionlist/html
cp -r tools/actionlist/dist/blackpoker-v6*.pdf docs/actionlist/pdf

deactivate
