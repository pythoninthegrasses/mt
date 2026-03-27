# Theming

## Theme Presets

MT ships with three themes defined in `app/frontend/styles.css`:

| Preset | Type | CSS vars defined under |
|--------|------|----------------------|
| (default) | Light | `:root` |
| `metro-teal` | Dark | `[data-theme-preset='metro-teal']` |
| `neon-love` | Dark | `[data-theme-preset='neon-love']` |

## Dark Theme Toggle Overrides

Tailwind's `bg-primary` and `bg-muted` utilities resolve to near-identical colors in the dark themes, making toggle switches unreadable. Any toggle button that uses `bg-primary`/`bg-muted` for its enabled/disabled state **must** have explicit `background-color` overrides for both `metro-teal` and `neon-love`.

Existing pattern in `styles.css`:

```css
/* metro-teal */
[data-theme-preset='metro-teal'] [data-testid='my-toggle'].bg-muted {
  background-color: hsl(0 0% 25%) !important;
}
[data-theme-preset='metro-teal'] [data-testid='my-toggle'].bg-primary {
  background-color: hsl(184 100% 38%) !important;
}

/* neon-love */
[data-theme-preset='neon-love'] [data-testid='my-toggle'].bg-muted {
  background-color: hsl(268 30% 25%) !important;
}
[data-theme-preset='neon-love'] [data-testid='my-toggle'].bg-primary {
  background-color: hsl(191 76% 58%) !important;
}
```

When adding a new toggle to settings, add its `data-testid` selector to the existing grouped rules (search for `toggle overrides` in `styles.css`).

## Adding a New Theme

1. Define CSS custom properties under a new `[data-theme-preset='name']` selector
2. Add the preset to `themes.json`
3. Check all toggles are readable in the new theme — add overrides if `bg-primary`/`bg-muted` lack contrast
4. Run visual regression tests: `cd app/frontend && npx playwright test tests/visual-regression.spec.js`
