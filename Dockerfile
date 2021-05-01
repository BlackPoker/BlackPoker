# syntax = docker/dockerfile:1.0-experimental

# ------------------------------
# sphinx
# ------------------------------
# FROM toshiara/alpine-texlive-ja-plus:2020
FROM pman0214/alpine-texlive-ja-epspdf

# RUN apk update && apk add --no-chache --repository http://dl-cdn.alpinelinux.org/alpine/v3.10/main python3~=3.8
# RUN apk --no-cache add texlive-full
# RUN apk update
# RUN pip3 install --upgrade pip

RUN apk update

# ------------------------------
# plantuml
# ------------------------------
ENV PLANTUML_VERSION 1.2020.14
ENV LANG en_US.UTF-8
RUN apk add --no-cache graphviz 
RUN apk add --no-cache ttf-droid
RUN apk add --no-cache ttf-droid-nonlatin
RUN apk add --no-cache curl
RUN apk add --no-cache openjdk11
RUN mkdir /app
RUN curl -L https://sourceforge.net/projects/plantuml/files/plantuml.${PLANTUML_VERSION}.jar/download -o /app/plantuml.jar 
RUN apk del curl
RUN cp /app/plantuml.jar /usr/local/bin
RUN echo -e "#!/bin/sh\nexport LANG=ja_JP.UTF-8;\n/usr/bin/java -Djava.io.tmpdir=/var/tmp -Djava.awt.headless=true -jar /usr/local/bin/plantuml.jar  -charset UTF-8 \${@}" > /usr/bin/plantuml
RUN chmod 0755 /usr/bin/plantuml

# ------------------------------
# python
# ------------------------------
# RUN apk update
RUN apk update && apk add --no-chache --repository http://dl-cdn.alpinelinux.org/alpine/v3.10/main python3~=3.7
# RUN apk update && apk add --no-chache --repository http://dl-cdn.alpinelinux.org/alpine/latest-stable/main python3~=3.7
RUN apk add --no-cache py3-pip
# RUN apk add --no-cache python3 \
#     python3-dev \
#     py3-pip 

# ------------------------------
# pip
# ------------------------------
COPY ./requirements.txt .
RUN pip3 install -r requirements.txt

# ------------------------------
# source
# ------------------------------
WORKDIR /
RUN mkdir source && \
 chown 1000:1000 source && \
 chmod 777 source

COPY ./source/* source/.

# ------------------------------
# 実行設定
# ------------------------------
RUN apk add --no-cache make
COPY ./docker-build.sh .

# ------------------------------
# 出力設定
# ------------------------------
VOLUME /docs

USER 1000:1000

# sphinx-build -b html ./source ./docs

# RUN echo "#!/bin/bash\nsphinx-build -b html ./source ./docs" > /build.sh


CMD ["sh","docker-build.sh"]

# docker build --pull --rm -f "Dockerfile" -t blackpoker-doc:latest "."
# docker run --rm -it -v `pwd`/docs:/docs blackpoker-doc:latest
