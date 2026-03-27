---
id: TASK-293
title: Add "Neon Love" theme preset (from Tauon Music Box)
status: Done
assignee: []
created_date: '2026-03-07 23:13'
updated_date: '2026-03-07 23:49'
labels:
  - frontend
  - theme
dependencies: []
references:
  - app/frontend/styles.css (neon-love theme CSS)
  - app/frontend/js/stores/ui.js (theme switching logic)
  - app/frontend/main.js (pre-Alpine theme init)
  - app/frontend/views/settings.html (theme preset buttons)
  - app/frontend/__tests__/ui.store.test.js (theme tests)
  - /Users/lance/Library/CloudStorage/Dropbox/mt/love.css (Love palette source)
  - >-
    /Users/lance/Library/CloudStorage/Dropbox/mt/tauon/Screenshot 2026-03-07 at
    4.11.39 PM.png (visual reference)
documentation:
  - 'https://love.holllo.cc (Love color palette)'
  - 'https://github.com/taiko2k/tauon/wiki/Theming (Tauon theme format)'
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a third theme preset called "Neon Love", inspired by the Tauon Music Box theme of the same name. The theme uses the [Love color palette](https://love.holllo.cc) — dark purple backgrounds with a rainbow of neon accent colors.

## Reference

- **Love CSS palette**: `/Users/lance/Desktop/love.css` (MIT license, v0.1.0)
- **Screenshot**: `/Users/lance/Desktop/tauon/Screenshot 2026-03-07 at 4.11.39 PM.png`
- **Tauon source**: The Neon Love `.ttheme` file uses Love palette colors for its dark variant
- **Existing theme to follow as pattern**: Metro Teal (`[data-theme-preset='metro-teal']` in `app/frontend/styles.css:194-343`)

## Color Palette (Love Dark Variant)

Backgrounds (deep purple):
- `--db-1: #1F1731` (darkest, main bg)
- `--db-2: #2A2041` (card/panel bg)

Foreground (light lavender):
- `--df-1: #F2EFFF` (primary text)
- `--df-2: #E6DEFF` (secondary text)

Accent rainbow (10 neon colors):
- `--da-1: #F99FB1` (rose)
- `--da-2: #FAA56C` (orange)
- `--da-3: #D2B83A` (gold)
- `--da-4: #96C839` (lime green — used for "now playing" indicator in Tauon)
- `--da-5: #3BD18A` (emerald)
- `--da-6: #3ECDBF` (teal)
- `--da-7: #41C8E5` (cyan — primary accent in Tauon: buttons, seek bar, volume)
- `--da-8: #98B9F8` (blue)
- `--da-9: #D5A6F8` (violet)
- `--da-10: #F99ADD` (magenta — album text in Tauon)

Grays:
- `--dg-1: #E2E2E2`, `--dg-2: #C6C6C6`, `--dg-3: #ABABAB`

## Tauon Neon Love Color Assignments

From the `.ttheme` file, these are how Tauon maps Love colors to UI elements:
- Track title text: `#F2EFFF` (--df-1, lavender white)
- Track artist: `#41C8E5` (--da-7, cyan)
- Track album: `#F99ADD` (--da-10, magenta/pink)
- Track index: `#3BD18A` (--da-5, emerald green)
- Now playing indicator: `#96C839` (--da-4, lime green)
- Favorite marker: `#D2B83A` (--da-3, gold)
- Buttons active / seek bar / volume: `#41C8E5` (--da-7, cyan)
- Menu background: `#1F1731` (--db-1)
- Menu highlight: `#3C2864` (derived purple)
- Playing highlight: cyan at 30 alpha
- Selection highlight: lavender `#D2BEFF` at 15 alpha

## Proposed MT CSS Variable Mapping

```
[data-theme-preset='neon-love'] {
  --background: 268 37% 14%;       /* #1F1731 */
  --foreground: 251 100% 97%;      /* #F2EFFF */
  --card: 268 34% 19%;             /* #2A2041 */
  --card-foreground: 251 100% 97%;
  --popover: 268 34% 19%;
  --popover-foreground: 251 100% 97%;
  --primary: 191 76% 58%;          /* #41C8E5 cyan */
  --primary-foreground: 268 37% 14%;
  --secondary: 268 30% 22%;        /* slightly lighter purple */
  --secondary-foreground: 251 100% 97%;
  --muted: 268 30% 22%;
  --muted-foreground: 0 0% 67%;    /* #ABABAB */
  --accent: 191 76% 58%;           /* cyan, same as primary */
  --accent-foreground: 268 37% 14%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 251 100% 97%;
  --border: 268 25% 25%;
  --input: 268 30% 22%;
  --ring: 191 76% 58%;

  --mt-playing-bg: 268 40% 18%;    /* subtle purple tint */
  --mt-playing-fg: 81 55% 51%;     /* #96C839 lime green */
  --mt-row-even: 268 37% 14%;      /* #1F1731 */
  --mt-row-odd: 268 34% 16%;       /* slightly lighter */
  --mt-row-hover: 268 30% 22%;
  --mt-progress-bg: 268 25% 25%;
  --mt-progress-fill: 191 76% 58%; /* cyan */
  --mt-toast-bg: hsl(191 76% 58%);
  --mt-toast-fg: #1F1731;
}
```

## Implementation Steps

### 1. CSS (`app/frontend/styles.css`)
- Add `[data-theme-preset='neon-love']` variable block (after metro-teal block, ~line 224)
- Add component-specific overrides mirroring the metro-teal pattern (track rows, footer, progress bar, sidebar, titlebar, settings panels, etc.)
- The neon-love theme is always dark mode (like metro-teal)

### 2. Theme Store (`app/frontend/js/stores/ui.js`)
- Add `'neon-love'` to the `setThemePreset()` validation array (line 144)
- Add `'neon-love'` case to `applyThemePreset()` — force dark class like metro-teal does

### 3. Pre-Alpine Init (`app/frontend/main.js`)
- Add `'neon-love'` to the early theme application logic (~line 122-140)

### 4. Settings UI (`app/frontend/views/settings.html`)
- Add a third theme preset button "Neon Love" alongside "Light" and "Metro Teal" (~lines 47-62)

### 5. Tests
- Update any theme-related unit tests to include the new preset name
- Add Playwright visual regression snapshot for neon-love if visual regression tests exist
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Neon Love theme preset selectable in Settings > Appearance alongside Light and Metro Teal
- [x] #2 Theme uses Love dark palette: deep purple backgrounds (#1F1731, #2A2041), lavender text (#F2EFFF), cyan primary accent (#41C8E5)
- [x] #3 Now-playing track row uses lime green indicator (#96C839) matching Tauon's Neon Love
- [x] #4 All component overrides present: track rows, footer, progress bar, sidebar, titlebar, settings panels, borders
- [x] #5 Theme persists across app restart (saved to settings store)
- [x] #6 No flash of wrong theme on startup (pre-Alpine init handles neon-love)
- [x] #7 All existing tests pass with the new theme added
- [x] #8 deno lint, deno fmt, cargo clippy, cargo fmt all pass
<!-- AC:END -->
