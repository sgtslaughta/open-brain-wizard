/**
 * open-brain-wizard MCP Edge Function.
 * Personal AI memory system — preferences, projects, environment, and more.
 *
 * Tools are organized into modules under ./tools/
 * Shared utilities live under ./lib/
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

import { registerThoughtTools } from "./tools/thoughts.ts";
import { registerPreferenceTools } from "./tools/preferences.ts";
import { registerProjectTools } from "./tools/projects.ts";
import { registerContextTools } from "./tools/context.ts";
import { registerEnvironmentTools } from "./tools/environment.ts";
import { registerCreativeTools } from "./tools/creative.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const server = new McpServer({
  name: "open-brain",
  version: "2.0.0",
});

// Register all tool modules
registerThoughtTools(server, supabase, OPENROUTER_API_KEY);
registerPreferenceTools(server, supabase, OPENROUTER_API_KEY);
registerProjectTools(server, supabase, OPENROUTER_API_KEY);
registerContextTools(server, supabase, OPENROUTER_API_KEY);
registerEnvironmentTools(server, supabase);
registerCreativeTools(server, supabase, OPENROUTER_API_KEY);

const app = new Hono();

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
