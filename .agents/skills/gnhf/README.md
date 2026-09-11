# gnhf

Launch a bounded, low-supervision overnight (or long-unattended) coding
agent run against one well-specced task, in an isolated git worktree. One
agent, one task, minimally supervised until it finishes, bails, or its
bound expires. See [SKILL.md](SKILL.md) for the full behavior.

## Quickstart

Invoke it by slash command, or just describe what you want in normal
conversation — the description in `SKILL.md` is enough for most agents to
pick it up on their own.

| Agent | Command |
| ----- | ------- |
| Claude Code | `/gnhf <task-id-or-description> [ttl] [max-turns]` |
| pi | `/skill:gnhf <task-id-or-description> [ttl] [max-turns]` |
| opencode | describe the task in chat; opencode loads the skill from its description |

## Parameters

All parameters are optional except the task itself.

- **`task-id-or-description`** — the task to run, however this repo tracks
  it: a Backlog.md task ID, a `TODO.md` entry, a GitHub issue, or a plain
  description if the repo has no tracker. Must be well-specced (concrete
  acceptance criteria, prior art in the repo, no judgment calls) — the
  skill screens for this and picks a different task, or asks you to
  respecify, if it isn't.
- **`ttl`** — wall-clock budget in seconds before the run is killed via
  `timeout`. Defaults to `10800` (3 hours) if omitted.
- **`max-turns`** — turn/iteration bound, only meaningful when the agent is
  invoked once per turn with session continuation. Most single-invocation
  agent CLIs run their own internal tool-call loop, so `ttl` alone already
  bounds those; omit this unless you specifically want turn-level control.

## Example

```text
/gnhf TASK-042 7200
```

Runs task `TASK-042` with a 2-hour wall-clock budget, default agent/model
resolution, no turn limit.

## What happens after

The skill reports back one of: `DONE` (reviewed, pushed, and merged),
`BAILED` (blocked, nothing pushed), TTL-expired, or killed for thrashing —
along with the worktree and log paths for manual review. See
[SKILL.md](SKILL.md) steps 6-7 for the monitoring and finish protocol.
