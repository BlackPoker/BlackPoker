#!/usr/bin/env python3
import sys
from pdfrw import PdfReader, PdfWriter, PageMerge, PdfDict

def get_media_box(page, reader):
    """
    指定ページからMediaBoxを再帰的に取得する関数。
    見つからなければ、reader.Root.PagesのMediaBox、またはデフォルトのA4サイズを返します。
    """
    # ページに直接MediaBoxが設定されている場合
    mb = getattr(page, 'MediaBox', None)
    if mb:
        return mb
    # ページのinheritable属性が存在する場合は取得を試みる
    inheritable = getattr(page, 'inheritable', None)
    if inheritable:
        mb = inheritable.get('MediaBox')
        if mb:
            return mb
    # 親オブジェクトから取得
    parent = page.get('/Parent')
    if parent:
        mb = parent.get('/MediaBox')
        if mb:
            return mb
        inheritable = parent.get('inheritable', None)
        if inheritable:
            mb = inheritable.get('MediaBox')
            if mb:
                return mb
    # ルートのPagesから取得
    pages_dict = reader.Root.get('Pages', None)
    if pages_dict:
        mb = pages_dict.get('/MediaBox')
        if mb:
            return mb
    print("MediaBoxが見つかりませんでした。デフォルトのA4サイズを使用します。")
    return [0, 0, 595, 842]

def create_blank_page(width, height):
    """
    指定サイズの空白ページを作成します。
    """
    return PdfDict(
        Type='/Page',
        MediaBox=[0, 0, width, height],
        Contents=PdfDict(stream=''),
        Resources=PdfDict()
    )

def main():
    if len(sys.argv) < 3:
        print("使い方: python booklet_pdfrw.py input.pdf output.pdf")
        sys.exit(1)

    input_pdf_path = sys.argv[1]
    output_pdf_path = sys.argv[2]

    # 入力PDFの読み込み
    reader = PdfReader(input_pdf_path)
    pages = reader.pages
    num_pages = len(pages)

    # 1ページ目から用紙サイズ（幅・高さ）を取得
    media_box = get_media_box(pages[0], reader)
    w = float(media_box[2])
    h = float(media_box[3])

    # 総ページ数が4の倍数になるように空白ページを追加
    remainder = num_pages % 4
    num_blank = 4 - remainder if remainder != 0 else 0
    for _ in range(num_blank):
        blank_page = create_blank_page(w, h)
        pages.append(blank_page)
    total_pages = len(pages)

    # 1枚のシートあたり4ページ（両面印刷時に左右2ページずつ配置）となるのでシート数を計算
    num_sheets = total_pages // 4

    # 中綴じ用のページ順序を計算
    booklet_order = []
    for i in range(num_sheets):
        # 表面：左に (最後から 2*i 番目), 右に (最初から 2*i 番目)
        left_front = total_pages - (2 * i) - 1
        right_front = 2 * i
        booklet_order.append((left_front, right_front))
        # 裏面：左に (最初から 2*i+1 番目), 右に (最後から 2*i+1 番目)
        left_back = 2 * i + 1
        right_back = total_pages - (2 * i) - 2
        booklet_order.append((left_back, right_back))

    output_pages = []
    # 各物理ページ（片面）を生成：新規ページは横幅が元の2ページ分
    for left_idx, right_idx in booklet_order:
        new_page = PdfDict(
            Type='/Page',
            MediaBox=[0, 0, 2 * w, h],
            Resources=PdfDict()
        )
        merger = PageMerge(new_page)
        left_page = pages[left_idx]
        merger.add(left_page, transform=[1, 0, 0, 1, 0, 0])
        right_page = pages[right_idx]
        merger.add(right_page, transform=[1, 0, 0, 1, w, 0])
        merger.render()
        output_pages.append(new_page)

    writer = PdfWriter()
    writer.addpages(output_pages)
    writer.write(output_pdf_path)
    print(f"中綴じ用 PDF を {output_pdf_path} に出力しました。")

if __name__ == "__main__":
    main()
