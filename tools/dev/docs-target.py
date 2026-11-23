"""Gitブランチ名をルールサイトの公開先に対応付ける。"""

from hashlib import sha256
import sys
import unicodedata


def safe_segment(value):
    return (
        bool(value)
        and value[0].isalnum()
        and all(c.isalnum() or c in "._-" for c in value)
        and ".." not in value
        and not value.endswith(".")
    )


def docs_target(ref):
    if not ref.startswith("refs/heads/"):
        raise ValueError("ブランチを指定してください")
    name = ref.removeprefix("refs/heads/")
    parts = name.split("/")
    if not all(safe_segment(part) for part in parts):
        raise ValueError("公開に使えないブランチ名です")

    reserved = {"master", "develop", "gh-pages", "blackpoker", "index.html"}
    first = unicodedata.normalize("NFC", parts[0]).casefold()
    generation = first[:-2].isascii() and first[:-2].isdigit() and first.endswith("th")
    if len(parts) == 1:
        if first in {"gh-pages", "blackpoker", "index.html"}:
            raise ValueError("公開先として予約されています")
        if (first in reserved or generation) and name != first:
            raise ValueError("正式公開先と区別できない名前です")
        return name

    # 従来の BlackPoker/<ブランチ> の確認URLを維持する。
    if len(parts) == 2 and parts[0] == "BlackPoker":
        return name
    return "_branches/" + sha256(name.encode()).hexdigest()


if __name__ == "__main__":
    try:
        print(docs_target(sys.argv[1]))
    except ValueError as error:
        sys.exit(str(error))
