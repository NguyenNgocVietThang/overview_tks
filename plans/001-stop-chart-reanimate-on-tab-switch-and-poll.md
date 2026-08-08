# 001 — Stop charts replaying their entrance animation on tab switch, theme toggle, and background poll

- **Status**: DONE
- **Commit**: 064d49e
- **Severity**: HIGH
- **Category**: Purpose & frequency / Interruptibility / Performance
- **Estimated scope**: 1 file (`server/public/index.html`), ~10 small edits, no new dependencies

## Problem

`server/public/index.html` is a single-file dashboard. All Chart.js charts are built with a
"destroy old instance, then `new Chart(...)`" pattern:

```js
// server/public/index.html:2003-2005 — current
function destroyChart(key){
  if(state.charts[key]){ state.charts[key].destroy(); delete state.charts[key]; }
}
```

Chart.js defaults to animating every newly-created chart's values in from zero over
**1000ms** with `easeOutQuart`. Because charts are always destroyed and rebuilt (never
updated in place), this 1000ms "grow from zero" replay fires every time `renderView()` runs —
including on triggers that are **not** a deliberate, expected data change:

1. **Tab switching** — `switchView()` calls `renderView(view)` unconditionally, even when
   `state.data` hasn't changed since the last time that tab was rendered. Switching tabs is a
   "tens of times/day" action (AUDIT.md category 1 frequency table), which should have its
   animation removed or drastically reduced, not replayed in full every click.
   ```js
   // server/public/index.html:1879-1895 — current
   function switchView(view){
     state.view = view;
     document.querySelectorAll('.nav-item').forEach(function(el){
       const isActive = el.dataset.view === view;
       el.classList.toggle('active', isActive);
       if(isActive) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
     });
     document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
     document.getElementById('view-' + view).classList.add('active');
     document.getElementById('sidebar').classList.remove('open');
     document.getElementById('backdrop').classList.remove('show');
     document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
     document.getElementById('menuBtn').setAttribute('aria-label', 'Mở menu điều hướng');
     updateFilterBar();
     resetSearchForView();
     if(state.data) renderView(view);
   }
   ```

2. **Background auto-refresh** — a `setInterval` polls every 10 minutes; when the fetched data
   differs from what's on screen, `renderView()` runs with no user interaction at all. A chart
   silently animating itself while the user is reading it is a jarring, unexpected motion.
   ```js
   // server/public/index.html:2706-2741 — current (relevant part)
   function loadData(days, isManualRefresh){
     state.lastFetchTime = Date.now();
     if (isManualRefresh) setLoading(true);
     const miniFilterQuery = buildMiniFilterQuery();
     fetch('/api/dashboard?days=' + encodeURIComponent(days) + (miniFilterQuery ? '&' + miniFilterQuery : ''))
       .then(function(res){ if(!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
       .then(function(data){
         const { updatedAt, ...rest } = data;
         const fingerprint = JSON.stringify(rest);
         const changed = fingerprint !== state.lastFingerprint;
         state.lastFingerprint = fingerprint;
         state.data = data;
         document.getElementById('updatedAt').textContent = 'Cập nhật lúc ' + updatedAt + (changed ? '' : ' (không đổi)');
         if (changed || isManualRefresh) {
           try { renderView(state.view); }
           catch(err) { console.error('Render error:', err); alert('Lỗi hiển thị dữ liệu: ' + (err && err.message ? err.message : err)); }
         }
         if (isManualRefresh) setLoading(false);
       })
       .catch(function(err){ /* ... */ });
   }
   // server/public/index.html:2751
   setInterval(function(){ loadData(state.days, false); }, AUTO_REFRESH_MS);
   ```

3. **Theme toggle** — switching dark/light re-renders the current view purely so charts pick up
   new theme colors; the data hasn't changed, so an entrance replay makes no sense here either.
   ```js
   // server/public/index.html:1380-1386 — current
   function toggleTheme(){
     const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
     document.documentElement.dataset.theme = nextTheme;
     try{ localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch(err){}
     syncThemeControl();
     if(state.data) renderView(state.view);
   }
   ```

