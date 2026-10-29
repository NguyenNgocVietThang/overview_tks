# Print columns implementation plan

**Goal:** Implement the print changes approved in chat on 29/10/2026.

**Architecture:** Keep the existing vanilla JavaScript print renderer and shared layout API. Store goods settings in the existing fields and additional table settings under a bounded `tables` map. Match Kiot user mobilePhone by seller ID and retailer.

**Tech stack:** Node.js, PostgreSQL JSONB, vanilla DOM, node:test/JSDOM and Edge/Playwright.

- [x] Reproduce delivery layout rejection: six rendered columns versus seven validated columns; fix and add regression test.
- [x] Render escaped Telegram ID in strong text at name size +1pt in both templates.
- [x] Read Kiot `/users` mobilePhone by seller ID and physical branch, with cache/single-flight and bounded requests; keep new contact in snapshot and supplement old print responses.
- [x] Use white-border footer tables with colgroups; resize and format columns independently, preserving header/body separation and legacy settings.
- [x] Extend strict shared-layout validation for footer tables and per-column size.
- [x] Verify server persistence, reopen, reset, exported HTML and A4 output with simulated data.
- [ ] Record final related-suite results and full-suite limitations in CURRENT.md.

No migration or deployment required for these source changes. Apply through the existing deployment workflow after review.
