(function () {
  'use strict';
  const doc = document;
  const selector = 'input[type="search"], .search-box input, input[data-search-input]';
  const controls = new WeakMap();

  function sync(input) {
    const button = controls.get(input);
    if (!button) return;
    const hidden = !input.value || input.disabled || input.readOnly;
    if (button.hidden !== hidden) button.hidden = hidden;
  }

  function enhance(input) {
    if (controls.has(input)) { sync(input); return; }
    let wrap = input.parentElement;
    let button = wrap.querySelector('.search-clear, .table-search-clear, [data-search-clear]');
    if (!button && !wrap.matches('.search-box, .table-search-input-wrap, .dd-search-wrap, .locations-search, .tks-search-wrap')) {
      wrap = doc.createElement('span');
      wrap.className = 'tks-search-wrap';
      input.before(wrap);
      wrap.appendChild(input);
    }
    wrap.classList.add('tks-search-container');
    input.classList.add('tks-search-input');
    if (!button) {
      button = doc.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Xóa tìm kiếm');
      wrap.appendChild(button);
      button.addEventListener('click', function () {
        if (input.disabled || input.readOnly) return;
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (input.hasAttribute('data-search-submit-on-clear') && input.form) input.form.requestSubmit();
        input.focus({ preventScroll: true });
        sync(input);
      });
    }
    button.classList.add('tks-search-clear');
    button.textContent = '×';
    button.title = 'Xóa tìm kiếm';
    controls.set(input, button);
    input.addEventListener('input', function () { sync(input); });
    input.addEventListener('focus', function () { sync(input); });
    // Keep existing clear handlers (autocomplete selection, table state, debounced requests).
    button.addEventListener('click', function () { sync(input); });
    sync(input);
  }

  function refresh() {
    doc.querySelectorAll(selector).forEach(enhance);
  }

  function init() {
    refresh();
    // Marketing tables and dropdown searches are mounted after the page has loaded.
    new MutationObserver(refresh).observe(doc.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['disabled', 'readonly']
    });
    doc.addEventListener('reset', function () { queueMicrotask(refresh); });
  }

  window.TKSSearchClear = { refresh, sync };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