Beyond the feel problem, destroying and rebuilding every Chart.js instance (canvas context,
scales, plugins, datasets) on every one of these triggers is wasted CPU/GC work — this is a
real performance cost, not just a cosmetic one.

## Target

- A single shared flag, `state.chartAnimation`, controls whether the *next* `renderView()` call
  is allowed to animate its charts in. It defaults to `true` (so first load keeps its nice
  "dashboard assembling" moment) and is set to `false` right before any render that is **not**
  a deliberate, user-requested new-data event (tab switch, background poll, theme toggle).
- Chart.js's global default animation duration drops from 1000ms to **300ms** — the UI-motion
  budget's upper bound (AUDIT.md duration table: "Modals, drawers → 200–500ms"; a full chart
  entrance is the closest analog available in this codebase) — so that even the cases that
  *do* animate (first load, manual refresh) feel snappy rather than sluggish.
- Every `render*Chart` function reads `state.chartAnimation` and passes it to Chart.js as
  `animation: state.chartAnimation ? { duration: 300 } : false`.

```js
/* target — server/public/index.html, near line 1346 */
Chart.defaults.font.family = 'Inter, sans-serif';
Chart.defaults.font.weight = '400';
Chart.defaults.animation.duration = 300;
Chart.defaults.plugins.tooltip.titleFont = { family:'Inter, sans-serif', weight:'600' };
Chart.defaults.plugins.tooltip.bodyFont = { family:'IBM Plex Mono, monospace', weight:'500' };

/* target — server/public/index.html, chartAnimationOption() helper, placed next to chartTheme() */
function chartAnimationOption(){
  return state.chartAnimation ? { duration: 300 } : false;
}
```

## Repo conventions to follow

- There is no existing animation-flag convention in this codebase — this plan introduces the
  first one. Keep it as a single boolean on the existing `state` object (`server/public/index.html:1320`),
  consistent with how every other piece of UI state (`state.view`, `state.days`,
  `state.productStatus`, …) already lives there.
- `chartTheme()` (`server/public/index.html:1356`) is the existing pattern for a small helper
  that every `render*Chart` function calls to read shared config — add `chartAnimationOption()`
  right next to it and call it the same way.
- Every `render*Chart` function already has an `options: { responsive: true, maintainAspectRatio: false, ... }`
  block — add the `animation` key inside that same object, don't create a second options merge step.

## Steps

1. In the `state` object (`server/public/index.html:1320-1345`), add `chartAnimation: true,`
   as a new field (e.g. right after `charts: {},`):
   ```js
   const state = {
     data: null,
     days: 30,
     view: 'overview',
     charts: {},
     chartAnimation: true,
     productStatus: 'all',
     ...
   };
   ```

2. Right after the existing `Chart.defaults.*` lines (`server/public/index.html:1346-1349`), add:
   ```js
   Chart.defaults.animation.duration = 300;
   ```

3. Next to `chartTheme()` (`server/public/index.html:1356-1361`), add:
   ```js
   function chartAnimationOption(){
     return state.chartAnimation ? { duration: 300 } : false;
   }
   ```

4. In each of the 5 chart-creation functions, add `animation: chartAnimationOption(),` as the
   first key inside the `options: { ... }` object passed to `new Chart(...)`:
   - `renderRevenueChart` (`server/public/index.html:2029`) — options block starts
     `options: { responsive: true, maintainAspectRatio: false, ...`
   - `renderTopTransactionsChart` (`server/public/index.html:2076`) — options block starts
     `options: { responsive:true, maintainAspectRatio:false, ...`
   - `renderBarChartList` (`server/public/index.html:2119`) — options block starts
     `options: { indexAxis: vertical ? 'x' : 'y', responsive: true, maintainAspectRatio: false, ...`
   - `renderPieChartList` (`server/public/index.html:2176`) — options block starts
     `options: { responsive: true, maintainAspectRatio: false, cutout: '68%', ...`
   - `renderCategoryValueChart` (`server/public/index.html:2241`) — options block starts
     `options: { responsive: true, maintainAspectRatio: false, ...`

   Example for `renderRevenueChart`:
   ```js
   options: {
     animation: chartAnimationOption(),
     responsive: true, maintainAspectRatio: false,
     plugins: { ... },
     scales: { ... }
   }
   ```

