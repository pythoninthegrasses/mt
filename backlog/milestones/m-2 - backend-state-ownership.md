---
id: m-2
title: "Backend State Ownership"
---

## Description

Move business logic from Alpine.js frontend stores into the Rust backend. The frontend should become a thin reactive rendering layer that subscribes to backend-owned state, while Rust owns queue management, library views, playback orchestration, and mutation reconciliation. This eliminates classes of regressions caused by duplicated state (dedupe failures, pagination breaking stats, optimistic local mutations diverging from DB).
