#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
expected_target=$(python3 "$script_dir/docs-target.py" "$GITHUB_REF")
[[ "$DOCS_TARGET" == "$expected_target" ]]
[[ "$(cat site-output/build-sha.txt)" == "$GITHUB_SHA" ]]
test -s site-output/index.html
test -s site-output/blackpoker.pdf
test -s site-output/actionlist/html/all.html

git -C pages config user.name "github-actions[bot]"
git -C pages config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# 別workflowが先に公開した場合は、新しい先端の上で対象だけを再適用する。
for attempt in 1 2 3 4 5; do
    git -C pages fetch --no-tags origin refs/heads/gh-pages
    git -C pages reset --hard FETCH_HEAD
    target=pages
    IFS=/ read -ra components <<< "$DOCS_TARGET"
    for component in "${components[@]}"; do
        target="$target/$component"
        [[ ! -L "$target" ]]
        mkdir -p -- "$target"
    done

    rsync -a --delete --exclude='/playtest/' --exclude='/tutorial/' -- site-output/ "$target/"
    git -C pages add -- "$DOCS_TARGET"
    if git -C pages diff --cached --quiet; then
        exit 0
    fi
    git -C pages commit -m "docs: 公式ルールの公開成果物を更新"
    bash "$script_dir/check-docs-source.sh" "$SOURCE_REMOTE" "$GITHUB_REF" "$GITHUB_SHA" "$RELEASE_TAG"
    if git -C pages push origin HEAD:refs/heads/gh-pages; then
        exit 0
    fi
    if [[ "$attempt" != 5 ]]; then
        sleep 3
    fi
done
echo "gh-pagesの更新に失敗しました" >&2
exit 1
