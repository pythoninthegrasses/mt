# syntax=docker/dockerfile:1.17.1
# check=skip=all

FROM debian:trixie-slim AS deps

RUN true <<'DOCKERFILE'
Multi-stage Dockerfile for Linux CI builds.

Stages:
  deps      - system packages, Rust nightly, Zig, Node.js, cargo-chef, tauri-cli
  planner   - cargo-chef prepare (generates recipe.json from lock/manifests)
  cook      - cargo-chef cook (compiles all dependencies, cached by Blacksmith)
  check     - stage sidecar, cargo check --workspace (test workflow target)
  build     - stage sidecar, cargo tauri build --no-bundle + cargo tauri bundle (release target)
  artifacts - extract .deb and binary

Usage:
  test.yml:    docker build --target check .
  release.yml: docker build --target artifacts --output type=local,dest=dist .
DOCKERFILE

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    cmake \
    mold \
    curl \
    wget \
    file \
    ca-certificates \
    git \
    unzip \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

ARG WEBKIT_VERSION=4.1
ARG SOUP_VERSION=3.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjavascriptcoregtk-${WEBKIT_VERSION}-dev \
    libwebkit2gtk-${WEBKIT_VERSION}-dev \
    libsoup-${SOUP_VERSION}-dev \
    libgtk-3-dev \
    libasound2-dev \
    libdbus-1-dev \
    libayatana-appindicator3-dev \
    zlib1g-dev \
    libutfcpp-dev \
    libssl-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH="/usr/local/cargo/bin:${PATH}"

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain nightly --profile minimal \
    && rustup target add x86_64-unknown-linux-gnu

RUN cargo install cargo-chef --locked \
    && cargo install cargo-binstall --locked \
    && cargo binstall tauri-cli --locked --no-confirm

ARG NODE_MAJOR=24
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Pinned to .tool-versions' `zig` entry. Verified against ziglang.org/download/index.json.
ARG ZIG_VERSION=0.15.2
ARG ZIG_SHA256=02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239
RUN curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz \
    && echo "${ZIG_SHA256}  /tmp/zig.tar.xz" | sha256sum -c - \
    && mkdir -p /usr/local/zig \
    && tar -xJf /tmp/zig.tar.xz -C /usr/local/zig --strip-components=1 \
    && rm /tmp/zig.tar.xz
ENV PATH="/usr/local/zig:${PATH}"

ENV RUSTUP_TOOLCHAIN=nightly \
    RUSTFLAGS="-Zthreads=16"

WORKDIR /build

FROM deps AS planner

COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/

RUN cargo chef prepare --recipe-path recipe.json

FROM deps AS cook

COPY --from=planner /build/recipe.json recipe.json
COPY crates/mt-tauri/.cargo crates/mt-tauri/.cargo/

RUN cargo chef cook --recipe-path recipe.json \
    --target x86_64-unknown-linux-gnu

RUN cargo chef cook --release --recipe-path recipe.json \
    --target x86_64-unknown-linux-gnu

COPY app/frontend/package.json app/frontend/package-lock.json app/frontend/
RUN cd app/frontend && npm ci

FROM cook AS check

COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY zig-core/ zig-core/

# See the `build` stage's matching step for why this is needed even for a
# plain cargo check: Tauri's build script resolves externalBin eagerly.
RUN cd zig-core && zig build -Dtarget=x86_64-linux -Doptimize=ReleaseSafe -p zig-out/stage \
    && mkdir -p /build/crates/mt-tauri/binaries \
    && cp zig-out/stage/bin/mt-zig-core /build/crates/mt-tauri/binaries/mt-zig-core-x86_64-unknown-linux-gnu

RUN cargo check --workspace --target x86_64-unknown-linux-gnu

FROM cook AS build

ARG LASTFM_API_KEY
ARG LASTFM_API_SECRET
ENV LASTFM_API_KEY=${LASTFM_API_KEY} \
    LASTFM_API_SECRET=${LASTFM_API_SECRET}

COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY app/ app/
COPY static/ static/
COPY zig-core/ zig-core/

RUN cd app/frontend && npm run build

# Mirrors taskfiles/zig.yml's zig:stage task for x86_64-unknown-linux-gnu only.
# Tauri's externalBin resolves the sidecar by Rust host triple, not the Zig
# target string -- Zig's x86_64-linux is static musl, filed here under the
# Rust triple as Tauri expects. Plain cp, never strip/install -s (AC#8).
RUN cd zig-core && zig build -Dtarget=x86_64-linux -Doptimize=ReleaseSafe -p zig-out/stage \
    && mkdir -p /build/crates/mt-tauri/binaries \
    && cp zig-out/stage/bin/mt-zig-core /build/crates/mt-tauri/binaries/mt-zig-core-x86_64-unknown-linux-gnu

RUN cargo tauri build --no-bundle \
    --target x86_64-unknown-linux-gnu \
    --config '{"build":{"beforeBuildCommand":""}}'

RUN cargo tauri bundle \
    --target x86_64-unknown-linux-gnu \
    --bundles deb

FROM scratch AS artifacts

COPY --from=build /build/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb /
COPY --from=build /build/target/x86_64-unknown-linux-gnu/release/mt /mt
