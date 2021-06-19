# syntax = docker/dockerfile:1.0-experimental

# ------------------------------
# 定義からaction-list等生成
# ------------------------------
FROM maven:3.6.2-jdk-11 as builder

WORKDIR /usr/local/src/actionlist

RUN mkdir src && \
 chown 1000:1000 src && \
 mkdir tex && \
 chown 1000:1000 tex && \
 mkdir original && \
 chown 1000:1000 original && \
 mkdir web-site && \
 chown 1000:1000 web-site

COPY src/* src/.
COPY original/* original/.
COPY pom.xml .
COPY web-site/* web-site/.

RUN --mount=type=cache,target=/root/.m2 mvn compile exec:java

# ------------------------------
# 起動
# ------------------------------
# FROM alpine:latest

# RUN apk --no-cache add python3
# RUN apk --no-cache add python3-dev
# RUN apk --no-cache add py3-pip
# RUN apk --no-cache add texlive-full

FROM blackpoker/actionlist-base:latest

RUN pip3 install --upgrade pip
RUN pip3 install pdfrw

WORKDIR /
RUN mkdir tex && \
 chown 1000:1000 tex && \
 chmod 777 tex && \
 mkdir python && \
 chown 1000:1000 python && \
 chmod 777 python && \
 mkdir web-site && \
 chown 1000:1000 web-site && \
 chmod 777 web-site && \
 mkdir dist && \
 chown 1000:1000 dist && \
 chmod 777 dist

COPY --from=builder /usr/local/src/actionlist/tex/* tex/.
COPY ./python/* python/.
COPY ./docker-resource/build.sh .
COPY ./docker-resource/*.pdf ./tex/.
COPY --from=builder /usr/local/src/actionlist/web-site web-site

VOLUME /dist

USER 1000:1000
CMD ["sh", "/build.sh"]
