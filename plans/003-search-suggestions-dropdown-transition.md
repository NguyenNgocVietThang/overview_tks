# 003 — Animate the search-suggestions dropdown from its trigger instead of teleporting

- **Status**: DONE
- **Commit**: 064d49e
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file (`server/public/index.html`), CSS + 2 JS functions

## Problem

The dashboard search box's suggestions dropdown is shown/hidden purely via the HTML `hidden`
attribute, which the stylesheet forces to `display:none !important`
(`server/public/index.html:172`, `[hidden]{ display:none !important; }`). A `display` toggle
cannot be transitioned, so the dropdown snaps into and out of existence with zero motion —
no scale, no fade, nothing indicating it emerged from the search input above it.

```html
<!-- server/public/index.html:646 — current -->
<div class="suggestions" id="searchSuggestions" role="listbox" hidden></div>
```

```css
/* server/public/index.html:235-239 — current */
.suggestions{
  position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:30;
  max-height:320px; overflow-y:auto; padding:5px;
  background:var(--panel); border:1px solid var(--border); border-radius:10px;
}
```

```js
/* server/public/index.html:1591-1599 — current */
function hideSearchSuggestions(){
  const suggestions = document.getElementById('searchSuggestions');
  suggestions.hidden = true;
  suggestions.innerHTML = '';
  const input = document.getElementById('dashboardSearchInput');
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  state.search.activeIndex = -1;
}
```

```js
/* server/public/index.html:1645-1666 — current */
function renderSuggestions(){
  const suggestions = document.getElementById('searchSuggestions');
  const results = state.search.results;
  const showSource = state.view === 'overview' || state.view === 'invoices' || state.view === 'suppliers';
  if(!results.length){
    suggestions.hidden = true;
    document.getElementById('dashboardSearchInput').setAttribute('aria-expanded', 'false');
    return;
  }

  suggestions.innerHTML = results.map(function(result, index){
    return '<button class="suggestion-item' + (index === state.search.activeIndex ? ' active' : '') + '" ' +
      'id="search-option-' + index + '" type="button" role="option" aria-selected="' + (index === state.search.activeIndex) + '" ' +
      'onclick="chooseSearchResult(' + index + ')">' +
      '<span><span class="suggestion-name">' + escapeHtml(result.name || result.code) + '</span>' +
      '<span class="suggestion-code">' + escapeHtml(result.code || 'Không có mã') + '</span></span>' +
      (showSource ? '<span class="suggestion-source">' + escapeHtml(result.sourceLabel) + '</span>' : '') +
      '</button>';
  }).join('');
  suggestions.hidden = false;
  document.getElementById('dashboardSearchInput').setAttribute('aria-expanded', 'true');
}
```

This is exactly the AUDIT.md category-3 case: "Popovers/dropdowns/tooltips scale from their
trigger, not center" — here it doesn't scale (or fade) at all, it's a hard cut. Per the
duration budget table, dropdowns should be 150–250ms.

## Target

Stop using `hidden` to control visibility (only use it as the closed *rest* state); drive
open/closed through a `.show` class with an opacity + scale-from-top transition, sourced from
`--ease-out` (added in plan 002 — this plan depends on that token existing; see Boundaries if
it's missing).

```css
/* target — server/public/index.html, replacing the .suggestions rule at :235-239 */
.suggestions{
  position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:30;
  max-height:320px; overflow-y:auto; padding:5px;
  background:var(--panel); border:1px solid var(--border); border-radius:10px;
  transform-origin:top;
  opacity:0; transform:scale(0.97) translateY(-4px); pointer-events:none;
  transition:opacity .18s var(--ease-out), transform .18s var(--ease-out);
}
.suggestions.show{
  opacity:1; transform:scale(1) translateY(0); pointer-events:auto;
}
```

```js
/* target — server/public/index.html, hideSearchSuggestions() */
function hideSearchSuggestions(){
  const suggestions = document.getElementById('searchSuggestions');
  suggestions.classList.remove('show');
  const input = document.getElementById('dashboardSearchInput');
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  state.search.activeIndex = -1;
}
```

```js
/* target — server/public/index.html, renderSuggestions() */
function renderSuggestions(){
  const suggestions = document.getElementById('searchSuggestions');
  const results = state.search.results;
  const showSource = state.view === 'overview' || state.view === 'invoices' || state.view === 'suppliers';
  if(!results.length){
    suggestions.classList.remove('show');
    document.getElementById('dashboardSearchInput').setAttribute('aria-expanded', 'false');
    return;
  }

  suggestions.innerHTML = results.map(function(result, index){
    return '<button class="suggestion-item' + (index === state.search.activeIndex ? ' active' : '') + '" ' +
      'id="search-option-' + index + '" type="button" role="option" aria-selected="' + (index === state.search.activeIndex) + '" ' +
      'onclick="chooseSearchResult(' + index + ')">' +
      '<span><span class="suggestion-name">' + escapeHtml(result.name || result.code) + '</span>' +
      '<span class="suggestion-code">' + escapeHtml(result.code || 'Không có mã') + '</span></span>' +
      (showSource ? '<span class="suggestion-source">' + escapeHtml(result.sourceLabel) + '</span>' : '') +
      '</button>';
  }).join('');
  suggestions.classList.add('show');
  document.getElementById('dashboardSearchInput').setAttribute('aria-expanded', 'true');
}
```

## Repo conventions to follow

- The codebase already has exactly this "off-state via CSS + toggled `.show` class" pattern for
  another overlay — `.loading-veil` / `.loading-veil.show` (`server/public/index.html:500-506`
  and `:2701`, `document.getElementById('veil').classList.toggle('show', isLoading)`). Mirror
  that pattern's shape (base rule holds the closed/transparent state and the transition
  declaration; `.show` holds the open state) rather than inventing a different one.
