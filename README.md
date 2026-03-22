# github-mcp-server — Claude.ai Edition

MCP server for browsing **public** GitHub repositories from Claude.ai. Uses **Streamable HTTP** transport — you deploy it once to a hosting platform, then connect Claude.ai to the URL.

No GitHub token required. All 7 tools work against public repos out of the box.

## Tools

| Tool | Description |
|------|-------------|
| `github_get_repo` | Full metadata for a single repo |
| `github_list_user_repos` | Paginated list of a user/org's repos |
| `github_search_repos` | Search with GitHub query syntax |
| `github_list_branches` | Branch names, SHAs, protection status |
| `github_list_commits` | Commits filterable by path, author, date |
| `github_get_file` | Read a file or list a directory |
| `github_get_tree` | Full recursive file tree |

---

## Deploy in 5 minutes (Railway — recommended)

Railway is the easiest zero-config option.

1. Push this folder to a GitHub repo (or fork it)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select your repo — Railway auto-detects Node and runs `npm run build && npm start`
4. Once deployed, copy the public URL (e.g. `https://github-mcp-server-production.up.railway.app`)

### Alternative: Render

1. New Web Service → Connect your GitHub repo
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Copy the public URL

### Alternative: Fly.io

```bash
npm install
npm run build
fly launch          # follow prompts
fly deploy
fly status          # get your app URL
```

---

## Connect to Claude.ai

1. Go to **claude.ai → Settings → Integrations**
2. Click **Add Integration**
3. Enter your deployed URL with `/mcp` appended:
   ```
   https://your-app-url.railway.app/mcp
   ```
4. Click **Save** — Claude will detect and list all 7 tools automatically

---

## Local testing (before deploying)

```bash
npm install
npm run build
npm start
# Server runs at http://localhost:3000
# Test: curl http://localhost:3000/health
```

Use [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to test tools locally:
```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

---

## Adding a GitHub Token (optional — raises rate limit from 60 to 5 000 req/hour)

Set `GITHUB_TOKEN` as an environment variable on your hosting platform, then update
`src/services/github.ts` to include it in the `Authorization` header:

```typescript
"Authorization": process.env.GITHUB_TOKEN ? `Bearer ${process.env.GITHUB_TOKEN}` : "",
```

On Railway: Settings → Variables → Add `GITHUB_TOKEN = ghp_your_token_here`

---

## Difference from Claude Code version

| | Claude Code version | Claude.ai version (this file) |
|---|---|---|
| Transport | stdio (local process) | Streamable HTTP (remote server) |
| Hosting | Runs on your machine | Deployed to Railway / Render / Fly |
| Config | `claude_desktop_config.json` | Claude.ai Settings → Integrations |
| Tools | Identical 7 tools | Identical 7 tools |
