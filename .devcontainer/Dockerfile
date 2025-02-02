# Python 3.8 ベースの dev コンテナイメージを利用する
ARG VARIANT="3.8"
FROM mcr.microsoft.com/vscode/devcontainers/python:0-${VARIANT}

# `PIP_TARGET` を削除し、代わりに `--user` を使う
ENV PATH="/home/vscode/.local/bin:${PATH}"

RUN if ! grep -q "^pip-global:" /etc/group; then groupadd -r pip-global; fi \
    && usermod -a -G pip-global vscode \
    && umask 0002 && mkdir -p ${PIP_TARGET} \
    && chown -R vscode:vscode ${PIP_TARGET} \
    && chmod -R 777 ${PIP_TARGET} \
    && [ ! -f "/etc/profile.d/00-restore-env.sh" ] || sed -i -e "s|export PATH=|export PATH=/usr/local/pip-global:|" /etc/profile.d/00-restore-env.sh

# --- Node.js のインストール（必要な場合）---
ARG INSTALL_NODE="true"
ARG NODE_VERSION="lts/*"
RUN if [ "${INSTALL_NODE}" = "true" ]; then \
      su vscode -c "umask 0002 && . /usr/local/share/nvm/nvm.sh && nvm install ${NODE_VERSION}"; \
    fi

# --- Java 17 と PlantUML のインストール ---
ENV PLANTUML_VERSION=1.2024.3
RUN export DEBIAN_FRONTEND=noninteractive && apt-get update && \
    apt-get install -y openjdk-17-jdk graphviz fonts-ipafont fonts-ipaexfont curl && \
    \
    # PlantUML jar をダウンロードして配置
    curl -L https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml-${PLANTUML_VERSION}.jar -o plantuml.jar && \
    mv plantuml.jar /usr/local/bin/plantuml.jar && \
    \
    # /usr/local/bin/plantuml に実行用ラッパースクリプトを作成
    echo '#!/bin/bash' | tee /usr/local/bin/plantuml > /dev/null && \
    echo 'export LANG=ja_JP.UTF-8' | tee -a /usr/local/bin/plantuml > /dev/null && \
    echo '/usr/bin/java -Djava.io.tmpdir=/var/tmp -Djava.awt.headless=true -jar /usr/local/bin/plantuml.jar -charset UTF-8 "$@"' | tee -a /usr/local/bin/plantuml > /dev/null && \
    chmod 0755 /usr/local/bin/plantuml && \
    \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# # --- pip を最新にアップグレード ---
# RUN su vscode -c "pip3 install --upgrade pip setuptools wheel"

# # --- sphinxcontrib-plantuml のビルドに必要なパッケージをインストール ---
# RUN apt-get update && apt-get install -y graphviz plantuml default-jdk

# # --- Python パッケージのインストール (vscode ユーザーとして実行) ---
# COPY requirements.txt /tmp/pip-tmp/requirements.txt
# RUN su vscode -c "pip3 install --user --no-cache-dir -r /tmp/pip-tmp/requirements.txt" \
#     && rm -rf /tmp/pip-tmp

# # 作業ディレクトリを /workspace に設定
# WORKDIR /workspace



# --- 必要なツールをインストール ---
RUN apt-get update && apt-get install -y \
    graphviz \
    plantuml \
    default-jdk \
    fontconfig \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# --- pip を最新にアップグレード ---
RUN python3 -m pip install --upgrade pip setuptools wheel

# --- Python パッケージのインストール ---
COPY requirements.txt /tmp/pip-tmp/requirements.txt
RUN su vscode -c "pip3 install --user --no-cache-dir -r /tmp/pip-tmp/requirements.txt" \
    && rm -rf /tmp/pip-tmp

# 作業ディレクトリを /workspace に設定
WORKDIR /workspace
