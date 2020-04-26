# BlackPoker



## 修正環境構築方法

### pythonインストール
window (choco使用時)
```
choco install python
```
mac (brew使用時)
```
brew install python
```

### venv環境
#### .venv作成
```
python -m venv .venv
```

#### ライブラリインストール
```
# venv環境を有効化
.venv/bin/activate
# venvライブラリインストール
pip install -r ./requirements.txt
```

## ドキュメント生成
### PDF生成方法
```
＃ venv activate後
make latexpdf
```

### HTML生成
```
＃ venv activate後
sphinx-build -b html ./source ./docs
```



