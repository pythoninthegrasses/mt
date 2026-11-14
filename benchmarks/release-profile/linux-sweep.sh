#!/usr/bin/env bash
# Linux column of the TASK-369.4 release-profile sweep, for x86_64-unknown-linux-gnu.
#
# Run this INSIDE a container from docker/linux's `deps` stage, which is where the
# Linux release leg builds: same pinned Rust, same apt packages, same tauri-cli, and
# the image's WORKDIR is /build. /out collects the results. linux-on-mf.sh on the
# mac does all of that; see it for the invocation.
#
# The timed unit is the command docker/linux/Dockerfile's `build` stage runs,
# `cargo tauri build --no-bundle --target <triple> --config
# '{"build":{"beforeBuildCommand":""}}'`, so all three columns of the matrix time
# the same thing. Each candidate is a cold build: hyperfine --prepare wipes the
# target dir before every run and RUSTC_WRAPPER is cleared, so nothing survives from
# the previous candidate and no cache can serve a repeat. The release workflow's own
# Linux leg compiles dependencies in a cached cargo-chef layer first, so its
# absolute wall clock is lower than what is measured here; the per-candidate delta
# comes from the same final-crate codegen and link work this does measure.

set -euo pipefail

MT_ROOT="${MT_ROOT:-/build}"
OUT_DIR="${OUT_DIR:-/out}"
TRIPLE="x86_64-unknown-linux-gnu"
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$MT_ROOT/.cache/bench-369-4/target}"
RUNS="${RUNS:-2}"
read -r -a LTO_ARR <<<"${LTO_VALUES:-true thin false}"
read -r -a CGUS_ARR <<<"${CGUS_VALUES:-1 4 16}"
export CARGO_TARGET_DIR

cd "$MT_ROOT"
mkdir -p "$OUT_DIR" "$CARGO_TARGET_DIR"

say() { printf '\n== %s\n' "$*"; }
du_kb() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }

say "runner spec"
uname -a
head -2 /etc/os-release
echo "cores: $(nproc)  load: $(cat /proc/loadavg)"
cargo --version
# `| head` would SIGPIPE rustc and pipefail would turn that into a failure.
rustc -Vv | awk 'NR<=3'
cargo tauri --version

say "hyperfine"
HYPERFINE_BIN="$(command -v hyperfine || true)"
if [ -z "$HYPERFINE_BIN" ]; then
  if ! apt-get install -y --no-install-recommends hyperfine >/dev/null 2>&1; then
    # No apt (or no network): fall back to the upstream static musl build.
    HYPERFINE_VERSION="${HYPERFINE_VERSION:-1.19.0}"
    mkdir -p "$MT_ROOT/.cache/bench-369-4/bin"
    HYPERFINE_BIN="$MT_ROOT/.cache/bench-369-4/bin/hyperfine"
    if [ ! -x "$HYPERFINE_BIN" ]; then
      curl -fsSL --retry 3 --retry-delay 2 --max-time 180 -o /tmp/hf.tgz \
        "https://github.com/sharkdp/hyperfine/releases/download/v$HYPERFINE_VERSION/hyperfine-v$HYPERFINE_VERSION-x86_64-unknown-linux-musl.tar.gz"
      tar -xzf /tmp/hf.tgz -C /tmp
      install -m 0755 "$(find /tmp -maxdepth 2 -type f -name hyperfine | head -1)" "$HYPERFINE_BIN"
    fi
  else
    HYPERFINE_BIN="$(command -v hyperfine)"
  fi
fi
"$HYPERFINE_BIN" --version

# Tauri's build script resolves externalBin eagerly, so a plausible sidecar has to
# exist even though nothing in this matrix executes it. docker/linux's own build
# stage does the same thing with a real Zig cross build.
say "zig-core sidecar"
mkdir -p crates/mt-tauri/binaries
SIDE="crates/mt-tauri/binaries/mt-zig-core-$TRIPLE"
if [ ! -s "$SIDE" ]; then
  if [ -n "${ZIG_CORE_LINUX:-}" ] && [ -f "$ZIG_CORE_LINUX" ]; then
    echo "sidecar: copied from $ZIG_CORE_LINUX"
    install -m 0755 "$ZIG_CORE_LINUX" "$SIDE"
  elif command -v zig >/dev/null 2>&1 && [ -d zig-core ]; then
    echo "sidecar: cross-compiling with $(zig version)"
    (cd zig-core && zig build -Dtarget=x86_64-linux -Doptimize=ReleaseSafe -p zig-out/stage) \
      && install -m 0755 zig-core/zig-out/stage/bin/mt-zig-core "$SIDE"
  fi
