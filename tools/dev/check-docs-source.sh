#!/usr/bin/env bash
set -euo pipefail

remote=$1
ref=$2
sha=$3
release_tag=$4
refs=("$ref")

if [[ "$ref" == refs/heads/master ]]; then
    if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "masterの公開には正式リリースタグ (vX.Y.Z) が必要です" >&2
        exit 1
    fi
    tag_ref="refs/tags/$release_tag"
    refs+=("$tag_ref" "$tag_ref^{}")
fi

remote_refs=$(git ls-remote "$remote" "${refs[@]}")
head_sha=$(awk -v ref="$ref" '$2 == ref { print $1 }' <<< "$remote_refs")
if [[ "$head_sha" != "$sha" ]]; then
    echo "生成元SHAが現在のブランチ先端と一致しません" >&2
    exit 1
fi

if [[ "$ref" == refs/heads/master ]]; then
    tag_sha=$(awk -v ref="$tag_ref" '$2 == ref { tag = $1 } $2 == ref "^{}" { peeled = $1 } END { print peeled ? peeled : tag }' <<< "$remote_refs")
    if [[ "$tag_sha" != "$sha" ]]; then
        echo "正式リリースタグが対象SHAを指していません" >&2
        exit 1
    fi
fi