5. In `switchView()` (`server/public/index.html:1879-1895`), suppress animation around the
   `renderView` call since this fires on every tab click and the underlying data is unchanged:
   ```js
   if(state.data){
     state.chartAnimation = false;
     renderView(view);
     state.chartAnimation = true;
   }
   ```

6. In `toggleTheme()` (`server/public/index.html:1380-1386`), do the same — the re-render exists
   only to repaint theme colors, not to show new data:
   ```js
   function toggleTheme(){
     const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
     document.documentElement.dataset.theme = nextTheme;
     try{ localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch(err){}
     syncThemeControl();
     if(state.data){
       state.chartAnimation = false;
       renderView(state.view);
       state.chartAnimation = true;
     }
   }
   ```

7. In `loadData()` (`server/public/index.html:2706-2741`), only allow chart animation when the
   call is the manual-refresh / first-load path (`isManualRefresh === true`); silent background
   polls that happen to detect changed data must not animate:
   ```js
   if (changed || isManualRefresh) {
     try {
       state.chartAnimation = !!isManualRefresh;
       renderView(state.view);
       state.chartAnimation = true;
     } catch(err) {
       console.error('Render error:', err);
       alert('Lỗi hiển thị dữ liệu: ' + (err && err.message ? err.message : err));
     }
   }
   ```
   (The existing call at `server/public/index.html:2750`, `loadData(state.days, true)` for the
   initial page load, already passes `isManualRefresh = true`, so first paint keeps its
   animated entrance — no change needed there.)

## Boundaries

- Do NOT touch the fingerprint/skip-render logic itself (`changed`, `state.lastFingerprint`) —
  it's already correct and this plan builds on top of it, not around it.
- Do NOT change any chart's `data`, `scales`, `plugins`, colors, or `type`.
- Do NOT switch the destroy/recreate architecture to Chart.js's `update()` diffing — that's a
  larger structural change; this plan only gates the existing entrance animation.
- Do NOT add animation gating to `setProductAnalysis()` (`server/public/index.html:1903-1910`)
  or the mini-filter/product-status handlers (`setProductStatus`, `setMiniFilterDays`,
  `setMiniFilterAll`, `applyMiniFilterRange`) — these call `renderProductSalesAnalysis` or
  `loadData(..., false)` as the direct result of a deliberate, occasional user click that
  changes visible chart content, so they should keep animating. Leave `state.chartAnimation` at
  its default (`true`) for these paths.
- If any of the cited line numbers or code no longer match what you find in the file (drift
  since commit `064d49e`), STOP and report instead of improvising.

## Verification

- **Mechanical**: open `server/public/index.html` in a browser (e.g. via the project's normal
  dev/start command) and confirm no console errors on load, tab switch, theme toggle, and
  manual refresh click.
- **Feel check**:
  - Load the dashboard. The very first paint should still show charts growing in (confirms the
    `isManualRefresh: true` initial load path still animates).
  - Click between the Overview / Products / Invoices tabs rapidly several times. Charts must
    appear instantly on each switch — no "grow from zero" replay.
  - Toggle the theme (dark/light) button. Charts must instantly repaint in new colors with no
    entrance replay.
  - Click the manual "Refresh" button. If the data actually changed, charts should animate in
    (short — well under the old 1s feel); if data is unchanged, no jarring recreate should be
    visible either way since duration is now 300ms.
  - In DevTools → More tools → Animations (or the Rendering panel's paint flashing), confirm no
    animation frames fire during a tab switch.
- **Done when**: tab switching and theme toggling never replay chart entrance animation, manual
  refresh and first load still animate at 300ms, and no chart's data/colors/behavior changed.
