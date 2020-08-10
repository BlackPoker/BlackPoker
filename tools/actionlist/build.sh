sh ./tex/tex2pdf.sh blackpoker-v5-std
python3 ./python/2up-pdf.1.py ./tex/blackpoker-v5-std.pdf
cp ./tex/*.pdf ./dist