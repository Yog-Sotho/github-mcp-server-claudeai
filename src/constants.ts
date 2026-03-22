export const GITHUB_API_BASE = "https://api.github.com";

/** Max characters for any single tool response — prevents context window overflow */
export const CHARACTER_LIMIT = 50_000;

/** Default page size for list operations */
export const DEFAULT_PER_PAGE = 30;

/** Max allowed per_page for list operations */
export const MAX_PER_PAGE = 100;

/** Request timeout in milliseconds */
export const REQUEST_TIMEOUT_MS = 15_000;
