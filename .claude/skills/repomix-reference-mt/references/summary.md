This file is a merged representation of a subset of the codebase, containing specifically included files and files not matching ignore patterns, combined into a single document by Repomix.
The content has been processed where comments have been removed, content has been compressed (code blocks are separated by ⋮---- delimiter).

# Summary

## Purpose

This is a reference codebase organized into multiple files for AI consumption.
It is designed to be easily searchable using grep and other text-based tools.

## File Structure

This skill contains the following reference files:

| File | Contents |
|------|----------|
| `project-structure.md` | Directory tree with line counts per file |
| `files.md` | All file contents (search with `## File: <path>`) |
| `tech-stack.md` | Languages, frameworks, and dependencies |
| `summary.md` | This file - purpose and format explanation |

## Usage Guidelines

- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes

- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: **/*
- Files matching these patterns are excluded: **/.env, **/*.pxd, backlog/**, docs/**, src-tauri/gen/schemas/**, tests/**, .claude, .editorconfig, .gitignore, .markdownlint.jsonc, .serena, .vscode, AGENTS.md, CLAUDE.local.md, CLAUDE.md, coverage.json, LICENSE, repomix.config.json5, requirements.txt, uv.lock
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Code comments have been removed from supported file types
- Content has been compressed - code blocks are separated by ⋮---- delimiter
- Files are sorted by Git change count (files with more changes are at the bottom)

## Statistics

523 files | 80,557 lines

| Language | Files | Lines |
|----------|------:|------:|
| Markdown | 274 | 46,918 |
| JavaScript | 129 | 2,032 |
| Rust | 54 | 10,412 |
| JSON | 15 | 13,114 |
| HTML | 14 | 2,778 |
| YAML | 12 | 1,616 |
| No Extension | 5 | 118 |
| TOML | 5 | 169 |
| Text | 2 | 187 |
| XML | 2 | 9 |
| Other | 11 | 3,204 |

**Largest files:**
- `crates/mt-tauri/gen/schemas/desktop-schema.json` (3,265 lines)
- `crates/mt-tauri/gen/schemas/macOS-schema.json` (3,265 lines)
- `crates/mt-tauri/gen/schemas/windows-schema.json` (3,199 lines)
- `crates/mt-tauri/gen/schemas/linux-schema.json` (3,037 lines)
- `deno.lock` (1,550 lines)
- `crates/mt-tauri/src/db/library.rs` (1,154 lines)
- `.agents/skills/javascript-testing-patterns/SKILL.md` (1,021 lines)
- `.agents/skills/rust-desktop-applications/references/testing-deployment.md` (961 lines)
- `.agents/skills/rust-desktop-applications/references/state-management.md` (937 lines)
- `.agents/skills/rust-desktop-applications/references/architecture-patterns.md` (901 lines)