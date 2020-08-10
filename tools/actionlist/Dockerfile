FROM alpine:latest


RUN apk --no-cache add python3
RUN apk --no-cache add python3-dev
RUN apk --no-cache add py3-pip
RUN apk --no-cache add texlive-full

RUN pip3 install --upgrade pip
RUN pip3 install pdfrw

RUN mkdir /tex && \
 chown 1000:1000 /tex && \
 mkdir /python && \
 chown 1000:1000 /python && \
 mkdir /dist && \
 chown 1000:1000 /dist


COPY ./tex/* /tex/.
COPY ./python/* /python/.
COPY build.sh /.

VOLUME /dist
WORKDIR /
USER 1000:1000
CMD ["sh", "/build.sh"]