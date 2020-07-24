# BlackPoker



## 修正環境構築方法

### pythonインストール

pythonは3.7系がsphinx-autobuildが利用できるためおすすめです。

すでに入っている方は、飛ばしてください。

#### window (choco使用時)
```
choco install -y python --version=3.7.5
```
#### mac (brew使用時)
```
$ brew install pyenv
```
~/.bash_profileまたは、~/.zshrcに以下を追加
```
export PYENV_ROOT=${HOME}/.pyenv
if [ -d "${PYENV_ROOT}" ]; then
    export PATH=${PYENV_ROOT}/bin:$PATH
    eval "$(pyenv init -)"
fi
```
pythonをバージョン指定してインストールし
```
$ pyenv install 3.7.7
$ pyenv global 3.7.7
```

### plantumlインストール
#### window (choco使用時)
```
choco install plantuml
```
#### mac (brew使用時)
```
$ brew install plantuml
```


### venv環境
#### .venv作成
```
$ python -m venv .venv
```

#### ライブラリインストール
```
# venv環境を有効化
. .venv/bin/activate
# もしくは
source .venv/bin/activate
# venvライブラリインストール
(.venv) $ pip install -r ./requirements.txt
```

```
# venv環境を無効化する場合
deactivate
```

## ドキュメント生成
### PDF生成方法
```
＃ venv activate後
(.venv) $ make latexpdf
```

### HTML生成
```
＃ venv activate後
(.venv) $ sphinx-build -b html ./source ./docs
```

## autobuild起動
autobuildを起動するとブラウザで確認しながら執筆できます。
```
(.venv) $ sphinx-autobuild ./source ./docs
# もしくは
(.venv) $ make livehtml
```

