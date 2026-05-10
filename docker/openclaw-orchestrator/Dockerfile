ARG BASE_IMAGE=ghcr.io/openclaw/openclaw:latest
FROM ${BASE_IMAGE}

ARG COMPOSE_VERSION=v2.39.1

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io iproute2 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
 && case "$arch" in \
      amd64) compose_arch=x86_64 ;; \
      arm64) compose_arch=aarch64 ;; \
      armhf) compose_arch=armv7 ;; \
      *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac \
 && mkdir -p /usr/local/lib/docker/cli-plugins \
 && curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${compose_arch}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose \
 && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

USER node
