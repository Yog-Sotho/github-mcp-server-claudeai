import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { githubFetch, GithubApiError, truncate } from "../services/github.js";
import { CHARACTER_LIMIT, DEFAULT_PER_PAGE, MAX_PER_PAGE } from "../constants.js";
import type {
  GithubRepo,
  GithubSearchReposResult,
  RepoSummary,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseRepo(r: GithubRepo): RepoSummary {
  return {
    full_name: r.full_name,
    description: r.description,
    url: r.html_url,
    stars: r.stargazers_count,
    forks: r.forks_count,
    open_issues: r.open_issues_count,
    language: r.language,
    topics: r.topics ?? [],
    default_branch: r.default_branch,
    updated_at: r.updated_at,
    archived: r.archived,
    fork: r.fork,
  };
}

function formatRepoMarkdown(r: RepoSummary, index: number): string {
  const tags = [
    r.language ? `lang:${r.language}` : null,
    r.archived ? "archived" : null,
    r.fork ? "fork" : null,
    ...r.topics.slice(0, 4),
  ].filter(Boolean).join(" · ");

  return [
    `### ${index + 1}. ${r.full_name}`,
    r.description ?? "_No description_",
    `⭐ ${r.stars.toLocaleString()}  🍴 ${r.forks.toLocaleString()}  🐛 ${r.open_issues.toLocaleString()}`,
    tags ? `Tags: ${tags}` : "",
    `Default branch: \`${r.default_branch}\`  ·  Updated: ${r.updated_at.split("T")[0]}`,
    `URL: ${r.url}`,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Tool: github_get_repo
// ---------------------------------------------------------------------------

export function registerGetRepo(server: McpServer): void {
  server.registerTool(
    "github_get_repo",
    {
      title: "Get Repository",
      description: `Fetch metadata for a single public GitHub repository by owner and name.

Returns: full_name, description, URL, star/fork/issue counts, language, topics,
default branch, size (KB), visibility, created/updated/pushed dates, archived and fork flags.

Args:
  - owner (string): GitHub username or organisation, e.g. "anthropics"
  - repo  (string): Repository name, e.g. "anthropic-cookbook"

Examples:
  - "Get info about anthropics/anthropic-cookbook" → owner="anthropics", repo="anthropic-cookbook"
  - "What language is langchain-ai/langchain written in?" → owner="langchain-ai", repo="langchain"

Error handling:
  - 404: repo doesn't exist or is private
  - 403: rate limit exceeded (60 req/hour unauthenticated)`,
      inputSchema: z.object({
        owner: z.string().min(1).describe("GitHub username or organisation"),
        repo:  z.string().min(1).describe("Repository name"),
      }).strict(),
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   true,
      },
    },
    async ({ owner, repo }) => {
      try {
        const data = await githubFetch<GithubRepo>(`/repos/${owner}/${repo}`);
        const summary = normaliseRepo(data);
        const structured = {
          ...summary,
          size_kb: data.size,
          visibility: data.visibility,
          created_at: data.created_at,
          pushed_at: data.pushed_at,
        };

        const text = [
          `# ${data.full_name}`,
          data.description ?? "_No description_",
          "",
          `⭐ Stars: ${data.stargazers_count.toLocaleString()}`,
          `🍴 Forks: ${data.forks_count.toLocaleString()}`,
          `🐛 Open issues: ${data.open_issues_count.toLocaleString()}`,
          `📦 Size: ${data.size.toLocaleString()} KB`,
          "",
          `Language:        ${data.language ?? "—"}`,
          `Default branch:  ${data.default_branch}`,
          `Visibility:      ${data.visibility}`,
          `Archived:        ${data.archived}`,
          `Fork:            ${data.fork}`,
          "",
          `Topics: ${data.topics?.length ? data.topics.join(", ") : "none"}`,
          `Homepage: ${data.homepage ?? "—"}`,
          "",
          `Created:  ${data.created_at.split("T")[0]}`,
          `Updated:  ${data.updated_at.split("T")[0]}`,
          `Pushed:   ${data.pushed_at.split("T")[0]}`,
          "",
          `URL: ${data.html_url}`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: truncate(text, CHARACTER_LIMIT) }],
          structuredContent: structured,
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
// Tool: github_list_user_repos
// ---------------------------------------------------------------------------

export function registerListUserRepos(server: McpServer): void {
  server.registerTool(
    "github_list_user_repos",
    {
      title: "List User / Org Repositories",
      description: `List public repositories for a GitHub user or organisation, sorted and paginated.

Args:
  - owner       (string):  GitHub username or org, e.g. "torvalds" or "microsoft"
  - type        (string):  Filter: "all" | "owner" | "member" | "forks" | "sources" (default: "owner")
  - sort        (string):  Sort by: "created" | "updated" | "pushed" | "full_name" (default: "updated")
  - direction   (string):  "asc" | "desc" (default: "desc")
  - per_page    (number):  Results per page, 1–100 (default: 30)
  - page        (number):  Page number, starting at 1 (default: 1)

Returns: list of repos with stars, forks, language, topics, last update, and URLs.

Examples:
  - "List Microsoft's top repos by stars" → owner="microsoft", sort="updated", per_page=10
  - "Show page 2 of torvalds repos" → owner="torvalds", page=2`,
      inputSchema: z.object({
        owner:     z.string().min(1).describe("GitHub username or organisation"),
        type:      z.enum(["all", "owner", "member", "forks", "sources"]).default("owner"),
        sort:      z.enum(["created", "updated", "pushed", "full_name"]).default("updated"),
        direction: z.enum(["asc", "desc"]).default("desc"),
        per_page:  z.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
        page:      z.number().int().min(1).default(1),
      }).strict(),
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   true,
      },
    },
    async ({ owner, type, sort, direction, per_page, page }) => {
      try {
        const repos = await githubFetch<GithubRepo[]>(`/users/${owner}/repos`, {
          params: { type, sort, direction, per_page, page },
        });

        if (repos.length === 0) {
          const msg = page > 1
            ? `No repositories found on page ${page} for "${owner}". Try a lower page number.`
            : `No public repositories found for "${owner}".`;
          return { content: [{ type: "text" as const, text: msg }] };
        }

        const summaries = repos.map(normaliseRepo);
        const markdown = [
          `## Public repositories for ${owner} (page ${page}, ${repos.length} results)`,
          `Sorted by: ${sort} ${direction}`,
          "",
          summaries.map(formatRepoMarkdown).join("\n\n---\n\n"),
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: truncate(markdown, CHARACTER_LIMIT) }],
          structuredContent: { owner, page, per_page, count: summaries.length, repos: summaries },
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
// Tool: github_search_repos
// ---------------------------------------------------------------------------

export function registerSearchRepos(server: McpServer): void {
  server.registerTool(
    "github_search_repos",
    {
      title: "Search Repositories",
      description: `Search public GitHub repositories using GitHub's search syntax.

Args:
  - query      (string): GitHub search query. Supports qualifiers:
      · language:python  → filter by language
      · stars:>1000      → minimum star count
      · topic:machine-learning → topic tag
      · user:owner       → repos owned by user
      · org:orgname      → repos in organisation
      · in:name          → search in repo name
      · in:description   → search in description
      · in:readme        → search in README
      · is:archived      → include only archived
      · NOT is:fork      → exclude forks
    Multiple qualifiers can be combined, e.g.:
    "llm fine-tuning language:python stars:>500 NOT is:fork"
  - sort      (string): "stars" | "forks" | "updated" | "help-wanted-issues" (default: "stars")
  - order     (string): "desc" | "asc" (default: "desc")
  - per_page  (number): 1–100 (default: 30)
  - page      (number): starting at 1 (default: 1)

Returns: matching repos with star/fork counts, language, topics, URLs, and total_count.

Examples:
  - "Find Python repos about RAG with 500+ stars" → query="RAG language:python stars:>500"
  - "Search for TypeScript MCP servers" → query="mcp server language:typescript"`,
      inputSchema: z.object({
        query:    z.string().min(1).describe("GitHub search query with optional qualifiers"),
        sort:     z.enum(["stars", "forks", "updated", "help-wanted-issues"]).default("stars"),
        order:    z.enum(["desc", "asc"]).default("desc"),
        per_page: z.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
        page:     z.number().int().min(1).default(1),
      }).strict(),
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   true,
      },
    },
    async ({ query, sort, order, per_page, page }) => {
      try {
        const result = await githubFetch<GithubSearchReposResult>("/search/repositories", {
          params: { q: query, sort, order, per_page, page },
        });

        if (result.items.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No repositories found for query: "${query}"\n\nTip: try broader terms or different qualifiers.`,
            }],
          };
        }

        const summaries = result.items.map(normaliseRepo);
        const markdown = [
          `## Search results for: \`${query}\``,
          `Found ${result.total_count.toLocaleString()} total results — showing ${summaries.length} (page ${page})`,
          result.incomplete_results ? "⚠️ Results may be incomplete (GitHub search timeout)" : "",
          "",
          summaries.map(formatRepoMarkdown).join("\n\n---\n\n"),
        ].filter(Boolean).join("\n");

        return {
          content: [{ type: "text" as const, text: truncate(markdown, CHARACTER_LIMIT) }],
          structuredContent: {
            query, sort, order, page, per_page,
            total_count: result.total_count,
            incomplete_results: result.incomplete_results,
            repos: summaries,
          },
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
