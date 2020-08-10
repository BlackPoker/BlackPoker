# 参考 QRコード生成
# https://qiita.com/ak1procom/items/c9da5d5f1039adea9704
# pip install pillow qrcode

# 参考 画像をpdfに変換
# https://qiita.com/daikan_murata/items/e1c38db8b41d141f12d8
# pip install img2pdf

# 使い方 2017/07/23
# pythonで実行して、生成したpng,pdfをtexフォルダに移動して使います。

import qrcode
import os
import img2pdf

def cnv(url:str,filename:str) -> None:
    img = qrcode.make(url)
    img.save(filename + ".png")
    with open(filename + ".pdf","wb") as f:
        f.write(img2pdf.convert(filename+".png"))

# cnv('https://blackpoker-support.appspot.com/','qr_blackpoker-support')
# cnv('https://blackpoker-support.appspot.com/v4-lite','qr_blackpoker-support_v4-lite')
# cnv('https://blackpoker-support.appspot.com/v4-std','qr_blackpoker-support_v4-std')
# cnv('https://blackpoker-support.appspot.com/v4-ex','qr_blackpoker-support_v4-ex')

# cnv('https://blackpoker-support.appspot.com/v5-lite','qr_blackpoker-support_v5-lite')
# cnv('https://blackpoker-support.appspot.com/v5-std','qr_blackpoker-support_v5-std')
# cnv('https://blackpoker-support.appspot.com/v5-ex','qr_blackpoker-support_v5-ex')
cnv('https://blackpoker-support.appspot.com/v5-pro','qr_blackpoker-support_v5-pro')
