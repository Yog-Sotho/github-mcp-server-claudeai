// ── GitHub API response shapes ──────────────────────────────────────────────

export interface GithubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  visibility: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  size: number; // kilobytes
}

export interface GithubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface GithubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  html_url: string;
  parents: Array<{ sha: string }>;
}

export interface GithubFileContent {
  type: "file" | "dir" | "symlink" | "submodule";
  encoding?: string;
  size: number;
  name: string;
  path: string;
  content?: string; // base64-encoded when type === "file"
  sha: string;
  html_url: string | null;
  download_url: string | null;
}

export interface GithubTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url: string;
}

export interface GithubTree {
  sha: string;
  url: string;
  tree: GithubTreeItem[];
  truncated: boolean;
}

export interface GithubSearchReposResult {
  total_count: number;
  incomplete_results: boolean;
  items: GithubRepo[];
}

// ── Normalised output shapes (returned by tools) ────────────────────────────

export interface RepoSummary {
  full_name: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  open_issues: number;
  language: string | null;
  topics: string[];
  default_branch: string;
  updated_at: string;
  archived: boolean;
  fork: boolean;
}

export interface BranchSummary {
  name: string;
  sha: string;
  protected: boolean;
}

export interface CommitSummary {
  sha: string;
  short_sha: string;
  author: string;
  date: string;
  message: string; // first line only
  url: string;
  parents: number;
}

export interface FileSummary {
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size_bytes?: number;
  sha: string;
}
