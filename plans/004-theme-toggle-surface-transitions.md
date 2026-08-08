# 004 — Extend the theme-switch color transition to panels, cards, and the sidebar

- **Status**: DONE
- **Commit**: 064d49e
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file (`server/public/index.html`), 1 CSS rule added

## Problem

Toggling dark/light theme changes CSS custom properties (`--panel`, `--panel-2`, `--border`,
`--text`, …) on `:root` (`server/public/index.html:41-59`). Only `body` has a transition for
the properties that reference these tokens:

```css
/* server/public/index.html:61-71 — current */
body{
  margin:0;
  background:
    radial-gradient(circle at 15% 0%, var(--amber-glow), transparent 45%),
    radial-gradient(circle at 90% 10%, var(--green-glow), transparent 40%),
    var(--bg);
  color:var(--text);
  font-family:var(--font-body);
  min-height:100vh;
  transition:color .2s ease, background-color .2s ease;
}
```

Every other surface that reads these same tokens — `.panel` (`server/public/index.html:350`),
`.kpi-card` (`server/public/index.html:341`), `.sidebar` (`server/public/index.html:141-146`),
`.filterbar` (`server/public/index.html:174-179`), and table headers
(`server/public/index.html:453-462`) — has **no** transition at all, so their background and
border colors snap instantly. The net effect when clicking the theme toggle: the page
background fades smoothly while every card, panel border, and table header flips color in a
single frame — a half-smooth, half-instant switch that reads as inconsistent rather than as one
deliberate motion.

## Target

Add one shared rule covering the surfaces above, using the same property list and duration as
`body` so the whole page transitions as a unit:

```css
/* target — server/public/index.html, placed directly after the body rule at :61-71 */
.panel, .kpi-card, .sidebar, .filterbar, thead th{
  transition:background-color .2s ease, border-color .2s ease, color .2s ease;
}
```

## Repo conventions to follow

- Match `body`'s existing duration and easing exactly (`.2s ease`) — per AUDIT.md, color-change
  transitions correctly use plain `ease`, so this is not a token/easing change, just extending
  the same treatment `body` already has to its sibling surfaces.
- `.sidebar` already has its own `transition:transform .28s ease;` declaration
  (`server/public/index.html:145`, upgraded to `var(--ease-out)` by plan 002) — add the new
  color-transition rule as a *separate* selector grouping (`.panel, .kpi-card, .sidebar, ...`)
  rather than editing `.sidebar`'s existing `transition` shorthand, so plan 002's edit and this
  plan's edit don't collide on the same line.

## Steps

1. Directly after the `body{...}` rule closes (`server/public/index.html:71`), insert:
   ```css
   .panel, .kpi-card, .sidebar, .filterbar, thead th{
     transition:background-color .2s ease, border-color .2s ease, color .2s ease;
   }
   ```

## Boundaries

- Do NOT modify the `body` rule itself.
- Do NOT modify `.sidebar`'s existing `transform` transition — this plan only adds a second,
  separate rule; it does not touch `server/public/index.html:145`.
- Do NOT add this transition to every bordered element in the file (e.g. `.kpi-card .value`,
  `.pill`, `.legend-row`) — scope is limited to the five selectors listed above, which are the
  large, immediately-visible surfaces users see flip color on theme toggle. Broader coverage is
  a separate decision, not this plan's.
- If the cited line numbers or code no longer match what you find in the file (drift since
  commit `064d49e`), STOP and report instead of improvising.

## Verification

- **Mechanical**: open `server/public/index.html` in a browser, confirm no CSS parse errors.
- **Feel check**:
  - Click the theme toggle button. Panel backgrounds, KPI card backgrounds, the sidebar
    background, the filter bar, and table header backgrounds should all fade to their new color
    together with the page background — no visible "some elements already changed, others still
    catching up" moment.
  - In DevTools → Animations panel, set playback to 10% during a theme toggle and confirm
    `.panel`/`.kpi-card`/`.sidebar` background-color animates over the same ~200ms window as
    `body`.
  - Toggle `prefers-reduced-motion` (Rendering panel) and confirm the color transition still
    respects the existing global reduced-motion rule (`server/public/index.html:524-531`,
    durations forced to `.01ms`).
- **Done when**: theme toggling reads as one smooth, synchronized color change across the whole
  page rather than a partial fade.
