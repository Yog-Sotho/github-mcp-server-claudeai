import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { githubFetch, GithubApiError, truncate } from "../services/github.js";
import { CHARACTER_LIMIT, DEFAULT_PER_PAGE, MAX_PER_PAGE } from "../constants.js";
import type { GithubBranch, GithubCommit, BranchSummary, CommitSummary } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseBranch(b: GithubBranch): BranchSummary {
  return { name: b.name, sha: b.commit.sha, protected: b.protected };
}

function normaliseCommit(c: GithubCommit): CommitSummary {
  return {
    sha:       c.sha,
    short_sha: c.sha.slice(0, 7),
    author:    c.commit.author.name,
    date:      c.commit.author.date.split("T")[0],
    message:   c.commit.message.split("\n")[0], // first line only
    url:       c.html_url,
    parents:   c.parents.length,
  };
}

function formatBranchMarkdown(b: BranchSummary): string {
  return `- \`${b.name}\` — ${b.sha.slice(0, 7)}${b.protected ? " 🔒 protected" : ""}`;
}

function formatCommitMarkdown(c: CommitSummary, index: number): string {
  return `${index + 1}. \`${c.short_sha}\` **${c.message}**\n   ${c.author} · ${c.date} · ${c.url}`;
}

// ---------------------------------------------------------------------------
// Tool: github_list_branches
// ---------------------------------------------------------------------------

export function registerListBranches(server: McpServer): void {
  server.registerTool(
    "github_list_branches",
    {
      title: "List Branches",
      description: `List branches in a public GitHub repository.

Args:
  - owner      (string): Repository owner (user or org)
  - repo       (string): Repository name
  - per_page   (number): Results per page, 1–100 (default: 30)
  - page       (number): Page number starting at 1 (default: 1)

Returns: branch names, tip commit SHAs, and protection status.

Examples:
  - "List branches in facebook/react" → owner="facebook", repo="react"
  - "How many branches does vercel/next.js have?" → owner="vercel", repo="next.js"`,
      inputSchema: z.object({
        owner:    z.string().min(1).describe("Repository owner"),
        repo:     z.string().min(1).describe("Repository name"),
        per_page: z.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
        page:     z.number().int().min(1).default(1),
      }).strict(),
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   false,
      },
    },
    async ({ owner, repo, per_page, page }) => {
      try {
        const branches = await githubFetch<GithubBranch[]>(`/repos/${owner}/${repo}/branches`, {
          params: { per_page, page },
        });

        if (branches.length === 0) {
          const msg = page > 1
            ? `No branches found on page ${page} for ${owner}/${repo}.`
            : `No branches found in ${owner}/${repo}.`;
          return { content: [{ type: "text" as const, text: msg }] };
        }

        const summaries = branches.map(normaliseBranch);
        const markdown = [
          `## Branches in ${owner}/${repo} (page ${page}, ${branches.length} results)`,
          "",
          summaries.map(formatBranchMarkdown).join("\n"),
          "",
          `To read files on a branch, use \`github_get_file\` with \`ref=<branch_name>\`.`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: truncate(markdown, CHARACTER_LIMIT) }],
          structuredContent: { owner, repo, page, per_page, count: summaries.length, branches: summaries },
        };
      } catch (err) {
        if (err instanceof GithubApiError) {
          return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
        }
        throw err;
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Tool: github_list_commits
// ---------------------------------------------------------------------------

export function registerListCommits(server: McpServer): void {
  server.registerTool(
    "github_list_commits",
    {
      title: "List Commits",
      description: `List commits in a public GitHub repository, optionally filtered by branch, path, or author.

Args:
  - owner      (string):  Repository owner
  - repo       (string):  Repository name
  - sha        (string):  Branch name, tag, or commit SHA to start from (default: repo default branch)
  - path       (string):  Only return commits touching this file or directory path (optional)
  - author     (string):  Filter by author GitHub username or email (optional)
  - since      (string):  ISO 8601 date — only commits after this date, e.g. "2024-01-01T00:00:00Z" (optional)
  - until      (string):  ISO 8601 date — only commits before this date (optional)
  - per_page   (number):  Results per page, 1–100 (default: 30)
  - page       (number):  Page number starting at 1 (default: 1)

Returns: commit SHAs (short + full), author, date, first line of message, GitHub URL.

Examples:
  - "Show recent commits on main branch of pytorch/pytorch" → owner="pytorch", repo="pytorch", sha="main"
  - "Who committed to src/index.ts recently?" → path="src/index.ts"
  - "Commits by defunkt since 2023" → author="defunkt", since="2023-01-01T00:00:00Z"`,
      inputSchema: z.object({
        owner:    z.string().min(1).describe("Repository owner"),
        repo:     z.string().min(1).describe("Repository name"),
        sha:      z.string().optional().describe("Branch, tag, or commit SHA (defaults to default branch)"),
        path:     z.string().optional().describe("Filter to commits touching this file/directory"),
        author:   z.string().optional().describe("Filter by GitHub username or email"),
        since:    z.string().optional().describe("ISO 8601 date — commits after this date"),
        until:    z.string().optional().describe("ISO 8601 date — commits before this date"),
        per_page: z.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
        page:     z.number().int().min(1).default(1),
      }).strict(),
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   false,
      },
    },
    async ({ owner, repo, sha, path, author, since, until, per_page, page }) => {
      try {
        const commits = await githubFetch<GithubCommit[]>(`/repos/${owner}/${repo}/commits`, {
          params: { sha, path, author, since, until, per_page, page },
        });

        if (commits.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No commits found in ${owner}/${repo} with the given filters.`,
            }],
          };
        }

        const summaries = commits.map(normaliseCommit);

        const filterDesc = [
          sha    ? `branch/ref: \`${sha}\`` : null,
          path   ? `path: \`${path}\`` : null,
          author ? `author: ${author}` : null,
          since  ? `since: ${since.split("T")[0]}` : null,
          until  ? `until: ${until.split("T")[0]}` : null,
        ].filter(Boolean).join(", ");

        const markdown = [
          `## Commits in ${owner}/${repo} (page ${page}, ${commits.length} results)`,
          filterDesc ? `Filters: ${filterDesc}` : "",
          "",
          summaries.map(formatCommitMarkdown).join("\n\n"),
        ].filter(Boolean).join("\n");

        return {
          content: [{ type: "text" as const, text: truncate(markdown, CHARACTER_LIMIT) }],
          structuredContent: { owner, repo, page, per_page, count: summaries.length, commits: summaries },
        };
      } catch (err) {
        if (err instanceof GithubApiError) {
          return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
        }
        throw err;
      }
    },
  );
}
