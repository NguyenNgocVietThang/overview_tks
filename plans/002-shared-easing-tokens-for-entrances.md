# 002 — Add shared easing tokens and use a strong ease-out on entrance/exit motion

- **Status**: DONE
- **Commit**: 064d49e
- **Severity**: MEDIUM
- **Category**: Easing & duration / Cohesion & tokens
- **Estimated scope**: 1 file (`server/public/index.html`), 1 token addition + 3 call sites

## Problem

`server/public/index.html` has no shared easing tokens — every `transition`/`animation`
declaration hand-types a bare `ease`. For most of them this is actually **correct**: per
AUDIT.md's easing decision order, "Hover / color change → `ease`" — and the majority of this
file's transitions (button/input hover states like `server/public/index.html:95`,
`:127`, `:209`, `:244`, `:282`) are exactly that, so they are not being changed by this plan.

Three transitions, however, are **entering/exiting** motion, where the decision order calls for
a strong `ease-out` instead of the weak built-in curve:

```css
/* server/public/index.html:145 — current (mobile sidebar drawer, entering/exiting) */
.sidebar{
  width:var(--sidebar-w); flex-shrink:0; background:var(--panel-2);
  border-right:1px solid var(--border); padding:18px 12px;
  position:sticky; top:0; align-self:flex-start; height:calc(100vh - 78px);
  transition:transform .28s ease; z-index:20;
}
```

```css
/* server/public/index.html:165-167 — current (view/tab swap, entering) */
.view{ display:none; animation:fadein .25s ease; }
.view.active{ display:block; }
@keyframes fadein{ from{opacity:0; transform:translateY(4px);} to{opacity:1; transform:none;} }
```

```css
/* server/public/index.html:500-506 — current (full-screen loading veil, entering/exiting) */
.loading-veil{
  position:fixed; inset:0; background:var(--veil); backdrop-filter:blur(2px);
  display:flex; align-items:center; justify-content:center; z-index:50;
  font-family:var(--font-data); color:var(--amber); font-size:13px; font-weight:500; font-variant-numeric:tabular-nums;
  opacity:0; pointer-events:none; transition:opacity .2s ease;
}
.loading-veil.show{ opacity:1; pointer-events:all; }
```

All three durations (280ms, 250ms, 200ms) are already within AUDIT.md's UI budget — only the
easing curve needs to change.

## Target

Add one new token to `:root` (a strong ease-out, per AUDIT.md's exact value — never
approximate it):

```css
/* target — server/public/index.html, inside :root{...} */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* strong ease-out for entering/exiting UI */
```

Then use it in the three entrance/exit spots:

```css
/* target */
.sidebar{ ...; transition:transform .28s var(--ease-out); z-index:20; }

.view{ display:none; animation:fadein .25s var(--ease-out); }

.loading-veil{ ...; transition:opacity .2s var(--ease-out); }
```

## Repo conventions to follow

- All shared visual tokens (colors, spacing constants like `--sidebar-w`, fonts) already live
  in the `:root{...}` block at the very top of `<style>` (`server/public/index.html:18-40`).
  Add `--ease-out` there, grouped with the other tokens, not in a new block.
- The codebase defines both a dark (`:root`) and light (`:root[data-theme="light"]`) palette —
  `--ease-out` is not a color, so it only needs to be declared once in the base `:root` block
  (`server/public/index.html:18-40`), not repeated in the `:root[data-theme="light"]` override
  (`server/public/index.html:41-59`).

## Steps

1. In the base `:root{...}` block (`server/public/index.html:18-40`), add the new token. A
   natural spot is right after `--sidebar-w:210px;`:
   ```css
   --sidebar-w:210px;
   --ease-out:cubic-bezier(0.23, 1, 0.32, 1);
   --font-display:'Be Vietnam Pro',sans-serif;
   ```

2. In `.sidebar` (`server/public/index.html:145`), change:
   ```css
   transition:transform .28s ease; z-index:20;
   ```
   to:
   ```css
   transition:transform .28s var(--ease-out); z-index:20;
   ```

3. In `.view` (`server/public/index.html:165`), change:
   ```css
   .view{ display:none; animation:fadein .25s ease; }
   ```
   to:
   ```css
   .view{ display:none; animation:fadein .25s var(--ease-out); }
   ```

4. In `.loading-veil` (`server/public/index.html:504`), change:
   ```css
   opacity:0; pointer-events:none; transition:opacity .2s ease;
   ```
   to:
   ```css
   opacity:0; pointer-events:none; transition:opacity .2s var(--ease-out);
   ```

## Boundaries

- Do NOT change any of the hover/color-change transitions (`server/public/index.html:70`, `:95`,
  `:117`, `:127`, `:152`, `:209`, `:218`, `:229`, `:244`, `:282`, `:290`, `:379`) — per AUDIT.md,
  "Hover / color change → `ease`" is the *correct* choice for these, not a finding. Leave them
  exactly as they are.
- Do NOT touch `.refresh-btn svg{ transition:transform .15s ease; }` (`server/public/index.html:122`)
  — no rule in the stylesheet ever changes that element's `transform`, so this transition never
  fires; it's dead CSS, not a motion bug, and out of scope for this plan.
- Do NOT change any duration values — only the easing keyword/token.
- Do NOT add `--ease-in-out` or `--ease-drawer` tokens — nothing in this file currently needs
  them (no on-screen morphing motion, no gesture-driven drawer). Only add `--ease-out`.
- If the cited line numbers or code no longer match what you find in the file (drift since
  commit `064d49e`), STOP and report instead of improvising.

## Verification

- **Mechanical**: open `server/public/index.html` in a browser and confirm no CSS parse errors
  (DevTools console clean, computed styles resolve `var(--ease-out)` to
  `cubic-bezier(0.23, 1, 0.32, 1)` on `.sidebar`, `.view`, `.loading-veil`).
- **Feel check**:
  - On a narrow viewport (≤760px), open the mobile menu — the sidebar should slide in noticeably
    faster at the start and ease into place, instead of the flat, mechanical feel of the
    built-in `ease` curve. In DevTools → Animations panel, set playback to 10% and confirm the
    transform moves quickly at first then settles — not linear-feeling.
  - Switch tabs — the view fade/slight-rise-in should feel snappier at the start of the motion.
  - Trigger the loading veil (manual refresh) — its fade-in should feel crisper.
  - Toggle `prefers-reduced-motion` (Rendering panel) and confirm these three still respect the
    existing global reduced-motion rule at `server/public/index.html:524-531` (durations drop to
    `.01ms`).
- **Done when**: `--ease-out` is defined once in `:root`, exactly the three entrance/exit
  declarations above use it, and every hover/color-change transition in the file is untouched.
