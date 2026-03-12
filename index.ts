import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { registerReadTools } from "./tools/readTools.js";
import { registerWriteTools } from "./tools/writeTools.js";

// ── Server Setup ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "google-docs-mcp-server",
  version: "1.0.0",
});

// Register all tools
registerReadTools(server);
registerWriteTools(server);

// ── HTTP Transport ────────────────────────────────────────────────────────────

async function startHTTPServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "google-docs-mcp-server", version: "1.0.0" });
  });

  // MCP endpoint — stateless: new transport per request
  app.post("/mcp", async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close().catch((err: unknown) =>
        console.error("Transport close error:", err)
      );
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("Request handling error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`Google Docs MCP server running on http://localhost:${port}/mcp`);
    console.error(`Health check available at http://localhost:${port}/health`);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

startHTTPServer().catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
