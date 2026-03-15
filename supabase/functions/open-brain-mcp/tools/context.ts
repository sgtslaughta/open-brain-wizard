import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding } from "../lib/embedding.ts";
import { scanForSensitiveData, sensitiveDataWarning } from "../lib/sensitive.ts";

export function registerContextTools(
  server: McpServer,
  supabase: SupabaseClient,
  apiKey: string
) {
  // ── Project Context ──────────────────────────────────────

  server.registerTool(
    "log_context",
    {
      title: "Log Project Context",
      description:
        "Record a project lifecycle entry: milestone, task, bug, decision, note, or architecture observation. " +
        "REQUIRES `project_id` — always resolve the correct project first. Call this throughout your session to " +
        "build a living project narrative. When logging a bug, include reproduction steps. When logging a decision, " +
        "include the reasoning and alternatives considered. " +
        "SECURITY: Before storing, scan content for secrets, credentials, API keys, tokens, or passwords — bug reports " +
        "and decision notes often quote config or error output containing embedded secrets. If you detect or suspect " +
        "sensitive data, STOP and ask the user to confirm or sanitize before storing. " +
        "If you don't know the project_id, ask the user or call search_projects.",
      inputSchema: {
        project_id: z.string().uuid().describe("Project ID (REQUIRED)"),
        entry_type: z.enum(["milestone", "task", "bug", "decision", "note", "architecture"]),
        title: z.string().describe("Entry title"),
        content: z.string().optional().describe("Detailed content"),
        status: z.enum(["open", "in_progress", "completed", "resolved", "wont_fix"]).optional().default("open"),
        priority: z.enum(["critical", "high", "medium", "low"]).optional().default("medium"),
        tags: z.array(z.string()).optional(),
        related_entry_id: z.string().uuid().optional().describe("Link to a related context entry"),
        force_store: z.boolean().optional().default(false),
      },
    },
    async ({ project_id, entry_type, title, content, status, priority, tags, related_entry_id, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(content, title);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        // Verify project exists
        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", project_id)
          .single();

        if (!project) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Project not found (id: ${project_id}). Use search_projects to find the correct project ID.`,
              },
            ],
            isError: true,
          };
        }

        const embeddingText = [title, content].filter(Boolean).join("\n");
        const embedding = await getEmbedding(embeddingText, apiKey);

        const { data: inserted, error } = await supabase
          .from("project_context")
          .insert({
            project_id,
            entry_type,
            title,
            content: content || null,
            status,
            priority,
            tags: tags || [],
            related_entry_id: related_entry_id || null,
            embedding,
          })
          .select("id")
          .single();

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to log context: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Logged ${entry_type} in "${project.name}": "${title}" (id: ${inserted.id}, status: ${status}, priority: ${priority})`,
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
    "get_project_context",
    {
      title: "Get Project Context",
      description:
        "Retrieve project history and current state. REQUIRES `project_id`. Filter by entry_type, status, priority, " +
        "or pass a query for semantic search. Call this at session start with status 'open' to understand what's pending. " +
        "When presenting results, summarize the state: 'Project X has 3 open tasks, 1 critical bug, and 2 pending decisions. " +
        "Would you like to focus on any of these?' Always offer to dive deeper into specific entries.",
      inputSchema: {
        project_id: z.string().uuid().describe("Project ID (REQUIRED)"),
        entry_type: z.enum(["milestone", "task", "bug", "decision", "note", "architecture"]).optional(),
        status: z.enum(["open", "in_progress", "completed", "resolved", "wont_fix"]).optional(),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        query: z.string().optional().describe("Semantic search query"),
        limit: z.number().optional().default(20),
      },
    },
    async ({ project_id, entry_type, status, priority, query, limit }) => {
      try {
        // Verify project exists
        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", project_id)
          .single();

        if (!project) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Project not found (id: ${project_id}). Use search_projects to find the correct project ID.`,
              },
            ],
            isError: true,
          };
        }

        if (query) {
          const qEmb = await getEmbedding(query, apiKey);
          const { data, error } = await supabase.rpc("match_project_context", {
            query_embedding: qEmb,
            filter_project_id: project_id,
            match_threshold: 0.4,
            match_count: limit,
          });

          if (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error.message}` }],
              isError: true,
            };
          }

          let filtered = data || [];
          if (entry_type)
            filtered = filtered.filter((e: Record<string, unknown>) => e.entry_type === entry_type);
          if (status)
            filtered = filtered.filter((e: Record<string, unknown>) => e.status === status);
          if (priority)
            filtered = filtered.filter((e: Record<string, unknown>) => e.priority === priority);

          if (!filtered.length) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No context entries found matching "${query}" in project "${project.name}".`,
                },
              ],
            };
          }

          return {
            content: [{ type: "text" as const, text: formatContextEntries(filtered, project.name) }],
          };
        }

        // Direct query
        let q = supabase
          .from("project_context")
          .select("id, entry_type, title, content, status, priority, tags, related_entry_id, created_at, updated_at, resolved_at")
          .eq("project_id", project_id)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (entry_type) q = q.eq("entry_type", entry_type);
        if (status) q = q.eq("status", status);
        if (priority) q = q.eq("priority", priority);

        const { data, error } = await q;

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data?.length) {
          const filterDesc = [entry_type, status, priority].filter(Boolean).join(", ");
          return {
            content: [
              {
                type: "text" as const,
                text: `No context entries found in "${project.name}"${filterDesc ? ` (filters: ${filterDesc})` : ""}. Use log_context to record project activity.`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text" as const, text: formatContextEntries(data, project.name) }],
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
    "update_context",
    {
      title: "Update Project Context",
      description:
        "Update a project context entry. REQUIRES `entry_id`. Use this to change status (mark a task completed, " +
        "resolve a bug), update content with new information, or link to a related entry. When marking a bug resolved, " +
        "include what fixed it. Ask the user before changing status on entries you didn't create — " +
        "'This task was logged in a previous session. Should I mark it complete?'",
      inputSchema: {
        entry_id: z.string().uuid().describe("Context entry ID (REQUIRED)"),
        status: z.enum(["open", "in_progress", "completed", "resolved", "wont_fix"]).optional(),
        content: z.string().optional().describe("Updated or appended content"),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        related_entry_id: z.string().uuid().optional().describe("Link to related entry"),
        resolved_at: z.boolean().optional().describe("Set to true to stamp resolved_at with current time"),
        force_store: z.boolean().optional().default(false),
      },
    },
    async ({ entry_id, status, content, priority, related_entry_id, resolved_at, force_store }) => {
      try {
        if (!force_store && content) {
          const scan = scanForSensitiveData(content);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const updates: Record<string, unknown> = {};
        if (status) updates.status = status;
        if (content) updates.content = content;
        if (priority) updates.priority = priority;
        if (related_entry_id) updates.related_entry_id = related_entry_id;
        if (resolved_at) updates.resolved_at = new Date().toISOString();

        if (content) {
          const { data: existing } = await supabase
            .from("project_context")
            .select("title")
            .eq("id", entry_id)
            .single();
          if (existing) {
            updates.embedding = await getEmbedding(
              `${existing.title}\n${content}`,
              apiKey
            );
          }
        }

        const { data: updated, error } = await supabase
          .from("project_context")
          .update(updates)
          .eq("id", entry_id)
          .select("id, entry_type, title, status, priority")
          .single();

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to update: ${error.message}` }],
            isError: true,
          };
        }

        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Entry not found (id: ${entry_id}).` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Updated ${updated.entry_type}: "${updated.title}" (status: ${updated.status}, priority: ${updated.priority})`,
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

  // ── Troubleshooting ──────────────────────────────────────

  server.registerTool(
    "log_issue",
    {
      title: "Log Troubleshooting Issue",
      description:
        "Record a troubleshooting entry after resolving an issue. Include symptom (exact error text), root_cause, " +
        "resolution (step-by-step fix), and environment_context (OS, tool versions, relevant config). " +
        "Pass project_id for project-specific issues or omit for global/cross-project issues. " +
        "SECURITY: Troubleshooting entries are a common vector for secret leakage — error logs, stack traces, and " +
        "environment context often contain embedded tokens, connection strings, or API keys. Before storing, carefully " +
        "scan ALL fields. If you detect or suspect sensitive data, STOP and ask the user to redact before saving. " +
        "Always ask the user: 'Should I save this troubleshooting resolution for future reference?' before logging.",
      inputSchema: {
        symptom: z.string().describe("The error message or unexpected behavior — be specific"),
        root_cause: z.string().optional().describe("What actually caused the issue"),
        resolution: z.string().optional().describe("Step-by-step fix"),
        environment_context: z.string().optional().describe("OS, tool versions, relevant config"),
        project_id: z.string().uuid().optional().describe("Project ID (omit for global issues)"),
        tags: z.array(z.string()).optional(),
        force_store: z.boolean().optional().default(false),
      },
    },
    async ({ symptom, root_cause, resolution, environment_context, project_id, tags, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(symptom, root_cause, resolution, environment_context);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        // If project_id provided, verify it exists
        let projectName: string | null = null;
        if (project_id) {
          const { data: project } = await supabase
            .from("projects")
            .select("name")
            .eq("id", project_id)
            .single();
          if (!project) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Project not found (id: ${project_id}). Use search_projects to find the correct project ID, or omit project_id for a global issue.`,
                },
              ],
              isError: true,
            };
          }
          projectName = project.name;
        }

        const embeddingText = [symptom, root_cause, resolution]
          .filter(Boolean)
          .join("\n");
        const embedding = await getEmbedding(embeddingText, apiKey);

        const { error } = await supabase.from("troubleshooting_log").insert({
          project_id: project_id || null,
          symptom,
          root_cause: root_cause || null,
          resolution: resolution || null,
          environment_context: environment_context || null,
          tags: tags || [],
          embedding,
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to log issue: ${error.message}` }],
            isError: true,
          };
        }

        const scope = projectName
          ? `project "${projectName}"`
          : "global (cross-project)";

        return {
          content: [
            {
              type: "text" as const,
              text: `Troubleshooting entry saved (${scope}):\n  Symptom: ${symptom.slice(0, 100)}${symptom.length > 100 ? "..." : ""}\n  ${root_cause ? `Cause: ${root_cause.slice(0, 100)}` : "Cause: pending"}\n  ${resolution ? `Fix: ${resolution.slice(0, 100)}` : "Fix: pending"}`,
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
    "search_issues",
    {
      title: "Search Troubleshooting Issues",
      description:
        "Semantic search across the troubleshooting knowledge base. Use this IMMEDIATELY when you encounter an error — " +
        "before trying to debug from scratch, check if this issue has been solved before. Pass the error message or " +
        "symptom description as query. Optionally filter by project_id. If a match is found, tell the user: " +
        "'This looks similar to an issue resolved previously: [summary]. The fix was: [resolution]. Should we try that approach?' " +
        "If no match, proceed with normal debugging and call log_issue once resolved.",
      inputSchema: {
        query: z.string().describe("Error message or symptom description"),
        project_id: z.string().uuid().optional().describe("Filter to a specific project"),
        limit: z.number().optional().default(5),
      },
    },
    async ({ query, project_id, limit }) => {
      try {
        const qEmb = await getEmbedding(query, apiKey);
        const { data, error } = await supabase.rpc("match_troubleshooting", {
          query_embedding: qEmb,
          match_threshold: 0.4,
          match_count: limit,
          filter_project_id: project_id || null,
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
                text: `No matching troubleshooting entries found for "${query.slice(0, 100)}". If you resolve this issue, use log_issue to save the solution for future reference.`,
              },
            ],
          };
        }

        const results = data.map((t: Record<string, unknown>, i: number) => {
          const scope = t.project_name
            ? `Project: ${t.project_name}`
            : "Scope: Global (cross-project)";
          const parts = [
            `--- Issue ${i + 1} (${((t.similarity as number) * 100).toFixed(1)}% match) ---`,
            scope,
            `Symptom: ${t.symptom}`,
          ];
          if (t.root_cause) parts.push(`Root cause: ${t.root_cause}`);
          if (t.resolution) parts.push(`Resolution: ${t.resolution}`);
          if (t.environment_context) parts.push(`Environment: ${t.environment_context}`);
          if ((t.tags as string[])?.length) parts.push(`Tags: ${(t.tags as string[]).join(", ")}`);
          return parts.join("\n");
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${data.length} matching issue(s):\n\n${results.join("\n\n")}`,
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

function formatContextEntries(
  entries: Record<string, unknown>[],
  projectName: string
): string {
  // Build summary counts
  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const e of entries) {
    const s = e.status as string;
    const t = e.entry_type as string;
    statusCounts[s] = (statusCounts[s] || 0) + 1;
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  const summaryParts = Object.entries(typeCounts)
    .map(([t, c]) => `${c} ${t}(s)`)
    .join(", ");
  const statusParts = Object.entries(statusCounts)
    .map(([s, c]) => `${c} ${s}`)
    .join(", ");

  const header = `Project "${projectName}" — ${entries.length} entries (${summaryParts})\nBy status: ${statusParts}\n`;

  const lines = entries.map((e: Record<string, unknown>, i: number) => {
    const parts = [
      `${i + 1}. [${e.entry_type}] ${e.title} (${e.status}, ${e.priority})`,
    ];
    if (e.content) {
      const content = e.content as string;
      parts.push(`   ${content.slice(0, 150)}${content.length > 150 ? "..." : ""}`);
    }
    if ((e.tags as string[])?.length)
      parts.push(`   Tags: ${(e.tags as string[]).join(", ")}`);
    parts.push(`   ID: ${e.id} | Created: ${new Date(e.created_at as string).toLocaleDateString()}`);
    return parts.join("\n");
  });

  return `${header}\n${lines.join("\n\n")}`;
}
