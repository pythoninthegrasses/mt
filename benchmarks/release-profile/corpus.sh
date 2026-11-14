#!/usr/bin/env bash
# Deterministic decode corpus for TASK-369.4's runtime half (see sweep.sh decode).
#
# The repo fixtures cannot carry this measurement: every file in
# crates/mt-tauri/tests/fixtures is exactly one second, which is too short to time
# a decoder, and committing audio bloats the checkout. So the corpus is generated
# on demand into .cache/bench-369-4/corpus and never committed.
#
# Why synthesised, and why noise: content decides decode cost (bitrate, block
# count, prediction residuals), so a pure tone would flatter every codec equally
# and hide profile differences. Pink noise plus a couple of tones is what makes
# the encoders work, and `seed=42` plus fixed encoder flags makes the bytes
# reproducible, which is the property the comparison needs: a candidate that was
# timed against different audio is not being timed at all.
#
#   ./corpus.sh            # generate if missing, verify the manifest
#   ./corpus.sh --force    # regenerate
#
# Formats are the ones mt's rodio features enable (Cargo.toml: flac, mp3, mp4,
# vorbis, wav), one per container, because symphonia's per-format decoders are
# separate code paths and LTO inlines across them differently.

set -euo pipefail

MT_ROOT="$(git rev-parse --show-toplevel)"
CORPUS="${CORPUS_DIR:-$MT_ROOT/.cache/bench-369-4/corpus}"
SECS="${CORPUS_SECS:-60}"
FORCE=""
[ "${1:-}" = "--force" ] && FORCE=1

command -v ffmpeg >/dev/null || { echo "corpus.sh needs ffmpeg on PATH" >&2; exit 3; }
command -v ffprobe >/dev/null || { echo "corpus.sh needs ffprobe on PATH" >&2; exit 3; }
mkdir -p "$CORPUS"

# The shared source: pink noise at a fixed seed mixed with three tones, so the
# signal has both stochastic and periodic content. 48 kHz stereo, the player's
# usual shape rather than the fixtures' 44.1 kHz mono.
source_filter="anoisesrc=color=pink:amplitude=0.2:duration=$SECS:sample_rate=48000:seed=42"
mix="[0:a][1:a][2:a][3:a]amix=inputs=4:duration=first:normalize=0[a]"

encode() { # encode <file> <ffmpeg output args...>
  local file="$1"; shift
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "$source_filter" \
    -f lavfi -i "sine=frequency=220:duration=$SECS:sample_rate=48000" \
    -f lavfi -i "sine=frequency=1100:duration=$SECS:sample_rate=48000" \
    -f lavfi -i "sine=frequency=6600:duration=$SECS:sample_rate=48000" \
    -filter_complex "$mix" -map "[a]" -ac 2 "$@" "$CORPUS/$file"
}

need() { [ -z "$FORCE" ] && [ -f "$CORPUS/$1" ]; }

if [ -n "$FORCE" ] || ! need corpus.mp3 || ! need corpus.flac || ! need corpus.m4a \
   || ! need corpus.ogg || ! need corpus.wav; then
  echo "generating ${SECS}s corpus in $CORPUS"
  encode corpus.mp3  -c:a libmp3lame -b:a 192k
  encode corpus.flac -c:a flac -compression_level 5
  encode corpus.m4a  -c:a aac -b:a 192k
  encode corpus.ogg  -c:a vorbis -strict -2 -q:a 5
  encode corpus.wav  -c:a pcm_s16le
  # Two manifests: a standard sha256 file `shasum -c` can verify directly, and a
  # human-readable probe dump (codec, rate, duration, size) for the results dir.
  : >"$CORPUS/manifest.sha256"
  : >"$CORPUS/manifest.txt"
  for f in corpus.mp3 corpus.flac corpus.m4a corpus.ogg corpus.wav; do
    (cd "$CORPUS" && shasum -a 256 "$f") >>"$CORPUS/manifest.sha256"
    printf '[%s]\n' "$f" >>"$CORPUS/manifest.txt"
    ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,bit_rate \
      -show_entries format=duration,size -of default=noprint_wrappers=1 \
      "$CORPUS/$f" >>"$CORPUS/manifest.txt"
  done
else
  # Same bytes or the whole runtime comparison is void, so verify rather than trust.
  if ! (cd "$CORPUS" && shasum -a 256 -c manifest.sha256 >/dev/null 2>&1); then
    echo "corpus does not match its manifest; regenerate with: ./corpus.sh --force" >&2
    exit 4
  fi
fi

echo "$CORPUS"
