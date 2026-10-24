# GitHub Actions Daily Project Digest Implementation Plan

> **For agentic workers:** Execute inline in the current workspace. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate a free daily GitHub Actions digest of recent repository commits and pull requests at 05:00 Asia/Ho_Chi_Minh.

**Architecture:** A scheduled, manually dispatchable workflow checks out the default branch and runs a dependency-free Node script. The script uses the workflow `GITHUB_TOKEN` with read-only repository and pull request permissions and appends a deterministic Markdown summary to `GITHUB_STEP_SUMMARY`.

**Tech Stack:** GitHub Actions YAML, Node.js built-in `fetch`, GitHub REST API.

## Global Constraints

- Run daily at 05:00 in `Asia/Ho_Chi_Minh` and allow `workflow_dispatch`.
- Include GitHub commits and pull request activity from the prior 24 hours.
- Use only read permissions for contents and pull requests.
- Do not use the OpenAI API, require secrets, or install dependencies.
- Write only to the Actions run summary; do not mutate the repository during a run.
- Clearly report when there is no recent activity and state the 24-hour window.

---

### Task 1: Build the no-API activity digest

**Files:**
- Create: `.github/scripts/daily-project-digest.mjs`

**Interfaces:**
- Consumes: `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_API_URL`, `GITHUB_STEP_SUMMARY`.
- Produces: a Markdown summary in `GITHUB_STEP_SUMMARY`.

- [ ] Implement pagination for commits filtered by `since` and PRs sorted by most recently updated.
- [ ] Filter both sources to the prior 24 hours; group records by conventional title prefixes and include links, author/status, and a short PR description.
- [ ] Format the report date and reporting window in `Asia/Ho_Chi_Minh`; emit a clear empty-state message.
- [ ] Keep the script dependency-free and avoid logging credentials.

### Task 2: Schedule, verify, commit, and activate

**Files:**
- Create: `.github/workflows/daily-project-digest.yml`

**Interfaces:**
- Consumes: script from Task 1 and GitHub-provided workflow token.
- Produces: daily 05:00 schedule, manual dispatch, and Actions run summary.

- [ ] Add timezone-aware schedule and manual trigger with minimal read-only permissions.
- [ ] Run the digest script after checkout with only required environment variables.
- [ ] Review the diff, check whitespace and workflow structure without adding or running tests.
- [ ] Commit only plan/spec/workflow/script files; leave pre-existing `server/public` changes untouched.
- [ ] Push the approved workflow to `tks_web/main` so GitHub activates the schedule.
