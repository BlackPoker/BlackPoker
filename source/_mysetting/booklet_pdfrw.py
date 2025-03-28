#!/usr/bin/env python3
import os
import re
import argparse
from pdfrw import PdfReader, PdfWriter, PageMerge, PdfDict

def create_blank_page_a5():
    """
    A5サイズ（420×595 pt）の空白ページを作成
    """
    return PdfDict(
        Type='/Page',
        MediaBox=[0, 0, 420, 595],
        Contents=PdfDict(stream=''),
        Resources=PdfDict()
    )

def fixpage(*pages):
    """
    2つまでのページを横に並べて1ページにまとめる。
    None は除外し、各ページに MediaBox 情報が無ければデフォルトを設定します。
    """
    real_pages = []
    for p in pages:
        if p is not None:
            if not p.get('/MediaBox'):
                p.MediaBox = [0, 0, 420, 595]
            real_pages.append(p)
    if not real_pages:
        return None

    pm = PageMerge() + real_pages
    if len(pm) > 1:
        if pm[0].w is None:
            pm[0].w = 0
        pm[1].x += pm[0].w
    return pm.render()

def main():
    parser = argparse.ArgumentParser(
        description="Create a booklet PDF (2-up, short-edge binding)."
    )
    parser.add_argument("input", help="Input PDF file name")
    parser.add_argument("-p", "--padding", action="store_true",
                        help="Pad the document so pages are a multiple of 4")
    args = parser.parse_args()

    inpfn = args.input
    outfn = re.sub(r"\.pdf$", "", inpfn) + "-booklet.pdf"

    ipages = PdfReader(inpfn).pages
    num_pages = len(ipages)

    # pad_to: --paddingなら4の倍数、そうでなければ2の倍数に合わせる
    pad_to = 4 if args.padding else 2
    remainder = num_pages % pad_to
    if remainder != 0:
        # None ではなく、空白の A5 ページを追加
        for _ in range(pad_to - remainder):
            ipages.append(create_blank_page_a5())
    total = len(ipages)

    # 中綴じ用ページ並び順の計算（4ページ単位）
    if args.padding:
        num_sheets = total // 4
    else:
        num_sheets = total // 2

    opages = []
    last = total - 1

    for i in range(num_sheets):
        # 表面: 左 = ipages[last - (2*i)], 右 = ipages[2*i]
        fl = ipages[last - (2 * i)]
        fr = ipages[2 * i]
        front = fixpage(fl, fr)
        if front:
            opages.append(front)
        # 裏面: 左 = ipages[2*i + 1], 右 = ipages[last - (2*i) - 1]
        bl = ipages[2 * i + 1] if (2 * i + 1) < total else create_blank_page_a5()
        br = ipages[last - (2 * i) - 1] if (last - (2 * i) - 1) >= 0 else create_blank_page_a5()
        back = fixpage(bl, br)
        if back:
            opages.append(back)

    PdfWriter(outfn).addpages(opages).write()
    print(f"Created booklet PDF: {outfn}")

if __name__ == "__main__":
    main()
