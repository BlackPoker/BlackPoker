#!/usr/bin/env python

'''
次のコマンドで使えます。
ActionGen直下に移動後
python python/2up-pdf.1.py ../web-site/static/pdf/blackpoker-v4-extra.pdf

2up-pdf.pyでは、３ページしかない場合、無駄な空白が出力されるため、それを無理やり修正したものになります。
'''

'''
usage:   booklet.py [-p] my.pdf
Creates booklet.my.pdf
Pages organized in a form suitable for booklet printing, e.g.
to print 4 8.5x11 pages using a single 11x17 sheet (double-sided).
The output would be using the same type of sheet
and you can get up to 3 blank sides if -p is enabled.
Otherwise the two sides in the middle will be in original page size
and you can have 1 blank sides at most.
'''

import os
import re
import argparse

from pdfrw import PdfReader, PdfWriter, PageMerge


def fixpage(*pages):
    result = PageMerge() + (x for x in pages if x is not None)
    result[-1].x += result[0].w
    return result.render()


parser = argparse.ArgumentParser()
parser.add_argument("input", help="Input pdf file name")
parser.add_argument("-p", "--padding", action = "store_true",
                    help="Padding the document so that all pages use the same type of sheet")
args = parser.parse_args()

inpfn = args.input
#outfn = 'booklet.' + os.path.basename(inpfn)
outfn = re.sub(".pdf$","",inpfn) + '-2up.pdf'
ipages = PdfReader(inpfn).pages

if args.padding:
    pad_to = 4
else:
    pad_to = 2

# Make sure we have a correct number of sides
print(len(ipages))
ipages += [None]*(-len(ipages)%4)
# ipages += [None]*(-len(ipages)%4)
print(len(ipages))
opages = []

blank = PageMerge()
blank.mbox = [0, 0, 419, 192] # 8.5 x 11
blank = blank.render()

ipages.reverse()

while len(ipages) > 0:
    page1 = ipages.pop()
    if page1 == None :
        page1 = blank
    page2 = ipages.pop()
    if page2 == None :
        page2 = blank
    opages.append(fixpage(page1,page2))
# opages.append(fixpage(ipages[2],blank))
#     # opages.append(fixpage(ipages.pop()))

# opages += ipages

# result = PageMerge() + (x for x in ipages if x is not None)

# opages.append(result.render())

# for x in ipages :
#     if (x is None) :
#         opages.append(None)
#     else :
#         opages.append(x)

# print(ipages)
# print(opages)
PdfWriter(outfn).addpages(opages).write()