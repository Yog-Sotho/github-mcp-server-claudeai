import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerGetRepo, registerListUserRepos, registerSearchRepos } from "./tools/repos.js";
import { registerListBranches, registerListCommits } from "./tools/branches.js";
import { registerGetFile, registerGetTree } from "./tools/files.js";

// ---------------------------------------------------------------------------
// Server factory — one McpServer instance per request (stateless)
// ---------------------------------------------------------------------------

function createServer(): McpServer {
  const server = new McpServer({
    name: "github-mcp-server",
    version: "1.0.0",
  });

  registerGetRepo(server);
  registerListUserRepos(server);
  registerSearchRepos(server);
  registerListBranches(server);
  registerListCommits(server);
  registerGetFile(server);
  registerGetTree(server);

  return server;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// CORS — Claude.ai connects from claude.ai origin
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
  next();
});

app.options("/mcp", (_req, res) => {
  res.status(204).end();
});

// Health check — used by hosting platforms (Railway, Render, Fly) to verify liveness
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "github-mcp-server", version: "1.0.0" });
});

// MCP endpoint — new stateless transport per request (prevents session ID collisions)
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no persistent sessions
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  console.log(`github-mcp-server listening on http://0.0.0.0:${PORT}`);
  console.log(`MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});

