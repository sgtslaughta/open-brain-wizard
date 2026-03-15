import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding } from "../lib/embedding.ts";
import { extractMetadata } from "../lib/metadata.ts";
import { scanForSensitiveData, sensitiveDataWarning } from "../lib/sensitive.ts";

export function registerThoughtTools(
  server: McpServer,
  supabase: SupabaseClient,
  apiKey: string
) {
  server.registerTool(
    "search_thoughts",
    {
      title: "Search Thoughts",
      description:
        "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
      inputSchema: {
        query: z.string().describe("What to search for"),
        limit: z.number().optional().default(10),
        threshold: z.number().optional().default(0.5),
      },
    },
    async ({ query, limit, threshold }) => {
      try {
        const qEmb = await getEmbedding(query, apiKey);
        const { data, error } = await supabase.rpc("match_thoughts", {
          query_embedding: qEmb,
          match_threshold: threshold,
          match_count: limit,
          filter: {},
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || data.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
          };
        }

        const results = data.map(
          (
            t: {
              content: string;
              metadata: Record<string, unknown>;
              similarity: number;
              created_at: string;
            },
            i: number
          ) => {
            const m = t.metadata || {};
            const parts = [
              `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
              `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
              `Type: ${m.type || "unknown"}`,
            ];
            if (Array.isArray(m.topics) && m.topics.length)
              parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
            if (Array.isArray(m.people) && m.people.length)
              parts.push(`People: ${(m.people as string[]).join(", ")}`);
            if (Array.isArray(m.action_items) && m.action_items.length)
              parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
            parts.push(`\n${t.content}`);
            return parts.join("\n");
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "list_thoughts",
    {
      title: "List Recent Thoughts",
      description:
        "List recently captured thoughts with optional filters by type, topic, person, or time range.",
      inputSchema: {
        limit: z.number().optional().default(10),
        type: z
          .string()
          .optional()
          .describe("Filter by type: observation, task, idea, reference, person_note"),
        topic: z.string().optional().describe("Filter by topic tag"),
        person: z.string().optional().describe("Filter by person mentioned"),
        days: z.number().optional().describe("Only thoughts from the last N days"),
      },
    },
    async ({ limit, type, topic, person, days }) => {
      try {
        let q = supabase
          .from("thoughts")
          .select("content, metadata, created_at")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (type) q = q.contains("metadata", { type });
        if (topic) q = q.contains("metadata", { topics: [topic] });
        if (person) q = q.contains("metadata", { people: [person] });
        if (days) {
          const since = new Date();
          since.setDate(since.getDate() - days);
          q = q.gte("created_at", since.toISOString());
        }

        const { data, error } = await q;

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || !data.length) {
          return { content: [{ type: "text" as const, text: "No thoughts found." }] };
        }

        const results = data.map(
          (
            t: { content: string; metadata: Record<string, unknown>; created_at: string },
            i: number
          ) => {
            const m = t.metadata || {};
            const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
            return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${m.type || "??"}${tags ? " - " + tags : ""})\n   ${t.content}`;
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "thought_stats",
    {
      title: "Thought Statistics",
      description:
        "Get a summary of all captured thoughts: totals, types, top topics, and people.",
      inputSchema: {},
    },
    async () => {
      try {
        const { count } = await supabase
          .from("thoughts")
          .select("*", { count: "exact", head: true });

        const { data } = await supabase
          .from("thoughts")
          .select("metadata, created_at")
          .order("created_at", { ascending: false });

        const types: Record<string, number> = {};
        const topics: Record<string, number> = {};
        const people: Record<string, number> = {};

        for (const r of data || []) {
          const m = (r.metadata || {}) as Record<string, unknown>;
          if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
          if (Array.isArray(m.topics))
            for (const t of m.topics)
              topics[t as string] = (topics[t as string] || 0) + 1;
          if (Array.isArray(m.people))
            for (const p of m.people)
              people[p as string] = (people[p as string] || 0) + 1;
        }

        const sort = (o: Record<string, number>): [string, number][] =>
          Object.entries(o)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const lines: string[] = [
          `Total thoughts: ${count}`,
          `Date range: ${
            data?.length
              ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
                " → " +
                new Date(data[0].created_at).toLocaleDateString()
              : "N/A"
          }`,
          "",
          "Types:",
          ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
        ];

        if (Object.keys(topics).length) {
          lines.push("", "Top topics:");
          for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
        }

        if (Object.keys(people).length) {
          lines.push("", "People mentioned:");
          for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "capture_thought",
    {
      title: "Capture Thought",
      description:
        "Save a new thought to the open-brain. Generates an embedding and extracts metadata automatically. " +
        "SECURITY: Before calling this tool, scan the content for secrets, API keys, tokens, passwords, or credentials. " +
        "If you detect or suspect sensitive data, STOP and ask the user to confirm or sanitize before storing. " +
        "The server also runs a secondary scan and will block storage if sensitive patterns are detected.",
      inputSchema: {
        content: z.string().describe("The thought to capture — a clear, standalone statement."),
        force_store: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Set to true ONLY if the user has explicitly confirmed that flagged content is not sensitive. Never set this without user confirmation."
          ),
      },
    },
    async ({ content, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(content);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const [embedding, metadata] = await Promise.all([
          getEmbedding(content, apiKey),
          extractMetadata(content, apiKey),
        ]);

        const { error } = await supabase.from("thoughts").insert({
          content,
          embedding,
          metadata: { ...metadata, source: "mcp" },
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }],
            isError: true,
          };
        }

        const meta = metadata as Record<string, unknown>;
        let confirmation = `Captured as ${meta.type || "thought"}`;
        if (Array.isArray(meta.topics) && meta.topics.length)
          confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
        if (Array.isArray(meta.people) && meta.people.length)
          confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
        if (Array.isArray(meta.action_items) && meta.action_items.length)
          confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;

        return {
          content: [{ type: "text" as const, text: confirmation }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}
