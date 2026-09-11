---
name: gnhf
description: >
  Launch a bounded, low-supervision overnight (or long-unattended) coding
  agent run against one well-specced task, in an isolated worktree, using
  whichever agent CLI and model is currently configured — not a hardcoded
  one. Use when the user says "gnhf", "good night have fun", "run this
  overnight", "let an agent work on this while I'm away/asleep", "burn this
  task unattended", or asks to set up a long-running agent session bounded
  by a time or turn budget with minimal check-ins.
argument-hint: "<task-id-or-description> [ttl] [max-turns]"
---

# gnhf

## Resolve `SKILL_DIR` (do this before running the bundled script)

`scripts/smoke-test.sh` is a direct sibling of this file in every install
layout. Set `SKILL_DIR` to the absolute path of the directory containing
THIS SKILL.md you just Read (your harness told you that path in the Read
result), e.g.:

```
Read ~/.claude/skills/gnhf/SKILL.md → SKILL_DIR=~/.claude/skills/gnhf
Read .agents/skills/gnhf/SKILL.md   → SKILL_DIR=.agents/skills/gnhf
```

Note: this is a personal, from-scratch skill, unrelated to the `gnhf` npm
package (`kunchenguid/gnhf`) that also occupies this name. Don't adopt that
tool's CLI, config file, or Companion/Hands-Off skill — this one is simpler
and modeled on how this user actually runs unattended agents (manual git
worktree, a plain background process, `timeout` for the wall-clock bound).

## Overview

One agent, one task, one isolated worktree, bounded by a TTL (wall clock)
or a turn count, minimally supervised until it finishes, bails, or the
bound expires. The agent CLI and model must be resolved from whatever is
currently configured — never hardcode a specific agent/model pairing,
because both get rotated over time.

Every environment-specific path mentioned below (config repos, worktree
conventions, prompt templates) is a signal to check *if present*, not a
requirement. Test for existence before reading; treat a missing one as
"skip and fall through," not a failure. This is what keeps the skill
working on a machine that doesn't have this user's particular config repos
checked out.

## 1. Resolve the current agent + model (don't hardcode)

Resolution order — try the CLI's own current default FIRST, unconditionally;
only fall back to inspecting config repos if that default doesn't actually
work. Don't reverse this: checking `pi_config`/`opencode_config` before ever
trying the CLI's own default means testing a config the CLI might not even be
using, and skips over whatever it's already pointed at (some qwen3.8 variant,
another open-weight model, whatever) without ever asking it.

1. `which pi opencode claude codex copilot 2>/dev/null` — which agent CLIs
   are actually on `PATH` right now. If none are found, stop here and
   report that no supported agent CLI is installed; don't guess or try to
   install one. Default to `pi` if more than one is found and nothing else
   disambiguates (matches this user's usual setup).
2. **First pass — the CLI's own unmodified default.** Smoke-test it with no
   `--provider`/`--model` overrides:

   ```bash
   "${SKILL_DIR}/scripts/smoke-test.sh" pi
   # or:
   "${SKILL_DIR}/scripts/smoke-test.sh" opencode
   ```

   Whatever the CLI does with zero model flags *is* "currently configured"
   on this machine — don't second-guess it by reading a config repo first.
   If this passes, you're done resolving: confirm which model actually
   served the request via the CLI's own introspection (`pi --list-models`
   marks the active default; opencode's model can be read back from
   `opencode.jsonc`/`opencode models` or from the run's own session
   metadata) so you can report a concrete model name, not just "default."
3. **Only if step 2 fails** (non-zero exit, timeout, or wrong reply — read
   the smoke-test's own tail-of-output diagnosis first, this step is not
   for "it was slow"): inspect the config repos below, each existence-gated
   — a missing path is routine, not an error, just "skip this signal, fall
   through to the next one." These are this user's personal setup, not a
   guaranteed environment; none may exist on a collaborator's machine or a
   fresh install, and if none do, that itself is the bail condition (step
   5).
   - If `~/git/pi_config` exists (`test -d ~/git/pi_config`): read `.env`
     (or `~/.pi/agent/.env` if already rendered) for `PI_DEFAULT_PROVIDER` /
     `PI_DEFAULT_MODEL`, falling back to the "Active default is set per
     machine via..." line in `AGENTS.md` if `.env` alone doesn't explain
     the setup (e.g. multi-machine defaults).
   - If `~/git/opencode_config` exists: read `opencode.jsonc.tpl`'s `model`
     / `agent.build.model` field for opencode's current default.
   - If `~/git/tailscale_config` exists: check `aperture.hujson` (or
     whatever gateway config is live) for which model IDs a shared
     remote/self-hosted backend actually serves right now — a model
     referenced elsewhere may have been rotated out, which is itself a
     likely explanation for why step 2 failed.