fi
if [ ! -s "$SIDE" ]; then
  echo "sidecar: ELF stub (nothing here runs it)"
  printf '\177ELF\002\001\001\000' >"$SIDE"
  head -c 4080 /dev/zero >>"$SIDE"
  chmod 0755 "$SIDE"
fi

# The bundler packs app/frontend/dist into the .deb; the driver rsyncs the host's
# platform-independent bundle, and node is in the deps image as a fallback.
if [ ! -d app/frontend/dist ]; then
  say "frontend dist"
  (cd app/frontend && npm ci && npm run build)
fi
[ -d app/frontend/dist ] || { echo "app/frontend/dist missing and npm build produced nothing" >&2; exit 2; }

# The release task does this too, but the submodule only feeds mt-agent and mf's
# checkout has never carried it; this matrix builds default features only.
git submodule update --init --recursive || echo "warning: submodule init failed (mt-agent is not built here)"

# Same file every column times, so the three columns are directly comparable and the
# --config JSON survives hyperfine handing the command to a shell.
export TRIPLE
BUILD_CMD="bash benchmarks/release-profile/tauri-build.sh build"
PREPARE="rm -rf $CARGO_TARGET_DIR/release $CARGO_TARGET_DIR/$TRIPLE"
lto_label() { case "$1" in fat|true) echo fat ;; thin) echo thin ;; off|false) echo off ;; *) echo "$1" ;; esac; }

for lto in "${LTO_ARR[@]}"; do
  for cgus in "${CGUS_ARR[@]}"; do
    label="linux-lto-$(lto_label "$lto")-cgus$cgus"
    say "$label (lto=$lto codegen-units=$cgus, $RUNS cold runs)"
    export CARGO_PROFILE_RELEASE_LTO="$lto"
    export CARGO_PROFILE_RELEASE_CODEGEN_UNITS="$cgus"
    unset RUSTC_WRAPPER

    "$HYPERFINE_BIN" --runs "$RUNS" --warmup 0 --time-unit second \
      --command-name "$label" --prepare "$PREPARE" \
      --export-json "$OUT_DIR/hyperfine-$label.json" \
      --export-markdown "$OUT_DIR/hyperfine-$label.md" \
      -- "$BUILD_CMD" 2>&1 | tee "$OUT_DIR/hyperfine-$label.txt"

    bin="$CARGO_TARGET_DIR/$TRIPLE/release/mt"
    if [ ! -f "$bin" ]; then
      echo "!! $label: no binary at $bin; skipping size recording"
      continue
    fi

    # Packaging is not part of the measured build, but the .deb is the artifact the
    # Linux release ships, so its size matters to the size gate.
    say "$label: bundle deb"
    bash benchmarks/release-profile/tauri-build.sh bundle deb \
      >"$OUT_DIR/bundle-$label.log" 2>&1 \
      || echo "!! $label: deb bundling failed (see bundle-$label.log)"

    {
      printf '%s\tbinary-bytes\t%s\n' "$label" "$(stat -c%s "$bin")"
      # GNU size -A reports decimal bytes per section; .text is the code fat LTO
      # actually reshapes.
      size -A "$bin" | awk -v l="$label" '/^\.text /{printf "%s\ttext-bytes\t%s\n", l, $2}'
      size -A "$bin" | awk -v l="$label" '/^\.rodata /{printf "%s\trodata-bytes\t%s\n", l, $2}'
      printf '%s\ttarget-triple-kib\t%s\n' "$label" "$(du_kb "$CARGO_TARGET_DIR/$TRIPLE")"
      printf '%s\ttarget-host-kib\t%s\n' "$label" "$(du_kb "$CARGO_TARGET_DIR/release")"
      for a in "$CARGO_TARGET_DIR/$TRIPLE"/release/bundle/deb/*.deb; do
        [ -f "$a" ] && printf '%s\tdeb-bytes\t%s\n' "$label" "$(stat -c%s "$a")"
      done
    } >"$OUT_DIR/sizes-$label.tsv"
    cat "$OUT_DIR/sizes-$label.tsv"
  done
done

say "done"
# The container runs as root; hand the tree back to whoever owns it on the host so
# the worktree can be cleaned up without sudo.
chown -R "$(stat -c%u:%g "$MT_ROOT")" "$MT_ROOT/.cache" "$MT_ROOT/crates/mt-tauri/binaries" 2>/dev/null || true
ls -l "$OUT_DIR"
