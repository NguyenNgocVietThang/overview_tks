# Position import review implementation plan

**Goal:** Edit imported position rows during preview, prioritize warnings, and search/filter the entire draft.

**Approved design:** Keep the existing modal. Add/edit/remove draft input rows without writing stock data. Recompute normalized operations and warnings on the server after each saved edit. Block confirmation while editing, busy, stale, or erroneous. Search code/name/notes/location and combine warning and operation filters. Preserve both branch scope and transactional validation.

**Architecture:** Return full raw input rows plus normalized preview operations linked by source indexes. Edits always target original input, never the result of additive merging. Send edited input as a multipart JSON field through the existing authorized import route. The service whitelists fields and replans on every preview/commit. Page preview results locally to keep large imports usable.

**Tech stack:** Existing vanilla JS/CSS/HTML, Express/multer, carton helpers, node:test/JSDOM/PGlite. No new dependency or migration. Work directly on main at user's explicit request.

- [x] Add failing service tests: invalid/skipped/unchanged rows remain editable, all rows beyond 300 survive, merged source indexes, draft validation, commit exact edits with existing stock added once.
- [x] Extend import service and multipart route, preserving existing authorization and transaction boundaries.
- [x] Add failing UI tests for warning priority, combined search/filter, add/edit/remove and submitted draft, blocked errors and failed refresh recovery.
- [x] Extend modal controls, inline draft editor, paging, busy state and retry; preserve original draft on failure.
- [x] Run focused tests, browser visual checks in light/dark/mobile, full unit suite, review diff and update affected documentation/CURRENT.md and graphify.

**Review:** Source input and normalized output stay distinct; deleting a draft group removes its source inputs; keeping a planned deletion adds that existing row to the replace draft. No database writes occur until confirmation. Generated preview status/warnings are never trusted from the browser.
