# 005 — Fade in customer debt-detail rows instead of teleporting them open

- **Status**: DONE
- **Commit**: 064d49e
- **Severity**: LOW
- **Category**: Missed opportunity
- **Estimated scope**: 1 file (`server/public/index.html`), 1 CSS rule + 1 JS function edit

## Problem

Clicking a row in the customer-debt table reveals a detail row with that customer's
transaction history. The reveal is an instant `display` flip with no motion at all, even though
this is exactly the kind of spatially-connected reveal AUDIT.md's "missed opportunities"
category calls out — content appearing that is clearly *owned by* the row just clicked, with no
transition explaining where it came from.

```js
/* server/public/index.html:2683-2690 — current */
function toggleDebtDetail(idx){
  const row = document.getElementById('debt-detail-' + idx);
  if(!row) return;
  const isOpen = row.style.display === 'none';
  row.style.display = isOpen ? 'table-row' : 'none';
  const trigger = row.previousElementSibling;
  if(trigger && trigger.classList.contains('debt-row')) trigger.setAttribute('aria-expanded', String(isOpen));
}
```

```css
/* server/public/index.html:490-493 — current */
.debt-row:hover td{ background:var(--surface-hover); }
.debt-row:focus-visible{ outline:2px solid var(--blue); outline-offset:-2px; }
.debt-detail-row > td{ background:var(--panel-2); }
```

Note: `<tr>`/`<td>` cannot have their height/`display` animated with a CSS transition (`display`
is not animatable, and table row layout doesn't support `height: auto` transitions). This plan
does **not** attempt that — it fades the *inner content* of the revealed cell instead, which is
transitionable and gives the reveal a soft entrance rather than a hard cut.

## Target

```css
/* target — server/public/index.html, replacing the .debt-detail-row rule at :493 */
.debt-detail-row > td{ background:var(--panel-2); }
.debt-detail-row > td > *{
  animation:debtDetailFadeIn .18s var(--ease-out);
}
@keyframes debtDetailFadeIn{
  from{ opacity:0; transform:translateY(-3px); }
  to{ opacity:1; transform:none; }
}
```

```js
/* target — server/public/index.html, toggleDebtDetail() unchanged logic, no JS edit needed */
function toggleDebtDetail(idx){
  const row = document.getElementById('debt-detail-' + idx);
  if(!row) return;
  const isOpen = row.style.display === 'none';
  row.style.display = isOpen ? 'table-row' : 'none';
  const trigger = row.previousElementSibling;
  if(trigger && trigger.classList.contains('debt-row')) trigger.setAttribute('aria-expanded', String(isOpen));
}
```

The animation is driven entirely by CSS: every time `row.style.display` is set to
`'table-row'`, the browser re-inserts `.debt-detail-row > td > *` into layout, which restarts
its `animation` from `0%` automatically (this is the one case in this codebase where a
`@keyframes` restart-from-zero is actually correct — see Boundaries).

## Repo conventions to follow

- Use the `--ease-out` token from plan 002 (`server/public/index.html`, `:root`) rather than a
  bare `ease`, since this is an entering reveal.
- Follow the file's existing `@keyframes` naming/placement convention — `fadein`
  (`server/public/index.html:167`) and `spin` (`server/public/index.html:136`) are both declared
  immediately after the rule that uses them. Declare `@keyframes debtDetailFadeIn` immediately
  after the `.debt-detail-row > td > *` rule, in the same spot the `.debt-detail-row` rule
  currently lives (`server/public/index.html:493`).

## Steps

1. Replace the single line at `server/public/index.html:493`:
   ```css
   .debt-detail-row > td{ background:var(--panel-2); }
   ```
   with:
   ```css
   .debt-detail-row > td{ background:var(--panel-2); }
   .debt-detail-row > td > *{
     animation:debtDetailFadeIn .18s var(--ease-out);
   }
   @keyframes debtDetailFadeIn{
     from{ opacity:0; transform:translateY(-3px); }
     to{ opacity:1; transform:none; }
   }
   ```

2. No JavaScript changes are required — `toggleDebtDetail()` (`server/public/index.html:2683-2690`)
   already re-sets `display:'table-row'` on open, which is sufficient to retrigger the CSS
   animation on the freshly-laid-out content each time.

## Boundaries

- Do NOT attempt to animate `row.style.display` or the `<tr>` height itself — not achievable
  with CSS transitions/animations on table rows; the fade-in-content approach above is the
  correct scope for this plan.
- This is one of the rare correct uses of `@keyframes` instead of a `transition` in this
  codebase: the row's content is fully removed from the DOM's rendered layout (`display:none`)
  between opens, so there is no "current state" for a transition to retarget from — each open is
  a fresh mount, which is exactly what `@keyframes` is for. Do not convert this to a
  `transition`-based approach.
- Do NOT add an exit/closing animation — the row's `display:none` on close is instant by design
  here (matching AUDIT.md interruptibility guidance: a table row users may spam open/closed
  while scanning a long customer list should close instantly, only the reveal gets the
  softening treatment).
- If plan 002 has not been applied yet and `--ease-out` doesn't exist in `:root`, either apply
  plan 002 first, or (if told to proceed standalone) add just that one token
  (`--ease-out:cubic-bezier(0.23, 1, 0.32, 1);`) to `:root` as part of this plan instead of
  leaving `var(--ease-out)` dangling.
- If the cited line numbers or code no longer match what you find in the file (drift since
  commit `064d49e`), STOP and report instead of improvising.

## Verification

- **Mechanical**: open `server/public/index.html` in a browser, navigate to the customer debt
  table, confirm no console errors.
- **Feel check**:
  - Click a customer row to reveal its transaction detail — the revealed table should softly
    fade/rise into place rather than snapping into view.
  - Click the same row again to collapse it, then click it open again — the fade-in should play
    every time (confirming the animation correctly restarts on each open).
  - Rapidly click two different rows back-to-back — each newly opened row's content should fade
    in independently without affecting the other.
  - In DevTools → Animations panel, set playback to 10% on a row-open click and confirm the
    detail table fades and rises ~3px, settling within ~180ms.
  - Toggle `prefers-reduced-motion` (Rendering panel) and confirm the animation duration drops to
    `.01ms` per the existing global rule (`server/public/index.html:524-531`) — the row should
    still appear, just without the motion.
- **Done when**: opening a debt-row detail fades its content in every time, closing remains
  instant, and no other table's expand/collapse behavior in the file was touched.
