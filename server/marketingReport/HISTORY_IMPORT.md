# Marketing history import

Updated: 2026-10-09. This importer prepares immutable source history for migration 0044. It does not activate a report source, change revenue providers, or write Sheets.

```powershell
node server/scripts/capture-marketing-history.js --output PRIVATE_NEW_SNAPSHOT.json
node server/scripts/import-marketing-history.js --input PRIVATE_SNAPSHOT.json --year 2026 --dry-run --report-file SAFE_RECONCILIATION.json
node server/scripts/import-marketing-history.js --input PRIVATE_SNAPSHOT.json --year 2026 --apply --actor-id MANAGER_ACCOUNT_ID --report-file SAFE_RECONCILIATION.json
```

Capture uses the existing readonly Sheets client, fixed approved workbook IDs, six THÔ/CHUẨN tabs, Tên, BC tháng and CHECK tabs. The output contains private source cells; keep it outside tracked files. Capture never overwrites an existing file. Import defaults to dry-run and lazily loads database configuration only for deliberate `--apply`. `--year` is required even when the source capture is dated. Apply requires a numeric audit actor ID. Reports and CLI errors contain totals, field names and source row references rather than employee/customer names or phones.

`prepareHistoryImport(snapshot, {year})` in `marketingHistoryImport.js` returns `{batches, summary}`. The phone workbook batch contains all phone-bearing historical rows; the report workbook batch contains monthly rows and aliases. Their stable keys hash complete intended content and the explicit year, excluding capture time. Each batch commits through `repository.importHistory`; a failure in the second workbook can leave the first committed. Retry the identical complete input to replay the first batch and finish the second. Existing source identities are immutable; changed source cells require reconciliation rather than overwriting history.

Source arrays and row numbers preserve original values/types. Phone keys are exact source cell text: no trimming, leading-zero repair, numeric coercion of strings, multi-phone splitting or cross-page merging. Numeric/string cells with the same text use this explicit text policy; mixed types are listed in reconciliation for review. Missing employee or invalid/missing dates remain stored; credited dates use the explicit year, never import time. Created timestamps are Vietnam local time. Monthly report year/month comes from the tab, independent of closed date. Legacy June has no page or new-customer field and uses H for its note. Old revenue cells remain only in raw provenance; KiotViet remains the revenue provider.

`marketingAggregation.js` exports:

- `aggregatePhones(rawRows, aliases=[])`: groups page/phoneKey after sorting decimal stored `sourceOrder` using BigInt. It returns existing field names `firstEmployee/currentEmployee/repeatEmployee`, `firstAt/currentAt/repeatAt` as ISO dates or null, optional mapped fields, `firstRow`, `lastRow`, a source `trace` including `(origin,id)` and unresolved flags. Repeat identity compares raw employees before aliasing; repeat date compares credited dates independently. Each new observation can alter a historic month when the last row changes.
- `isPhoneReportObservation(row)`: marks embedded historical phone/created header rows ineligible for CHUAN phone counts. They stay in repository rawRows and reconciliation. Ordinary phone rows with invalid created timestamps remain countable. This follows the actual `UNIQUE(raw!T:T)` header semantics, not a timestamp filter.
- `countPhoneKpis(phones,{year,month,mapped=false})`: first/repeat counts by raw employee/page/credited month, optionally combines report employee groups after counting. Equivalent is `first + repeat/5`. Multi-name cells stay intact.
- `countMonthlyClosures(monthlyRows,{year,month})`: one count per report sale/page, using every manual BC row in that report month regardless of status or closed date. This matches the verified CHECK COUNTIFS formula. Rate uses this numerator once per mapped sale/page divided by total mapped equivalent; zero denominator is null. Never sum the repeated numerator printed on multiple raw aliases.

Reconciliation compares all seven CHUAN fields and source keys, CHECK first/repeat/equivalent, BC closed counts and grouped rates. It flags header months, duplicate CHECK raw/page rows, alias differences and formula inconsistencies. CHECK values from older copied months can differ from recomputed current first/last history; do not claim all CHECK tabs reconcile. Broad product documentation/source activation belongs to the integration task.