- Use the `--ease-out` token from plan 002 (`server/public/index.html`, added to `:root`) —
  don't hand-type a bare `ease` or a new cubic-bezier.
- Keep the existing `[hidden]{ display:none !important; }` global rule
  (`server/public/index.html:172`) untouched — the `hidden` attribute is still used correctly
  elsewhere in the file (e.g. `.chart-empty`, `#chartOverviewPurchases`) and is not part of this
  plan's scope.

## Steps

1. Remove the `hidden` attribute from the markup so the element can be shown/hidden by class
   instead (`server/public/index.html:646`):
   ```html
   <div class="suggestions" id="searchSuggestions" role="listbox"></div>
   ```

2. Replace the `.suggestions` rule (`server/public/index.html:235-239`) with the target CSS
   above, and add the adjacent `.suggestions.show` rule right after it.

3. In `hideSearchSuggestions()` (`server/public/index.html:1591-1599`), replace
   `suggestions.hidden = true;` with `suggestions.classList.remove('show');`. Leave
   `suggestions.innerHTML = '';` in place — clearing the (now invisible, `opacity:0`,
   `pointer-events:none`) content immediately is fine since it's not visible anyway.

4. In `renderSuggestions()` (`server/public/index.html:1645-1666`), replace both occurrences:
   - `suggestions.hidden = true;` (empty-results early return) → `suggestions.classList.remove('show');`
   - `suggestions.hidden = false;` (has results) → `suggestions.classList.add('show');`

## Boundaries

- Do NOT change `renderSuggestions()`'s HTML-building logic (the `.map(...)` call) — only the
  show/hide lines.
- Do NOT touch any other element that uses the `hidden` attribute elsewhere in the file (e.g.
  `#searchResult`, `#searchClearBtn`, `.filter-group[hidden]`) — this plan is scoped to
  `#searchSuggestions` only.
- If plan 002 has not been applied yet and `--ease-out` doesn't exist in `:root`, either apply
  plan 002 first, or (if told to proceed standalone) add just that one token
  (`--ease-out:cubic-bezier(0.23, 1, 0.32, 1);`) to `:root` as part of this plan instead of
  leaving `var(--ease-out)` dangling.
- If the cited line numbers or code no longer match what you find in the file (drift since
  commit `064d49e`), STOP and report instead of improvising.

## Verification

- **Mechanical**: open `server/public/index.html` in a browser, open DevTools console — confirm
  no errors when typing in the dashboard search box.
- **Feel check**:
  - Type into the search box until suggestions appear — the dropdown should scale up and fade
    in from the top edge (near the input), not snap into place.
  - Clear the input / press Escape / click elsewhere — the dropdown should fade and shrink back
    out, not vanish instantly.
  - Type quickly, backspace, retype — rapidly toggling suggestions must not glitch, flash, or
    get stuck partially open (since this uses a CSS `transition`, not `@keyframes`, it retargets
    smoothly mid-motion — confirm this by watching closely while typing fast).
  - Confirm keyboard navigation (↑ / ↓ through suggestions, Enter to choose) still works — the
    only thing that changed is visibility mechanics, not the list itself.
  - In DevTools → Animations panel, set playback to 10% and confirm the dropdown's
    `transform-origin` is the top edge (scales from the input, not from its own center).
- **Done when**: the suggestions dropdown fades/scales in and out from its trigger within
  150–250ms, keyboard/mouse interaction with suggestions is unchanged, and no other `hidden`
  usage in the file was touched.
