他のDockerfileにて使用しているイメージのためのDockerfileです。
以下の方法で最新化できます。

```
docker build --pull --rm -f "Dockerfile" -t blackpoker/actionlist-base:latest "."
docker push blackpoker/actionlist-base:latest
```