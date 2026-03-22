import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  githubFetch,
  GithubApiError,
  truncate,
  decodeBase64Content,
} from "../services/github.js";
import { CHARACTER_LIMIT } from "../constants.js";
import type { GithubFileContent, GithubTree, FileSummary } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDirMarkdown(owner: string, repo: string, path: string, items: FileSummary[]): string {
  const dirs  = items.filter(i => i.type === "dir");
  const files = items.filter(i => i.type === "file");
  const other = items.filter(i => i.type !== "dir" && i.type !== "file");

  const fmt = (i: FileSummary) => {
    const icon = i.type === "dir" ? "📁" : i.type === "symlink" ? "🔗" : "📄";
    const size = i.size_bytes !== undefined ? ` (${(i.size_bytes / 1024).toFixed(1)} KB)` : "";
    return `${icon} \`${i.path}\`${size}`;
  };

  return [
    `## Contents of \`${path || "/"}\` in ${owner}/${repo}`,
    "",
    dirs.length  ? `### Directories (${dirs.length})\n${dirs.map(fmt).join("\n")}`   : "",
    files.length ? `### Files (${files.length})\n${files.map(fmt).join("\n")}` : "",
    other.length ? `### Other (${other.length})\n${other.map(fmt).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool: github_get_file
// ---------------------------------------------------------------------------

export function registerGetFile(server: McpServer): void {
  server.registerTool(
    "github_get_file",
    {
      title: "Get File Contents",
      description: `Read the contents of a file in a public GitHub repository.
If the path is a directory, returns a listing of its contents instead.

Args:
  - owner (string): Repository owner (user or org)
  - repo  (string): Repository name
  - path  (string): File path within the repo, e.g. "src/index.ts" or "README.md"
                    Use "" or "/" for the root directory listing.
  - ref   (string): Branch name, tag, or commit SHA (default: repo default branch)

Returns:
  - For files: decoded file content with path, size, SHA, encoding info.
  - For directories: sorted listing of files and subdirectories with sizes.

File size limit: files over ~1 MB may be truncated. Use github_get_tree for large dirs.

Examples:
  - "Read the README of torvalds/linux" → path="README"
  - "Show src/index.ts on the dev branch" → path="src/index.ts", ref="dev"
  - "List files in the src/ directory" → path="src"
  - "What's in the root of microsoft/vscode?" → path=""`,
      inputSchema: z.object({
        owner: z.string().min(1).describe("Repository owner"),
        repo:  z.string().min(1).describe("Repository name"),
        path:  z.string().describe("File or directory path (empty string for root)"),
        ref:   z.string().optional().describe("Branch, tag, or commit SHA"),
      }).strict(),
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   false,
      },
    },
    async ({ owner, repo, path, ref }) => {
      const cleanPath = path.replace(/^\//, ""); // strip leading slash
      try {
        const data = await githubFetch<GithubFileContent | GithubFileContent[]>(
          `/repos/${owner}/${repo}/contents/${cleanPath}`,
          { params: ref ? { ref } : undefined },
        );

        // ── Directory listing ──
        if (Array.isArray(data)) {
          const items: FileSummary[] = data.map(item => ({
            path:       item.path,
            type:       item.type,
            size_bytes: item.type === "file" ? item.size : undefined,
            sha:        item.sha,
          }));

          items.sort((a, b) => {
            // dirs first, then alphabetical
            if (a.type === "dir" && b.type !== "dir") return -1;
            if (a.type !== "dir" && b.type === "dir") return 1;
            return a.path.localeCompare(b.path);
          });

          const markdown = truncate(formatDirMarkdown(owner, repo, cleanPath, items), CHARACTER_LIMIT);
          return {
            content: [{ type: "text" as const, text: markdown }],
            structuredContent: { owner, repo, path: cleanPath, ref, type: "directory", count: items.length, items },
          };
        }

        // ── Single file ──
        if (data.type !== "file") {
          return {
            content: [{
              type: "text" as const,
              text: `"${cleanPath}" is a ${data.type}, not a file. Use path="" to list the directory.`,
            }],
          };
        }

        if (!data.content || data.encoding !== "base64") {
          return {
            content: [{
              type: "text" as const,
              text: `File "${cleanPath}" has unexpected encoding "${data.encoding ?? "none"}". Download URL: ${data.download_url ?? "unavailable"}`,
            }],
          };
        }

        const decoded = decodeBase64Content(data.content);
        const header = [
          `## ${data.path} (${owner}/${repo})`,
          `Size: ${(data.size / 1024).toFixed(1)} KB  ·  SHA: ${data.sha.slice(0, 7)}${ref ? `  ·  ref: ${ref}` : ""}`,
          "",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: truncate(header + decoded, CHARACTER_LIMIT) }],
          structuredContent: {
            owner, repo, path: data.path, ref,
            type: "file",
            size_bytes: data.size,
            sha: data.sha,
            download_url: data.download_url,
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

// ---------------------------------------------------------------------------
// Tool: github_get_tree
// ---------------------------------------------------------------------------

export function registerGetTree(server: McpServer): void {
  server.registerTool(
    "github_get_tree",
    {
      title: "Get Repository File Tree",
      description: `Retrieve the full file and directory tree of a repository at a given ref.
Useful for understanding repository structure before reading specific files.
Use recursive=false for the root level only (faster for large repos).

Args:
  - owner      (string):  Repository owner
  - repo       (string):  Repository name
  - ref        (string):  Branch name, tag, or commit SHA (default: repo default branch)
  - recursive  (boolean): If true, fetch the complete tree recursively (default: false)
  - filter     (string):  Optional path prefix filter — only show entries starting with this prefix

Returns: tree entries with path, type (blob=file, tree=dir), size, and SHA.
If GitHub truncates the tree (very large repos), a warning is shown.

Examples:
  - "Show the file structure of huggingface/transformers" → owner="huggingface", repo="transformers"
  - "List all Python files recursively" → recursive=true, filter=".py" (filter is a prefix match on path)
  - "What's in the src/ directory tree?" → recursive=true, filter="src/"`,
      inputSchema: z.object({
        owner:     z.string().min(1).describe("Repository owner"),
        repo:      z.string().min(1).describe("Repository name"),
        ref:       z.string().optional().describe("Branch, tag, or commit SHA"),
        recursive: z.boolean().default(false).describe("Recursively list all files (true) or root only (false)"),
        filter:    z.string().optional().describe("Only include entries whose path starts with this string"),
      }).strict(),
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   false,
      },
    },
    async ({ owner, repo, ref, recursive, filter }) => {
      try {
        // First resolve the ref to a SHA via the repo endpoint if needed
        let treeSha = ref ?? "HEAD";

        // Use the git/trees endpoint with the ref directly
        const tree = await githubFetch<GithubTree>(
          `/repos/${owner}/${repo}/git/trees/${treeSha}`,
          { params: { recursive: recursive ? "1" : "0" } },
        );

        let entries = tree.tree;

        if (filter) {
          entries = entries.filter(e => e.path.startsWith(filter));
        }

        if (entries.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: filter
                ? `No entries found with path prefix "${filter}" in ${owner}/${repo}@${treeSha}.`
                : `No files found in ${owner}/${repo}@${treeSha}.`,
            }],
          };
        }

        const blobs = entries.filter(e => e.type === "blob");
        const trees = entries.filter(e => e.type === "tree");

        const formatEntry = (e: typeof entries[0]) => {
          const icon = e.type === "tree" ? "📁" : "📄";
          const size = e.size !== undefined ? ` (${(e.size / 1024).toFixed(1)} KB)` : "";
          return `${icon} ${e.path}${size}`;
        };

        const lines = [
          `## File tree for ${owner}/${repo}${ref ? `@${ref}` : ""}`,
          filter ? `Filter: paths starting with "${filter}"` : "",
          recursive ? `Mode: recursive` : `Mode: root only`,
          tree.truncated ? "⚠️ Tree was truncated by GitHub — use filter= to narrow scope" : "",
          "",
          `${trees.length} directories, ${blobs.length} files`,
          "",
          entries.map(formatEntry).join("\n"),
        ].filter(Boolean).join("\n");

        const summaries: FileSummary[] = entries.map(e => ({
          path:       e.path,
          type:       e.type === "blob" ? "file" : "dir",
          size_bytes: e.size,
          sha:        e.sha,
        }));

        return {
          content: [{ type: "text" as const, text: truncate(lines, CHARACTER_LIMIT) }],
          structuredContent: {
            owner, repo, ref, recursive, filter,
            truncated: tree.truncated,
            count: entries.length,
            entries: summaries,
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
