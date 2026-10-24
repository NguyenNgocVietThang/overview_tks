# GitHub Actions Daily Project Digest

## Goal

Produce a daily, no-API summary of recent project activity for the public `tks0101ai-cmyk/tks_web` repository. The workflow must run without the developer's computer being on and must not change repository content.

## Schedule and trigger

- Run daily at 05:00 in `Asia/Ho_Chi_Minh` using GitHub Actions' timezone-aware schedule.
- Include `workflow_dispatch` for a manual run.
- GitHub scheduled workflows run from the repository's default branch. A busy Actions queue can delay a run, so 05:00 is the requested schedule time rather than a guaranteed completion time.

## Activity and output

- Read commits and pull requests from the preceding 24 hours using the workflow's `GITHUB_TOKEN`.
- Use read-only permissions for repository contents and pull requests.
- Group activity by change type using commit and PR titles/descriptions, and link each item to GitHub.
- If there was no activity, say so clearly.
- Write the Markdown digest to the workflow run's `GITHUB_STEP_SUMMARY`; do not create issues, commits, or artifacts.
- Include the run date and the 24-hour reporting window.

## Cost and dependencies

- Do not call the OpenAI API or require `OPENAI_API_KEY`.
- Use GitHub-hosted standard runners; the repository is public.
- Avoid installing Python or project dependencies; use GitHub's built-in token and workflow runtime.

## Limits

- This is a deterministic digest of GitHub metadata, not an AI interpretation of source-code diffs.
- The report is available on the GitHub Actions run page. GitHub may delay scheduled jobs during high load, and scheduled workflows in inactive public repositories can be disabled.
