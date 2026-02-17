---
name: ideation
description: "Generate AI-powered feature ideas based on project context, existing patterns, and target audience. Covers code improvements, UI/UX, documentation, security, performance, and code quality. Use when brainstorming features, identifying gaps, or populating the backlog with actionable ideas."
---

# Ideation Skill

Generate structured, actionable feature ideas by analyzing the mt codebase through specialized lenses. Adapted from Auto-Claude's ideation agent pattern.

## Ideation Types

| Type | When to Use | Reference |
|------|------------|-----------|
| **Code Improvements** | Finding quick wins, refactoring opportunities, pattern adoption | [code-improvements.md](references/code-improvements.md) |
| **UI/UX Improvements** | Identifying usability, accessibility, and interaction issues | [ui-ux-improvements.md](references/ui-ux-improvements.md) |
| **Documentation** | Finding missing docs, outdated guides, undocumented APIs | [documentation.md](references/documentation.md) |
| **Security** | Hunting vulnerabilities, hardening opportunities, compliance gaps | [security.md](references/security.md) |
| **Performance** | Spotting bottlenecks, optimization targets, caching opportunities | [performance.md](references/performance.md) |
| **Code Quality** | Detecting complexity, duplication, naming issues, testing gaps | [code-quality.md](references/code-quality.md) |

## Workflow

1. **Gather context** - Read project structure, existing backlog tasks, recent commits, and codebase patterns
2. **Select type(s)** - Pick which ideation lens to apply (one or more)
3. **Analyze** - Follow the type-specific reference document to examine the codebase
4. **Generate ideas** - Produce structured JSON ideas with type-specific fields
5. **Convert to tasks** - Optionally create backlog tasks from promising ideas using `task_create`

## Context Gathering

Before generating ideas, always gather:

- **Project structure**: `docs/tauri-architecture.md` for system overview
- **Existing backlog**: Use `task_list` to see current tasks and avoid duplicates
- **Recent changes**: Check git log for recent work patterns
- **Tech stack**: Tauri (Rust backend), Alpine.js + Basecoat/Tailwind (frontend), SQLite (database), Rodio/Symphonia (audio)

## Output Format

Each idea follows a common structure with type-specific extensions:

```json
{
  "id": "<type-prefix>-001",
  "type": "<ideation_type>",
  "title": "Short actionable title",
  "description": "What the improvement does",
  "rationale": "Why this matters",
  "status": "draft",
  "created_at": "ISO timestamp"
}
```

See individual reference documents for type-specific fields.

## Converting Ideas to Backlog Tasks

When an idea is worth pursuing, create a backlog task:

1. Use `task_create` with title from the idea
2. Set description from the idea's description + rationale
3. Map idea type to task label: `code_improvements` -> `feature`, `ui_ux_improvements` -> `ui/ux`, `security_hardening` -> `security`, `performance_optimizations` -> `performance`, `code_quality` -> `refactoring`, `documentation_gaps` -> `documentation`
4. Set priority based on the idea's severity/effort/impact fields
5. Include affected files in the task description