4. **Retry the smoke test** with whatever explicit provider/model step 3
   turned up. Current Aperture model IDs: `qwen3.8-flash-next-iq4`,
   `qwen3.5-9b`. The `:builder` suffix is retired — `qwen3.8-flash-next-iq4`
   is a single routable model ID.

   ```bash
   "${SKILL_DIR}/scripts/smoke-test.sh" pi --provider aperture --model "qwen3.8-flash-next-iq4"
   "${SKILL_DIR}/scripts/smoke-test.sh" opencode --model "aperture/qwen3.8-flash-next-iq4"
   ```

   If this passes, resolve to this explicit value for the real run. If it
   fails, retry against `qwen3.5-9b` before falling through to step 5.
5. **Only if step 4 also fails, or step 3 found no config repos at all**:
   bail out cleanly. Report the specific blocker (which command failed, what
   it printed) rather than launching the real task on a guess.

Always say which agent+model you resolved and from where ("CLI default, no
override needed" vs. a specific config-repo file), so a stale assumption is
easy to catch.

Each smoke-test invocation sends one prompt, waits up to `--timeout` seconds
(default 300 — observed cold-start latency on a fresh backend has run into
minutes; don't treat a slow first response as a functional failure), and
checks for the expected reply. Exit 0 with `PASS: ...` means that candidate
works. A non-zero exit means don't use that candidate — read the tail of
output it prints to understand why (agent not installed, backend
unreachable, wrong model id) before moving to the next step.

## 2. Pick a task that's actually a good candidate for this

Do not launch against just any open task. Require, in order:

- **Well-specced**: concrete Acceptance Criteria, not vague/exploratory
  ones; the Description pins down scope with specifics (file paths, line
  ranges, function/symbol names) rather than "figure out a good approach."
- **Prior art**: a structurally similar task has already landed in this
  repo — check recent commits / closed tasks with the same label or
  pattern. If nothing comparable has ever been done successfully, this is
  not yet a good unattended-run candidate; either scope it down or run it
  supervised instead.
- **No judgment calls**: the task doesn't require product/design decisions,
  and doesn't require touching the repo's own gating/verification tooling
  (a local model left unsupervised must not be in a position to loosen the
  thing that certifies its own work).

Reject and pick something else rather than launching anyway if a task
fails any of these — that's the actual purpose of this checklist.

Find the task through whatever this repo actually uses (Backlog.md MCP
task, `TODO.md` entry, a GitHub issue) — don't assume one system across
repos.

## 3. Isolate in a worktree

Create a dedicated git worktree for this run rather than working in the
main checkout or an existing feature branch. Follow the repo's own
established convention if it has one (e.g. a sibling `manual-wt/<TASK-ID>`
directory pattern next to an automated driver's own worktrees); otherwise
a plain sibling directory named after the task/branch is fine:

```bash
git worktree add /path/to/worktrees/<TASK-ID> -b <TASK-ID>
```

If the model backing this run is local/self-hosted (nothing leaves the
box), and the task needs gitignored source material the repo normally
keeps out of remote-model reach, symlink those directories into the
worktree from the main checkout. If the model is a remote/hosted one,
don't — respect whatever privacy boundary the repo documents (this is
usually spelled out per-backend, e.g. a "local vs remote planner" split in
existing driver prompt templates).

## 4. Build the prompt

Prefer the repo's own prompt conventions if any exist (grep for something
like a driver/burn prompt template) and adapt it rather than inventing new
rules from scratch. Otherwise use this minimal skeleton:

```text
You are working alone in this repository checkout, a dedicated git
worktree on branch <TASK-ID>. Complete exactly ONE task, given in full
below, end to end.

HARD RULES:
- Never relax or edit this repo's own verification/gating tooling to make
  a stuck task pass. If something genuinely can't be verified with the
  existing gates, that's a BAIL — name the blocker and stop.
- Never fabricate a passing check you did not just run. If a tool/pipeline
  fails repeatedly and you work around it by hand, say so plainly — that's
  an accepted outcome here, but claiming a run that didn't happen is not.
- Match the surrounding code/prose style; comments explain WHAT or WHY,
  never "improved"/"fixed"/"new".

STUCK POLICY: if the same blocker persists across ~3 distinct fix attempts
with no genuine progress, STOP. Write the blocker into the task's notes,
print a line starting `MANUAL_RUN: BAILED —` describing it, and end your
turn.

FINISH PROTOCOL: when every Acceptance Criteria item is genuinely
satisfied, update the task's status/notes, commit locally on this branch
(no push, no PR — a human reviews the worktree directly), then print a
line starting `MANUAL_RUN: DONE —` summarizing what landed.

Your diff should touch only what this task's Acceptance Criteria describe.

---

<full task description + acceptance criteria, verbatim>
```

## 5. Launch, bounded

The wall-clock bound (TTL) is the primary and simplest bound — wrap the
launch in `timeout`:

```bash
cd /path/to/worktrees/<TASK-ID>
nohup timeout <TTL_SECONDS> <agent> <agent-specific-flags> \
    --session-id <task-id>-run \
    -p "@/path/to/prompt.md" \
    > /path/to/logs/<TASK-ID>.log 2>&1 &
```

Default `TTL_SECONDS` to 10800 (3h) unless the user gives a different
budget. Record the PID.

A turn/iteration bound (`max-turns`) only applies when the agent is
literally invoked once per turn with session continuation (e.g. opencode's
`--continue <session-id>` pattern, or repeated `pi -p --session-id`
calls) — most agent CLIs (including `pi -p`) run their own internal
multi-step tool-call loop inside a single invocation, so `timeout` alone
already bounds that. Only build an external per-turn loop-and-check
wrapper if the user explicitly wants turn-level granularity (e.g. to
inspect/steer between turns) rather than a single long-lived process.

## 6. Monitor with minimal oversight

Use `ScheduleWakeup`, not a blocking sleep, to check back periodically
(every 15–20 minutes is reasonable for a multi-hour run). Each check
should be non-blocking:

```bash
tail -n 40 /path/to/logs/<TASK-ID>.log
ps -p <PID> -o pid,etime,stat
cd /path/to/worktrees/<TASK-ID> && git log --oneline -5 && git status --short
```

Only intervene (nudge the run, or kill it) on genuine thrashing signals:
the same failing command repeating verbatim, no commits after a long
stretch with the identical error recurring, or the log showing an obvious
loop. A run that's slow but making incremental progress (new draft
attempts, changing error messages, partial test passes) is not thrashing —
let it continue.

