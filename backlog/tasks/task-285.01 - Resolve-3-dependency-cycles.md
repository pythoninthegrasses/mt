---
id: TASK-285.01
title: Resolve 3 dependency cycles
status: To Do
assignee: []
created_date: '2026-02-24 00:05'
labels:
  - tech-debt
  - code-health
dependencies: []
parent_task_id: TASK-285
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roam health analysis found 3 dependency cycles in the codebase. Cycles create tight coupling, make testing harder, and inflate build times.

Run `roam health` to identify the specific cycles. Use `roam trace <source> <target>` to understand the dependency paths involved. Break cycles by extracting shared interfaces, inverting dependencies, or restructuring modules.

**Context:** This is part of the roam health improvement initiative (TASK-285). Current health score is 53/100.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 roam health reports 0 dependency cycles
- [ ] #2 No new cycles introduced (verified by roam health)
<!-- AC:END -->
