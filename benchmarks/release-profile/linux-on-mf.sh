#!/usr/bin/env bash
# Driver for the Linux column of the TASK-369.4 release-profile sweep.
#
# Times the lto x codegen-units matrix for x86_64-unknown-linux-gnu on `mf`
# (16-core AlmaLinux 10.2, the same host TASK-369.7 used -- tailnet IPv4), inside
# a container built from THIS repo's CI deps stage, so the toolchain, system
# libraries and Rust/Zig pins are the ones the Linux release leg uses.
#
# The build happens in a git worktree under ~/git/mt on mf (never in the user's
# main checkout), created from the branch this harness was committed on. Push
# that branch first:
#
#   git push origin spike/369-4-release-profile-bench
#   MF=lance@100.76.222.54 BRANCH=spike/369-4-release-profile-bench ./linux-on-mf.sh
#
#   RUNS=1 ./linux-on-mf.sh                                    # screening pass
#   LTO_VALUES="false" CGUS_VALUES="1 4 16" ./linux-on-mf.sh    # one column
#
# Results land in results-<date>/linux/. mf runs Plex, Syncthing, vllm and honcho
# containers, so its spec and load are recorded next to the numbers.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MT_ROOT="$(cd "$HERE/../.." && pwd)"

MF="${MF:-lance@100.76.222.54}"
BRANCH="${BRANCH:?set BRANCH to the branch holding benchmarks/release-profile}"
WT="${WT:-mt-369-4}"                       # ~/git/<WT> on mf
IMAGE="${IMAGE:-mt-linux-deps:bench}"
RUNS="${RUNS:-2}"
RESULTS="$HERE/results-$(date +%Y-%m-%d)/linux"
mkdir -p "$RESULTS"

say() { printf '\n== %s\n' "$*"; }

say "runner spec"
ssh "$MF" "hostname; uname -a; nproc; cat /proc/loadavg; grep -m1 'model name' /proc/cpuinfo; free -g | sed -n 2p; docker --version; df -h ~/git | tail -1" \
  >"$RESULTS/runner-spec.txt" 2>&1
cat "$RESULTS/runner-spec.txt"

say "worktree ~/git/$WT on mf at origin/$BRANCH"
ssh "$MF" "set -e
  cd ~/git/mt
  git fetch origin '$BRANCH'
  git worktree prune
  if [ -d ~/git/$WT ]; then
    git -C ~/git/$WT fetch origin '$BRANCH'
    git -C ~/git/$WT checkout -q -B $WT FETCH_HEAD
    git -C ~/git/$WT clean -fdq -e target -e .cache -e app/frontend/dist
  else
    git worktree add -f ~/git/$WT -B $WT FETCH_HEAD
  fi
  git -C ~/git/$WT log --oneline -1
  du -sh ~/git/$WT"

# The frontend bundle is platform-independent, so ship the host's built dist
# rather than running npm in the container (linux-sweep.sh can also build it).
say "frontend dist"
rsync -a --delete "$MT_ROOT/app/frontend/dist/" "$MF:~/git/$WT/app/frontend/dist/"

say "docker image from docker/linux (deps stage)"
ssh "$MF" "docker build -q --target deps -t $IMAGE ~/git/$WT/docker/linux"

# Run as the host user so the ~14 GiB of build output in the worktree stays
# deletable by the account that owns it; cargo/npm caches go to the /out mount.
say "sweep (RUNS=$RUNS)"
ssh "$MF" "set -e
  rm -rf ~/${WT}-out && mkdir -p ~/${WT}-out
  docker run --rm --user \$(id -u):\$(id -g) \
    -e HOME=/out -e CARGO_HOME=/out/cargo-home \
    -v \$HOME/git/$WT:/build -v \$HOME/${WT}-out:/out \
    -e RUNS='$RUNS' -e LTO_VALUES='${LTO_VALUES:-true thin false}' -e CGUS_VALUES='${CGUS_VALUES:-1 4 16}' \
    $IMAGE bash /build/benchmarks/release-profile/linux-sweep.sh"

say "collect"
rsync -a "$MF:~/${WT}-out/" "$RESULTS/"
ls -1 "$RESULTS" | head -30
echo "linux results -> $RESULTS"