Otherwise let it run until a `MANUAL_RUN: DONE —` / `MANUAL_RUN: BAILED —`
marker appears, the process exits (including via `timeout` killing it at
the TTL), or you've confirmed real thrashing.

## 7. Finish

On `MANUAL_RUN: BAILED —`, TTL expiry, or a thrashing kill: don't push
anything. Report the blocker and the worktree + log paths for manual
review.

On `MANUAL_RUN: DONE —`: the launched agent commits locally only (per its
own FINISH PROTOCOL, step 4 above) and never pushes or opens a PR itself —
that's deliberate, so nothing goes further before a review step happens.
That review step is yours, not optional, and not the same as trusting the
run's own self-report:

1. `git diff --stat <base>..<head>` — confirm the diff touches only what
   the task's Acceptance Criteria describe (task file, the specific
   ref/tools paths named in the task), not unrelated trees. Confirm any
   untracked entries are pre-existing gitignored symlinks (`analysis`,
   `extracted`), not real content that should've been `.gitignore`d or
   was accidentally staged.
2. Check the task file's Acceptance Criteria are actually checked `[x]`,
   not just claimed done in prose.
3. Once the diff passes review, push the branch and open a PR (`gh pr
   create`, following whatever title/body convention recent merged PRs in
   this repo already use) — then **merge it by default** (`gh pr merge
   --squash`, matching this repo's established merge style) rather than
   leaving it open for a separate human pass. Fast-forward the local
   `main` checkout (`git fetch && git merge --ff-only origin/main`) so the
   next task's worktree branches off a `main` that includes it.

Only skip the push/merge and escalate instead if review turns up a real
problem (scope violation, an unchecked AC, fabricated evidence) — report
that plainly rather than merging over it. Always report back:
DONE/BAILED/TTL-expired/killed-for-thrashing, what actually landed (from
`git log`/`git diff`, not from the run's own self-report), and the PR/merge
outcome.

## Bundled scripts

`scripts/smoke-test.sh` — verifies `pi` or `opencode` can reach its
currently configured model and produce a real response (see step 1).
Review it before first use to verify behavior.
