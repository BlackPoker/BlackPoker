#!/bin/bash

rm -rf ./docs/*

# ログファイル名を指定（例: build.log）
sh docker-build.sh 2>&1 | tee local-build.log
