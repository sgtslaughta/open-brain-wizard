import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding } from "../lib/embedding.ts";
import { scanForSensitiveData, sensitiveDataWarning } from "../lib/sensitive.ts";

const CATEGORIES = ["coding_style", "communication", "workflow", "tools", "conventions"] as const;
const categoryEnum = z.enum(CATEGORIES);

export function registerPreferenceTools(
  server: McpServer,
  supabase: SupabaseClient,
  apiKey: string
) {
  server.registerTool(
    "get_preferences",
    {
      title: "Get Preferences",
      description:
        "Retrieve the user's active preferences. Call this at the START of every session to understand the user's " +
        "coding style, communication preferences, workflow habits, tool choices, and conventions BEFORE doing any work. " +
        "Filter by `category` (coding_style, communication, workflow, tools, conventions) or pass a `query` string for " +
        "semantic search. Returns preferences with confidence scores — higher confidence means more established preferences. " +
        "If no preferences exist yet, ask the user about their preferences for the current task and use `set_preference` " +
        "or `suggest_preference` to record them.",
      inputSchema: {
        category: categoryEnum.optional().describe("Filter by category"),
        query: z.string().optional().describe("Semantic search query"),
        limit: z.number().optional().default(20),
      },
    },
    async ({ category, query, limit }) => {
      try {
        if (query) {
          const qEmb = await getEmbedding(query, apiKey);
          const { data, error } = await supabase.rpc("match_preferences", {
            query_embedding: qEmb,
            match_threshold: 0.5,
            match_count: limit,
          });
          if (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error.message}` }],
              isError: true,
            };
          }
          if (!data?.length) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No preferences found matching "${query}". Consider asking the user about their preferences and using set_preference or suggest_preference to record them.`,
                },
              ],
            };
          }
          const results = data.map(
            (p: Record<string, unknown>, i: number) =>
              `${i + 1}. [${p.category}] ${p.key}: ${p.value} (confidence: ${((p.confidence as number) * 100).toFixed(0)}%, source: ${p.source})`
          );
          return {
            content: [{ type: "text" as const, text: `Found ${data.length} preference(s):\n\n${results.join("\n")}` }],
          };
        }

        let q = supabase
          .from("preferences")
          .select("id, category, key, value, confidence, source, context, created_at")
          .eq("active", true)
          .order("category")
          .order("confidence", { ascending: false })
          .limit(limit);

        if (category) q = q.eq("category", category);

        const { data, error } = await q;
        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data?.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No preferences stored yet. As you work with the user, observe patterns and use `suggest_preference` to propose them, or use `set_preference` when the user explicitly states a preference.",
              },
            ],
          };
        }

        const grouped: Record<string, string[]> = {};
        for (const p of data) {
          const cat = p.category as string;
          if (!grouped[cat]) grouped[cat] = [];
          grouped[cat].push(
            `  • ${p.key}: ${p.value} (confidence: ${((p.confidence as number) * 100).toFixed(0)}%, source: ${p.source})`
          );
        }

        const lines = Object.entries(grouped).map(
          ([cat, prefs]) => `[${cat}]\n${prefs.join("\n")}`
        );

        return {
          content: [
            { type: "text" as const, text: `${data.length} active preference(s):\n\n${lines.join("\n\n")}` },
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
    "set_preference",
    {
      title: "Set Preference",
      description:
        "Explicitly set or update a user preference. Use this when the user directly tells you something like " +
        "'I prefer tabs over spaces' or 'always use TypeScript'. Sets source to 'explicit' and confidence to 1.0. " +
        "If a preference with the same category+key exists, it will be updated. " +
        "Use `suggest_preference` instead if you are inferring a preference from behavior rather than an explicit statement. " +
        "SECURITY: Scan the value for secrets before storing. If the value looks like a token, key, or password, ask the user to confirm.",
      inputSchema: {
        category: categoryEnum.describe("Preference category"),
        key: z.string().describe("Preference key (e.g., 'indentation', 'language', 'test_framework')"),
        value: z.string().describe("Preference value (e.g., 'tabs', 'TypeScript', 'vitest')"),
        context: z.string().optional().describe("Additional context about this preference"),
        force_store: z.boolean().optional().default(false).describe("Bypass sensitive data check after user confirmation"),
      },
    },
    async ({ category, key, value, context, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(value, context);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const embeddingText = `${category} ${key}: ${value}${context ? ` (${context})` : ""}`;
        const embedding = await getEmbedding(embeddingText, apiKey);

        const { error } = await supabase
          .from("preferences")
          .upsert(
            {
              category,
              key,
              value,
              confidence: 1.0,
              source: "explicit",
              context: context || null,
              embedding,
              active: true,
            },
            { onConflict: "category,key" }
          );

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to set preference: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            { type: "text" as const, text: `Preference set: [${category}] ${key} = ${value} (confidence: 100%, source: explicit)` },
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
    "suggest_preference",
    {
      title: "Suggest Preference",
      description:
        "Queue a preference suggestion for user review. Use this when you NOTICE a consistent pattern in the user's " +
        "behavior or code — do NOT assume. For example, if you see the user consistently uses single quotes in JS " +
        "across multiple sessions, suggest it. The suggestion stays pending until the user reviews it. " +
        "Never suggest preferences you aren't confident about — when in doubt, ASK the user directly instead. " +
        "SECURITY: Scan the suggested_value and reason for secrets before storing. If you suspect sensitive data, ask the user.",
      inputSchema: {
        category: categoryEnum.describe("Preference category"),
        key: z.string().describe("Preference key"),
        suggested_value: z.string().describe("The value you observed"),
        reason: z.string().describe("Explain what pattern you observed that led to this suggestion"),
        session_context: z.string().optional().describe("Context about the current session"),
        force_store: z.boolean().optional().default(false).describe("Bypass sensitive data check after user confirmation"),
      },
    },
    async ({ category, key, suggested_value, reason, session_context, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(suggested_value, reason, session_context);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const { error } = await supabase.from("preference_suggestions").insert({
          category,
          key,
          suggested_value,
          reason,
          session_context: session_context || null,
          status: "pending",
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to suggest: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Preference suggestion queued: [${category}] ${key} = ${suggested_value}\nReason: ${reason}\n\nThe user can review this with the review_suggestions tool.`,
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
    "review_suggestions",
    {
      title: "Review Preference Suggestions",
      description:
        "List, accept, or reject pending preference suggestions. With action 'list', returns all pending suggestions. " +
        "With 'accept' and suggestion_id, promotes to active preference (confidence 0.8). With 'reject', marks it rejected. " +
        "Prompt the user to review suggestions periodically — e.g., 'You have 3 pending preference suggestions. Would you like to review them?'",
      inputSchema: {
        action: z.enum(["list", "accept", "reject"]).describe("Action to perform"),
        suggestion_id: z.string().uuid().optional().describe("Required for accept/reject"),
      },
    },
    async ({ action, suggestion_id }) => {
      try {
        if (action === "list") {
          const { data, error } = await supabase
            .from("preference_suggestions")
            .select("*")
            .eq("status", "pending")
            .order("created_at", { ascending: false });

          if (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error.message}` }],
              isError: true,
            };
          }

          if (!data?.length) {
            return {
              content: [{ type: "text" as const, text: "No pending preference suggestions." }],
            };
          }

          const results = data.map(
            (s: Record<string, unknown>, i: number) =>
              `${i + 1}. [${s.category}] ${s.key} = ${s.suggested_value}\n   Reason: ${s.reason}\n   ID: ${s.id}`
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `${data.length} pending suggestion(s):\n\n${results.join("\n\n")}\n\nTo accept: use action='accept' with the suggestion ID\nTo reject: use action='reject' with the suggestion ID`,
              },
            ],
          };
        }

        if (!suggestion_id) {
          return {
            content: [
              { type: "text" as const, text: "suggestion_id is required for accept/reject actions." },
            ],
            isError: true,
          };
        }

        // Fetch the suggestion
        const { data: suggestion, error: fetchErr } = await supabase
          .from("preference_suggestions")
          .select("*")
          .eq("id", suggestion_id)
          .single();

        if (fetchErr || !suggestion) {
          return {
            content: [
              { type: "text" as const, text: `Suggestion not found: ${fetchErr?.message || "not found"}` },
            ],
            isError: true,
          };
        }

        if (action === "accept") {
          // Promote to active preference
          const embeddingText = `${suggestion.category} ${suggestion.key}: ${suggestion.suggested_value}`;
          const embedding = await getEmbedding(embeddingText, apiKey);

          const { error: upsertErr } = await supabase
            .from("preferences")
            .upsert(
              {
                category: suggestion.category,
                key: suggestion.key,
                value: suggestion.suggested_value,
                confidence: 0.8,
                source: "confirmed",
                context: suggestion.reason,
                embedding,
                active: true,
              },
              { onConflict: "category,key" }
            );

          if (upsertErr) {
            return {
              content: [{ type: "text" as const, text: `Failed to accept: ${upsertErr.message}` }],
              isError: true,
            };
          }

          await supabase
            .from("preference_suggestions")
            .update({ status: "accepted" })
            .eq("id", suggestion_id);

          return {
            content: [
              {
                type: "text" as const,
                text: `Accepted: [${suggestion.category}] ${suggestion.key} = ${suggestion.suggested_value} (confidence: 80%, source: confirmed)`,
              },
            ],
          };
        }

        // Reject
        await supabase
          .from("preference_suggestions")
          .update({ status: "rejected" })
          .eq("id", suggestion_id);

        return {
          content: [
            {
              type: "text" as const,
              text: `Rejected suggestion: [${suggestion.category}] ${suggestion.key} = ${suggestion.suggested_value}`,
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
}
