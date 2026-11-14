#!/usr/bin/env bash
# Linux column of the TASK-369.4 release-profile sweep, for x86_64-unknown-linux-gnu.
#
# Run this INSIDE the container built from docker/linux's `deps` stage (the same
# apt packages and pinned rust toolchain the Linux release leg builds with), with
# /build a git worktree of mt and /out a scratch dir for results. linux-on-mf.sh
# on the mac does all of that; see it for the invocation.
#
# Like sweep.sh on the host, each candidate is a cold build (hyperfine --prepare
# wipes target/release and target/<triple> before every run) with RUSTC_WRAPPER
# cleared so repeated runs cannot come back out of sccache.

set -euo pipefail

MT_ROOT="${MT_ROOT:-/build}"
OUT_DIR="${OUT_DIR:-/out}"
cd "$MT_ROOT"        # the image's WORKDIR is not the mounted repo

# Set by linux-on-mf.sh; not passed as shell args, so no eval/word-splitting
# games with caller-controlled strings.
read -r -a LTO_ARR <<<"${LTO_VALUES:-true thin false}"
read -r -a CGUS_ARR <<<"${CGUS_VALUES:-1 4 16}"
TRIPLE="x86_64-unknown-linux-gnu"
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$MT_ROOT/.cache/bench-369-4/target}"
RUNS="${RUNS:-2}"
export CARGO_TARGET_DIR

mkdir -p "$OUT_DIR"
BIN_DIR="$MT_ROOT/.cache/bench-369-4/bin"
mkdir -p "$BIN_DIR"

say() { printf '\n== %s\n' "$*"; }
du_kb() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }

say "runner spec"
uname -a
cat /etc/os-release | head -2
echo "cores: $(nproc)  load: $(cat /proc/loadavg)"
cargo --version
rustc -Vv | head -3

say "hyperfine"
HYPERFINE_BIN="$(command -v hyperfine || true)"
if [ -z "$HYPERFINE_BIN" ]; then
  # The driver runs the container as the host user, so there is no apt here:
  # fetch the static musl build into the mounted scratch dir instead.
  HYPERFINE_VERSION="${HYPERFINE_VERSION:-1.19.0}"
  HYPERFINE_BIN="$BIN_DIR/hyperfine"
  if [ ! -x "$HYPERFINE_BIN" ]; then
    echo "fetching hyperfine v$HYPERFINE_VERSION"
    curl -fsSL --retry 3 --retry-delay 2 --max-time 180 -o /tmp/hf.tgz \
      "https://github.com/sharkdp/hyperfine/releases/download/v$HYPERFINE_VERSION/hyperfine-v$HYPERFINE_VERSION-x86_64-unknown-linux-musl.tar.gz"
    tar -xzf /tmp/hf.tgz -C /tmp
    install -m 0755 "$(find /tmp -maxdepth 2 -type f -name hyperfine | head -1)" "$HYPERFINE_BIN"
  fi
fi
"$HYPERFINE_BIN" --version

# Tauri's externalBin is checked during the build, so a plausible sidecar has to
# exist even though nothing in this matrix executes it. Order of preference:
# a real x86_64-linux build, a cross-compiled one, then an ELF stub.
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
  (cd app/frontend && npm ci --silent && npm run build)
fi
[ -d app/frontend/dist ] || { echo "app/frontend/dist missing and npm build produced nothing" >&2; exit 2; }

# The release task does this, but the submodule is only needed by mt-agent and mf's
# checkout has never carried it; the matrix builds default features only.
git submodule update --init --recursive || echo "warning: submodule init failed (mt-agent not built)"

lto_label() { case "$1" in fat|true) echo fat ;; thin) echo thin ;; off|false) echo off ;; *) echo "$1" ;; esac; }

for lto in "${LTO_ARR[@]}"; do
  for cgus in "${CGUS_ARR[@]}"; do
    label="linux-lto-$(lto_label "$lto")-cgus$cgus"
    say "$label (lto=$lto codegen-units=$cgus, $RUNS cold runs)"
    export CARGO_PROFILE_RELEASE_LTO="$lto"
    export CARGO_PROFILE_RELEASE_CODEGEN_UNITS="$cgus"
    unset RUSTC_WRAPPER RUSTFLAGS

    "$HYPERFINE_BIN" --runs "$RUNS" --warmup 0 --time-unit second \
      --command-name "$label" \
      --prepare "rm -rf $CARGO_TARGET_DIR/release $CARGO_TARGET_DIR/$TRIPLE" \
      --export-json "$OUT_DIR/hyperfine-$label.json" \
      --export-markdown "$OUT_DIR/hyperfine-$label.md" \
      -- "cargo build --release --target $TRIPLE -p mt-tauri" \
      2>&1 | tee "$OUT_DIR/hyperfine-$label.txt"

    bin="$CARGO_TARGET_DIR/$TRIPLE/release/mt"
    if [ ! -f "$bin" ]; then
      echo "!! $label: no binary at $bin; skipping size recording"
      continue
    fi
    {
      printf '%s\tbinary-bytes\t%s\n'    "$label" "$(stat -c%s "$bin")"
      # GNU size -A gives per-section decimal bytes; .text is the code the linker
      # keeps, which is what fat LTO actually changes.
      size -A "$bin" | awk '/^\.text /{printf "%s\ttext-bytes\t%s\n", "'"$label"'", $2}'
      size -A "$bin" | awk '/^\.rodata /{printf "%s\trodata-bytes\t%s\n", "'"$label"'", $2}'
      printf '%s\ttarget-triple-kib\t%s\n' "$label" "$(du_kb "$CARGO_TARGET_DIR/$TRIPLE")"
      printf '%s\ttarget-host-kib\t%s\n'   "$label" "$(du_kb "$CARGO_TARGET_DIR/release")"
    } >"$OUT_DIR/sizes-$label.tsv"
    cat "$OUT_DIR/sizes-$label.tsv"
  done
done

say "done"
ls -l "$OUT_DIR"
