# Git Workflow

Atomic commit practices and worktree management for the MT project.

## Atomic Commits

Each commit should contain a single, complete, and coherent unit of work. "Don't mix your apples with your toaster."

### Benefits

- **Debugging**: `git bisect` to rapidly identify problems
- **Code History**: Organized, understandable commit logs
- **Collaboration**: Focused code reviews
- **Safe Operations**: Revert or cherry-pick without side effects

### Interactive Staging

```bash
# Interactive mode - select which files/hunks to stage
git add -i

# Patch mode - directly choose hunks to stage
git add -p <file>

# Other patch commands
git reset --patch        # Unstage specific hunks
git checkout --patch     # Discard specific hunks
git stash save --patch   # Stash specific hunks
```

### Interactive Mode Commands (`git add -i`)

| Key | Action |
|-----|--------|
| `s` / `1` | View status (staged vs unstaged) |
| `u` / `2` | Stage files |
| `r` / `3` | Unstage files |
| `a` / `4` | Add untracked files |
| `p` / `5` | Patch mode (select hunks) |
| `d` / `6` | View diff of staged files |

### Patch Mode Commands

| Key | Action |
|-----|--------|
| `y` | Stage this hunk |
| `n` | Skip this hunk |
| `s` | **Split** into smaller hunks |
| `e` | Manually edit the hunk |
| `q` | Quit |
| `a` | Stage this + all later hunks |
| `d` | Skip this + all later hunks |
| `g` | Jump to a specific hunk |
| `/` | Search hunks by regex |

### Workflow

1. `git status` and `git diff` to review changes
2. `git add -i` to enter interactive mode
3. Stage related files with `u`
4. Use `p` for files with mixed changes
5. Use `s` to split large hunks
6. Review with `d`, then `q` to exit
7. `git commit -m "descriptive message"`
8. Repeat for remaining changes

### Before Pushing

1. Review history: `git log --oneline`
2. When ready, offer to squash: `git rebase -i HEAD~N`

## Git Worktree Management (worktrunk)

The project uses [worktrunk](https://github.com/max-sixty/worktrunk) (`wt`) for managing git worktrees.

### Basic Operations

```bash
wt list                              # List existing worktrees
wt switch feature                    # Switch to existing worktree
wt switch --create feature           # Create new worktree from HEAD
wt switch --create feature --base=main  # Create from specific branch
wt switch -c feature -x "cargo tauri dev"  # Create and run command
wt switch ^                          # Switch to default branch
wt switch -                          # Switch to previous worktree
```

### Merge Workflow

```bash
wt merge                     # Full: squash, rebase, merge, cleanup
wt merge develop             # Merge to specific branch
wt merge --no-squash         # Keep commit history
wt merge --no-remove         # Keep worktree after merge
wt merge -y                  # Skip approval prompts
wt merge main -y --no-remove # Combined options
```

**`wt merge` pipeline:**

1. **Squash** - Combine commits since target into one
2. **Rebase** - Rebase onto target if behind
3. **Pre-merge hooks** - Run tests/lint
4. **Merge** - Fast-forward merge
5. **Cleanup** - Remove worktree and branch

### Staging Options

```bash
wt merge --stage=all      # Default: untracked + unstaged
wt merge --stage=tracked  # Only tracked changes
wt merge --stage=none     # Only already-staged
```

### Granular Operations

```bash
wt step squash                       # Squash commits
wt step rebase                       # Rebase onto target
wt step push                         # Push to remote
wt step for-each -- git status       # Run in all worktrees
```

### Cleanup

```bash
wt remove                            # Remove current worktree
wt remove feature                    # Remove by branch name
wt remove feature --no-delete-branch # Keep branch
wt remove feature -D                 # Force delete unmerged
```
