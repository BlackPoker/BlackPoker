#!python3
# -*- coding:utf-8 -*-

from PyPDF2 import PdfFileMerger
import os
import re
import sys
import argparse



# PDFを結合

parser = argparse.ArgumentParser()
parser.add_argument("input", help="Input pdf file name")
parser.add_argument("add_pdf", help="Add pdf file name")
parser.add_argument("add_size", help="Add size")
parser.add_argument("output", help="Output pdf file name")
args = parser.parse_args()

inpfn = args.input
oupfn = args.output
add_size = int(args.add_size,10)

filelist = [inpfn]

for var in range(0, add_size):
    filelist.append(args.add_pdf)

print(filelist)

merger = PdfFileMerger()

for file in filelist:
    merger.append(file)

if(inpfn != oupfn):
    merger.write(oupfn)
    merger.close()
    sys.exit()

merger.write(oupfn+"_")
merger.close()
# PDFファイルをstaticフォルダ配下にコピー
import shutil
shutil.move(oupfn+"_",oupfn)
