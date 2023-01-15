# syntax = docker/dockerfile:1.0-experimental

# ------------------------------
# sphinx
# ------------------------------
# FROM toshiara/alpine-texlive-ja-plus:2020
FROM pman0214/alpine-texlive-ja-epspdf

RUN apk update

# ------------------------------
# plantuml
# ------------------------------
ENV PLANTUML_VERSION 1.2023.0
ENV LANG en_US.UTF-8
RUN apk add --no-cache graphviz 
RUN apk add --no-cache ttf-droid
RUN apk add --no-cache ttf-droid-nonlatin
RUN apk add --no-cache curl
RUN apk add --no-cache openjdk11
RUN mkdir -p /app
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
RUN apk add --no-cache py3-pip
