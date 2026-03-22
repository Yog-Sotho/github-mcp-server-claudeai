import { GITHUB_API_BASE, REQUEST_TIMEOUT_MS } from "../constants.js";

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

interface FetchOptions {
  params?: Record<string, string | number | boolean | undefined>;
}

/** Construct a query string from a params object, omitting undefined values. */
function buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

/**
 * Fetch a GitHub API endpoint and return the parsed JSON body.
 * Throws a descriptive GithubApiError on any non-2xx response.
 */
export async function githubFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const url = `${GITHUB_API_BASE}${path}${buildQuery(options.params)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "github-mcp-server/1.0.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new GithubApiError(408, `Request timed out after ${REQUEST_TIMEOUT_MS}ms — ${url}`);
    }
    throw new GithubApiError(0, `Network error: ${String(err)}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json() as { message?: string; documentation_url?: string };
      detail = body.message ? ` — ${body.message}` : "";
    } catch {
      // ignore parse error
    }
    throw new GithubApiError(response.status, httpErrorMessage(response.status, url) + detail);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class GithubApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

/** Map HTTP status codes to human-readable guidance. */
function httpErrorMessage(status: number, url: string): string {
  switch (status) {
    case 301: return `Moved permanently — the repository may have been renamed or transferred (${url})`;
    case 403: return `Forbidden — the repository may be private or rate limit exceeded (${url})`;
    case 404: return `Not found — check the owner/repo names; private repos are not accessible without auth (${url})`;
    case 422: return `Validation failed — check query syntax (${url})`;
    case 451: return `Unavailable for legal reasons (${url})`;
    case 429: return `Rate limit exceeded — unauthenticated requests are limited to 60/hour; retry later (${url})`;
    default:  return `GitHub API error ${status} (${url})`;
  }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Truncate a string to at most maxLen characters, appending a notice. */
export function truncate(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  const notice = `\n\n[Truncated: response exceeded ${maxLen} characters. Use a more specific path or ref to retrieve less data.]`;
  return content.slice(0, maxLen - notice.length) + notice;
}

/** Decode a base64-encoded GitHub file content string. */
export function decodeBase64Content(encoded: string): string {
  // GitHub adds newlines every 60 chars — strip before decoding
  const clean = encoded.replace(/\n/g, "");
  return Buffer.from(clean, "base64").toString("utf-8");
}

/** Format a repo owner/name pair as "owner/repo" for error messages. */
export function repoPath(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
