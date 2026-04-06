# syntax=docker/dockerfile:1.17.1
# check=skip=all

FROM ghcr.io/jianliang00/macos-base:26.3

# hadolint ignore=DL4006 -- container tool does not support SHELL directive
# No network during build -- all dependencies are COPY'd as pre-built tarballs.
# Run `scripts/runner.sh prepare` on the host to generate the build context.

# Preserve the full default macOS PATH through all ENV directives
ENV BASE_PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"

# Xcode Command Line Tools
COPY CLTools.pkg /tmp/CLTools.tar
RUN tar xf /tmp/CLTools.tar -C / \
    && rm /tmp/CLTools.tar \
    && xcode-select --switch /Library/Developer/CommandLineTools \
    && echo "CLT installed at $(xcode-select -p)"

# Homebrew + packages
COPY homebrew.tar /tmp/homebrew.tar
RUN /bin/mkdir -p /opt/homebrew \
    && tar xf /tmp/homebrew.tar -C /opt/homebrew \
    && rm /tmp/homebrew.tar

# mise
COPY mise.tar /tmp/mise.tar
RUN /bin/mkdir -p /Users/Shared/.local/bin \
    && tar xf /tmp/mise.tar -C /Users/Shared/.local/bin \
    && rm /tmp/mise.tar

# Node.js
COPY node.tar /tmp/node.tar
RUN /bin/mkdir -p /opt/node \
    && tar xf /tmp/node.tar -C /opt/node \
    && rm /tmp/node.tar

# Deno
COPY deno.tar /tmp/deno.tar
RUN /bin/mkdir -p /opt/deno/bin \
    && tar xf /tmp/deno.tar -C /opt/deno/bin \
    && rm /tmp/deno.tar

# Task
COPY task.tar /tmp/task.tar
RUN /bin/mkdir -p /opt/task/bin \
    && tar xf /tmp/task.tar -C /opt/task/bin \
    && rm /tmp/task.tar

# Rust toolchain
COPY rust.tar /tmp/rust.tar
RUN /bin/mkdir -p /Users/Shared/.rustup /Users/Shared/.cargo \
    && tar xf /tmp/rust.tar -C /Users/Shared \
    && rm /tmp/rust.tar \
    && cd /Users/Shared/.cargo/bin \
    && for link in $(find . -type l); do \
         target=$(readlink "$link"); \
         case "$target" in */rustup) ln -sf /Users/Shared/.cargo/bin/rustup "$link" ;; esac; \
       done

# Cargo tools (tauri-cli, cargo-binstall)
COPY cargo-tools.tar /tmp/cargo-tools.tar
RUN tar xf /tmp/cargo-tools.tar -C /Users/Shared/.cargo/bin \
    && rm /tmp/cargo-tools.tar

# GitHub Actions runner
COPY actions-runner.tar.gz /tmp/actions-runner.tar.gz
WORKDIR /opt/actions-runner
RUN tar xzf /tmp/actions-runner.tar.gz \
    && rm /tmp/actions-runner.tar.gz

# Set final PATH with all tools
ENV PATH="/Users/Shared/.cargo/bin:/Users/Shared/.local/bin:/Users/Shared/.local/share/mise/shims:/opt/homebrew/bin:/opt/homebrew/sbin:/opt/node/bin:/opt/deno/bin:/opt/task/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"
ENV RUSTUP_HOME="/Users/Shared/.rustup" \
    CARGO_HOME="/Users/Shared/.cargo"

COPY entrypoint.sh /opt/actions-runner/entrypoint.sh
RUN chmod +x /opt/actions-runner/entrypoint.sh
ENTRYPOINT ["/opt/actions-runner/entrypoint.sh"]
