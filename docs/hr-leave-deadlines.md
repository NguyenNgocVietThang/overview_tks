# Leave registration deadlines

Implementation uses Vietnam calendar dates, including weekends and holidays, for every leave type. Approval (`Chưa duyệt`, `Đã duyệt`, `Từ chối`) and registration timing (`Đúng hạn`, `Xin muộn`, `Vi phạm`) are independent. Managers may approve any timing classification. Existing reason and handover fields keep their existing validation; no additional explanation or penalty is imposed.

## Rule

The server sorts actual selected sessions. Two or fewer sessions use the first date minus two calendar days; three or more use minus three days. The deadline includes its entire last minute, including fractions of a second: its exclusive boundary is the following Vietnam midnight. Submission at or after the first scheduled session start is `Vi phạm`; otherwise submission at or after the exclusive deadline is `Xin muộn`; earlier submission is `Đúng hạn`.

The first selected session start comes from a per-employee, per-date work schedule. There are no default session hours. Only the first selected session's start must be configured. An absent row or a null start for that session prevents submission and tells the employee to ask a manager to configure it. An account without an active employee link also needs that link before submitting. Previewing a form never creates a request or a submission revision.

## Storage and compatibility

Migration `0038_hr_leave_deadlines.sql` adds `hr_leave_work_schedules`, authoritative snapshot columns on `hr_leave_requests`, and immutable `hr_leave_submissions`. No existing row is updated by this migration, and no existing manager event is backfilled. Old rows return timing `null`, revision `0`, and their existing range. The frontend displays those as unclassified; it never invents historical work hours.

`hr_leave_00_submission` runs before the existing department and decision-version triggers. On insertion or an edited calendar it canonicalizes the selected sessions, sets the server timestamp with `clock_timestamp()`, reads the first session's work schedule, computes timing, and sets the submission revision. Client-supplied timing, timestamp, revision, deadline and schedule snapshots are overwritten. On ordinary approval or notifier marker updates the prior snapshot is preserved.

`hr_leave_submission_history` writes the resulting calendar, count, schedule start/version, timing, submission timestamp, reason and handover inside the same SQL statement transaction. Direct insertion/modification/deletion of history is blocked; deleting a request with history is restricted by its foreign key. Changes to work schedules do not change submitted requests or their history.

Resubmission uses a server-generated `submission_nonce` UUID to signal intent, allowing a reason/handover resend with the same calendar. It resets approval, approver, decision time, approval notes and employee notification marker, and advances `decision_version` once. Existing Telegram cards and rejection sessions consequently fail their old optimistic version. Current employee identity, active account/employee, ownership, source and expected version are checked by the atomic repository update. A changed employee link or branch cannot silently repurpose an old request. Missing schedule errors roll back both the request and history.

Before migration, old rows had no stored historical work schedule. No revision is reconstructed for them. Their first explicit calendar resend starts authoritative history at revision 1.

New manual absence records also require a selected active employee (or a linked web username), an allowed physical branch, and the first session's work schedule. Their existing preapproved recording behavior is preserved; timing is independently classified. Editable names never select an employee identity.

## API

Calendar bodies retain `start_date`, `start_session`, `end_date`, `end_session`. Optional `leave_sessions` contains `{date:'YYYY-MM-DD', session:'Sáng'|'Chiều'}` and represents actual, possibly noncontiguous selections. Duplicates and empty lists are rejected. Without it, the inclusive range is expanded. Stored start/end values are the selected calendar's bounds.

- `POST /api/hr/leave-requests/self/preview` takes a calendar and returns `totalSessions`, `deadlineDate`, `deadlineExclusiveAt`, `firstSessionStartAt`, `scheduleVersion`, `timingStatus`. Reason is optional for preview. The result is advisory; submission recomputes against the database clock and current schedule.
- `POST /api/hr/leave-requests/self/:id/resubmit` requires calendar, existing reason/handover fields and `expectedVersion`. Only an eligible owner of a web leave request can resend it. Stale versions return HTTP 409.
- `GET /api/hr/leave-requests/:id/history` returns `{submissions:[...]}`, newest first, under the same own-request or HR-viewer branch visibility check as detail. Self-only users cannot read another employee's detail or history.
- `GET /api/hr/leave-work-schedules/:employeeId?date=YYYY-MM-DD` returns `{schedule:null}` for an unconfigured date.
- `PUT /api/hr/leave-work-schedules/:employeeId` takes `{date,morningStart:'HH:mm'|null,afternoonStart:'HH:mm'|null}`. Both fields may be null. The database increments version on every write. Both schedule endpoints require current `hr.leave.manage`, department and assigned branch scope. Fallback approval routing does not grant schedule configuration access.
- `GET /api/hr/employees` additionally returns a stable string `id`, used to select schedule and manual absence employees.

List/detail responses add `leave_sessions`, `timing_status`, `registration_deadline_date`, `registration_deadline_exclusive_at`, `first_session_start_at`, `schedule_version`, `submission_revision` and a server-computed `canEdit`. Existing fields remain. `source` and `schedule_start` are additive diagnostic snapshot fields. New approval writes reject `Vi phạm` as an approval status; that enum remains available for legacy reads.

Manager Telegram messages, MiniApp context and Excel export carry registration timing separately from approval. SSE and the existing durable database manager-event trigger continue to publish calendar resubmission changes.

## External employee bot

The external bot can still insert its existing range columns. It must also provide a trusted employee FK, a linked active account, or an active Telegram account link resolving to an employee. The employee's branch must agree with the request branch. The first session's date/hour must be configured before insertion. Failure aborts insertion with `LEAVE_SCHEDULE_REQUIRED` or `LEAVE_IDENTITY_MISMATCH`; bot operators should present the configuration error to the employee rather than repeatedly retrying unchanged data.

The database owns submission time and timing. The bot should omit supplied snapshots and create leave requests as pending; an old insert containing approval `Vi phạm` is normalized to pending with the independent timing label. Updating just date/session range columns regenerates stored selected sessions. Updating `leave_sessions` recomputes the bound range. Both paths create a fresh submission, reset approval and invalidate old Telegram decisions. Updating normal approval or `decision_notified_at` keeps the snapshot. `decision_notified_at` retains the existing employee result-notifier contract from migrations 0016/0029.

## Rollout sequence (requires separate production authorization)

1. Back up the database and coordinate the external bot's configuration-error handling and identity fields.
2. Apply migrations through 0038 before running this web version; the repository selects the new columns immediately.
3. Configure relevant per-date employee schedules through authorized managers. A date is deliberately unconfigured until its session starts are entered.
4. Deploy the web/backend and verify a configured test employee can preview, submit, approve and resend. Confirm history and stale-card rejection.

No production database, migration, credentials, deployment or outbound notifications were used during implementation. Tests use isolated PGlite and synthetic environment values.

## Verification

Pure JavaScript and actual SQL tests cover short/long deadlines, noncontiguous sessions, last-deadline-minute fractions, midnight, before/equal/after first start, weekend/month/year/leap transitions, missing configuration rollback, forged snapshots, linked Telegram identity, immutable revisions, ordinary approvals and schedule changes, same-calendar resend, stale versions and changed linkage. Route tests verify self-only visibility and fresh schedule approval scope. Inherited Telegram inbox, decisions, notifier markers and end-to-end workflow tests run with migration-aware fixtures; real HTTP MiniApp tests remain intact.
