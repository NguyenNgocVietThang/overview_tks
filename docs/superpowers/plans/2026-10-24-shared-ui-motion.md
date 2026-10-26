# Shared UI motion implementation plan

**Goal:** Add the approved dashboard entrance effects throughout the existing website.

**Approved scope:** The user approved the 3-second reference, then clarified that backgrounds, table structure, layout, colors, content and existing behavior must all remain unchanged. Only motion is authorized. No theme redesign or background changes.

**Architecture:** One progressive-enhancement script, `server/public/shared/motion.js`, loaded with `defer` by every HTML entrypoint. Native Web Animations API animates existing elements on their first visible appearance. No dependencies, API changes or migrations.

- [x] Audit HTML entrypoints, existing backgrounds and shared styles; discard initial theme changes following user clarification.
- [x] Implement letter bounce (40 ms stagger), subtitle fade, KPI flip (150 ms stagger), safe visual count-up, panel reveal and bounded table-row staggering.
- [x] Integrate all pages, including auth/error pages and the Telegram miniapp, without changing layout or styling.
- [x] Verify reduced-motion, unchanged accessible financial text, no repeated animation during data refresh, and progressive enhancement when browser APIs are absent.
- [x] Run frontend tests and desktop/mobile browser checks; compare final geometry and backgrounds with motion disabled.
- [x] Update shared-script documentation and the design-system rule for the explicitly approved, temporary KPI entrance flip.

**Performance constraints:** No persistent 3D layers, per-row blur, background effects, or global hiding styles. Animate a bounded number of visible rows once per table, preserve sorting/filtering/pagination and cancel animations when reduced motion is requested. Existing global performance guards remain in force; the sole approved exception is a temporary WAAPI KPI flip, cleaned up on completion.

**Verification (24/10/2026):** Frontend suites plus motion and Telegram UI tests: 860 passed, 0 failed. Dedicated integration/motion checks: 9 passed. `npm run build` passed (Express has no compilation step). Chrome preview with isolated fixture data checked 13 entrypoints and reduced motion; compared 1680px and 390px layouts with/without motion: final backgrounds, KPI geometry, column labels and numeric source text identical, no page overflow and no JavaScript errors. Refreshing table data did not replay row animations. These are local checks; no production deployment performed.
