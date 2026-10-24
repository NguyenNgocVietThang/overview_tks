import { appendFile } from "node:fs/promises";

const timeZone = "Asia/Ho_Chi_Minh";
const windowEnd = new Date();
const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const apiBase = process.env.GITHUB_API_URL;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!token || !repository || !apiBase || !summaryPath) {
  throw new Error("Required GitHub Actions environment variables are missing.");
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error("GITHUB_REPOSITORY must use the owner/name format.");
}

function apiUrl(path, params) {
  const base = apiBase.endsWith("/") ? apiBase : `${apiBase}/`;
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function fetchPage(path, params) {
  const response = await fetch(apiUrl(path, params), {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with HTTP ${response.status} for ${path}.`);
  }

  return response.json();
}

async function getRecentCommits() {
  const commits = [];
  const perPage = 100;

  for (let page = 1; ; page += 1) {
    const items = await fetchPage(`repos/${owner}/${repo}/commits`, {
      since: windowStart.toISOString(),
      per_page: String(perPage),
      page: String(page),
    });

    for (const item of items) {
      const timestamp = item.commit.committer?.date ?? item.commit.author?.date;
      if (timestamp && isInWindow(timestamp)) {
        commits.push({
          kind: "commit",
          title: item.commit.message.split("\n", 1)[0],
          url: `https://github.com/${owner}/${repo}/commit/${item.sha}`,
          actor: item.author?.login ?? item.commit.author?.name ?? "Unknown author",
          timestamp,
          sha: item.sha.slice(0, 7),
        });
      }
    }

    if (items.length < perPage) break;
  }

  return commits;
}

async function getRecentPullRequests() {
  const pullRequests = [];
  const perPage = 100;

  for (let page = 1; ; page += 1) {
    const items = await fetchPage(`repos/${owner}/${repo}/pulls`, {
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: String(perPage),
      page: String(page),
    });

    for (const item of items) {
      const event = getPullRequestEvent(item);
      if (event) {
        pullRequests.push({
          kind: "pull request",
          title: item.title,
          url: `https://github.com/${owner}/${repo}/pull/${item.number}`,
          actor: item.user?.login ?? "Unknown author",
          timestamp: event.timestamp,
          event: event.label,
          status: item.merged_at ? "merged" : item.state,
          description: item.body ?? "",
          number: item.number,
        });
      }
    }

    const oldestUpdate = items.at(-1)?.updated_at;
    if (
      items.length < perPage ||
      (oldestUpdate && new Date(oldestUpdate) < windowStart)
    ) {
      break;
    }
  }

  return pullRequests;
}

function isInWindow(timestamp) {
  const time = new Date(timestamp);
  return time >= windowStart && time <= windowEnd;
}

function getPullRequestEvent(item) {
  if (item.merged_at && isInWindow(item.merged_at)) {
    return { label: "merged", timestamp: item.merged_at };
  }
  if (item.closed_at && isInWindow(item.closed_at)) {
    return { label: "closed", timestamp: item.closed_at };
  }
  if (item.created_at && isInWindow(item.created_at)) {
    return { label: "opened", timestamp: item.created_at };
  }
  if (item.updated_at && isInWindow(item.updated_at)) {
    return { label: "updated", timestamp: item.updated_at };
  }
  return null;
}

const categoryRules = [
  { name: "Features", pattern: /^(feat|feature)(\([^)]*\))?!?:/i },
  { name: "Fixes", pattern: /^(fix|bugfix|hotfix)(\([^)]*\))?!?:/i },
  { name: "Documentation", pattern: /^(docs?|documentation)(\([^)]*\))?!?:/i },
  { name: "Refactoring", pattern: /^(refactor|perf)(\([^)]*\))?!?:/i },
  { name: "Maintenance", pattern: /^(chore|build|ci|test|style)(\([^)]*\))?!?:/i },
];

function categoryFor(title) {
  return categoryRules.find(({ pattern }) => pattern.test(title))?.name ?? "Other changes";
}

function escapeMarkdown(value) {
  return String(value).replace(/[\\`*_{}\[\]()#+.!|>]/g, "\\$&");
}

function cleanDescription(value) {
  return escapeMarkdown(value.replace(/\s+/g, " ").trim().slice(0, 240));
}

function formatLocal(timestamp) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function localDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderEntry(item) {
  const type = item.kind === "commit"
    ? `Commit \`${item.sha}\``
    : `PR #${item.number} ${item.event}${item.event === "updated" ? ` (${item.status})` : ""}`;
  const actor = item.kind === "pull request" ? `@${item.actor}` : item.actor;
  const description = item.description ? ` — ${cleanDescription(item.description)}` : "";
  return `- **${type}** [${escapeMarkdown(item.title)}](${item.url}) — ${escapeMarkdown(actor)} · ${formatLocal(item.timestamp)}${description}`;
}

const [commits, pullRequests] = await Promise.all([
  getRecentCommits(),
  getRecentPullRequests(),
]);
const activity = [...commits, ...pullRequests].sort(
  (left, right) => new Date(right.timestamp) - new Date(left.timestamp),
);

const lines = [
  `# Daily project digest — ${localDate(windowEnd)}`,
  "",
  `**Reporting window:** ${formatLocal(windowStart.toISOString())} – ${formatLocal(windowEnd.toISOString())} (Asia/Ho_Chi_Minh)`,
  `**Activity:** ${commits.length} commit(s), ${pullRequests.length} pull request(s)`,
  "",
];

if (activity.length === 0) {
  lines.push("No commit or pull request activity was found in the last 24 hours.");
} else {
  const categories = [...new Set(activity.map((item) => categoryFor(item.title)))];
  for (const category of categories) {
    lines.push(`## ${category}`, "");
    lines.push(...activity.filter((item) => categoryFor(item.title) === category).map(renderEntry));
    lines.push("");
  }
}

await appendFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
