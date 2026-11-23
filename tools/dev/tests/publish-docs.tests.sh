#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
scripts="$repo/tools/dev"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL

target() {
    python3 "$scripts/docs-target.py" "$1"
}

[[ "$(target refs/heads/master)" == master ]]
[[ "$(target refs/heads/develop)" == develop ]]
[[ "$(target refs/heads/9th)" == 9th ]]
[[ "$(target refs/heads/635-kaizen-チュートリアルサイト作成)" == 635-kaizen-チュートリアルサイト作成 ]]
[[ "$(target refs/heads/BlackPoker/issue551-core-flow)" == BlackPoker/issue551-core-flow ]]
[[ "$(target refs/heads/master/nested)" == _branches/* ]]
[[ "$(target refs/heads/master/nested)" != "$(target refs/heads/develop/nested)" ]]
for ref in refs/tags/v9.1.2 refs/heads/MASTER refs/heads/BlackPoker refs/heads/feature/../master; do
    if target "$ref" >/dev/null 2>&1; then
        echo "拒否すべきref: $ref" >&2
        exit 1
    fi
done

cd -- "$scratch"
git init --bare -q remote.git
git init -q -b master initial
git -C initial commit -qm source --allow-empty
git -C initial tag -a v9.1.2 -m test
sha=$(git -C initial rev-parse HEAD)
git -C initial remote add origin "$PWD/remote.git"
git -C initial push -q origin master refs/tags/v9.1.2
export GITHUB_SHA=$sha SOURCE_REMOTE="$PWD/remote.git" RELEASE_TAG=v9.1.2
bash "$scripts/check-docs-source.sh" "$SOURCE_REMOTE" refs/heads/master "$sha" "$RELEASE_TAG"
if bash "$scripts/check-docs-source.sh" "$SOURCE_REMOTE" refs/heads/master "$sha" ''; then
    exit 1
fi

git -C initial switch -q -c develop
git -C initial commit -qm develop --allow-empty
git -C initial push -q origin develop
export GITHUB_REF=refs/heads/develop DOCS_TARGET=develop
if bash "$scripts/check-docs-source.sh" "$SOURCE_REMOTE" "$GITHUB_REF" "$sha" ''; then
    exit 1
fi
export GITHUB_SHA
GITHUB_SHA=$(git -C initial rev-parse HEAD)

git -C initial switch -q -c gh-pages
mkdir -p initial/{master,9th,develop/playtest,develop/tutorial}
for dir in master 9th develop/playtest develop/tutorial; do
    printf 'keep\n' > "initial/$dir/index.html"
done
printf 'old\n' > initial/develop/stale.html
git -C initial add .
git -C initial commit -qm initial-pages
git -C initial push -q origin gh-pages
git clone -qb gh-pages "$SOURCE_REMOTE" pages

mkdir -p site-output/actionlist/html
printf '%s\n' "$GITHUB_SHA" > site-output/build-sha.txt
printf 'new\n' > site-output/index.html
printf 'new\n' > site-output/actionlist/html/all.html

before=$(git -C pages rev-parse HEAD)
if bash "$scripts/publish-docs.sh"; then
    exit 1
fi
[[ "$(git --git-dir=remote.git rev-parse gh-pages)" == "$before" ]]
printf 'pdf\n' > site-output/blackpoker.pdf

# 初回のpushの直前に別の公開を反映し、競合時の再試行を確認する。
mkdir bin
export REAL_GIT TEST_SCRATCH
REAL_GIT=$(command -v git)
TEST_SCRATCH=$PWD
cat > bin/git <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == -C && "${2:-}" == pages && "${3:-}" == push && ! -f "$TEST_SCRATCH/concurrent" ]]; then
    touch "$TEST_SCRATCH/concurrent"
    printf 'other\n' > "$TEST_SCRATCH/initial/other.html"
    "$REAL_GIT" -C "$TEST_SCRATCH/initial" add other.html
    "$REAL_GIT" -C "$TEST_SCRATCH/initial" commit -qm concurrent
    "$REAL_GIT" -C "$TEST_SCRATCH/initial" push -q origin gh-pages
fi
exec "$REAL_GIT" "$@"
SH
chmod +x bin/git
PATH="$PWD/bin:$PATH" bash "$scripts/publish-docs.sh"

[[ "$(git --git-dir=remote.git show gh-pages:other.html)" == other ]]
[[ "$(git --git-dir=remote.git show gh-pages:develop/index.html)" == new ]]
[[ "$(git --git-dir=remote.git show gh-pages:develop/build-sha.txt)" == "$GITHUB_SHA" ]]
for dir in master 9th develop/playtest develop/tutorial; do
    [[ "$(git --git-dir=remote.git show "gh-pages:$dir/index.html")" == keep ]]
done
if git --git-dir=remote.git cat-file -e gh-pages:develop/stale.html 2>/dev/null; then
    exit 1
fi
echo "公開先、安定版の条件、失敗時の維持、並列更新の再試行を確認しました"
