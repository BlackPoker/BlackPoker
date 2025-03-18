# syntax = docker/dockerfile:1.0-experimental

# ------------------------------
# 定義からaction-list等生成
# ------------------------------
    FROM maven:3.6.2-jdk-11 as builder

    WORKDIR /usr/local/src/actionlist
    
    # 必要なディレクトリを作成（上位フォルダが存在しない場合に対応）
    RUN mkdir -p /usr/local/source/auto && \
        chown -R 1000:1000 /usr/local/source/auto && \
        mkdir -p src tex original web-site && \
        chown -R 1000:1000 src tex original web-site
    
    # `COPY` の修正（フォルダがない場合にエラーを防ぐ）
    COPY src/ src/
    COPY original/ original/
    COPY pom.xml .
    COPY web-site/ web-site/
    
    # `mvn exec:java` 実行
    RUN --mount=type=cache,target=/root/.m2 mvn install
    
    # ------------------------------
    # 起動
    # ------------------------------
    FROM blackpoker/actionlist-base:latest
    
    RUN pip3 install --upgrade pip
    RUN pip3 install pdfrw
    
    WORKDIR /
    
    # 必要なディレクトリを作成
    RUN mkdir -p tex python web-site dist /usr/local/source/auto && \
        chown -R 1000:1000 tex python web-site dist /usr/local/source/auto && \
        chmod -R 777 tex python web-site dist /usr/local/source/auto
    
    # 必要なファイルをコピー
    COPY --from=builder /usr/local/src/actionlist/tex/ tex/
    COPY ./python/ python/
    COPY ./docker-resource/build.sh .
    COPY ./docker-resource/*.pdf ./tex/
    COPY --from=builder /usr/local/src/actionlist/web-site/ web-site/
    COPY --from=builder /usr/local/source/auto/ /usr/local/source/auto/
    
    VOLUME /dist
    
    USER 1000:1000
    CMD ["sh", "/build.sh"]
    