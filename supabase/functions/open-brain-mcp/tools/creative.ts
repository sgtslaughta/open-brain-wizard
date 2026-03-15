import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding } from "../lib/embedding.ts";
import { scanForSensitiveData, sensitiveDataWarning } from "../lib/sensitive.ts";

export function registerCreativeTools(
  server: McpServer,
  supabase: SupabaseClient,
  apiKey: string
) {
  // ── 4a. Decision Journal ─────────────────────────────────

  server.registerTool(
    "log_decision",
    {
      title: "Log Decision",
      description:
        "Record an important decision. Pass project_id if project-specific. Include title, context (what prompted it), " +
        "decision (what was chosen), and alternatives (JSON array of options considered with pros/cons). " +
        "Ask the user: 'This seems like an important decision. Should I log it so you can recall the reasoning later?' " +
        "SECURITY: Scan content for secrets before storing.",
      inputSchema: {
        title: z.string().describe("Decision title"),
        context: z.string().optional().describe("What prompted the decision"),
        decision: z.string().describe("What was decided"),
        alternatives: z
          .array(z.object({ option: z.string(), pros: z.string().optional(), cons: z.string().optional() }))
          .optional()
          .describe("Alternatives considered"),
        project_id: z.string().uuid().optional(),
        force_store: z.boolean().optional().default(false),
      },
    },
    async ({ title, context, decision, alternatives, project_id, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(title, context, decision);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const embeddingText = [title, context, decision].filter(Boolean).join("\n");
        const embedding = await getEmbedding(embeddingText, apiKey);

        const { data: inserted, error } = await supabase
          .from("decisions")
          .insert({
            title,
            context: context || null,
            decision,
            alternatives: alternatives || [],
            project_id: project_id || null,
            embedding,
          })
          .select("id")
          .single();

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to log decision: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Decision logged: "${title}" (id: ${inserted.id})${alternatives?.length ? ` — ${alternatives.length} alternative(s) recorded` : ""}`,
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
    "search_decisions",
    {
      title: "Search Decisions",
      description:
        "Search past decisions by semantic query. Use when the user asks 'why did I choose X?' or when you need " +
        "to understand past reasoning before suggesting changes. Always present the alternatives that were considered.",
      inputSchema: {
        query: z.string().describe("What decision to search for"),
        project_id: z.string().uuid().optional(),
        limit: z.number().optional().default(5),
      },
    },
    async ({ query, project_id, limit }) => {
      try {
        const qEmb = await getEmbedding(query, apiKey);
        const { data, error } = await supabase.rpc("match_decisions", {
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
            content: [{ type: "text" as const, text: `No decisions found matching "${query}".` }],
          };
        }

        const results = data.map((d: Record<string, unknown>, i: number) => {
          const parts = [
            `--- Decision ${i + 1} (${((d.similarity as number) * 100).toFixed(1)}% match) ---`,
            `Title: ${d.title}`,
          ];
          if (d.project_name) parts.push(`Project: ${d.project_name}`);
          if (d.context) parts.push(`Context: ${d.context}`);
          parts.push(`Decision: ${d.decision}`);
          const alts = d.alternatives as Array<{ option: string; pros?: string; cons?: string }>;
          if (alts?.length) {
            parts.push("Alternatives considered:");
            for (const a of alts) {
              let line = `  • ${a.option}`;
              if (a.pros) line += ` [pros: ${a.pros}]`;
              if (a.cons) line += ` [cons: ${a.cons}]`;
              parts.push(line);
            }
          }
          if (d.outcome) parts.push(`Outcome: ${d.outcome}`);
          parts.push(`Date: ${new Date(d.created_at as string).toLocaleDateString()}`);
          return parts.join("\n");
        });

        return {
          content: [{ type: "text" as const, text: `Found ${data.length} decision(s):\n\n${results.join("\n\n")}` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ── 4b. Snippets ─────────────────────────────────────────

  server.registerTool(
    "save_snippet",
    {
      title: "Save Snippet",
      description:
        "Save a code snippet, URL, command, or any text to the persistent clipboard. " +
        "SECURITY WARNING: This is the highest-risk tool for accidental secret storage because it's designed for " +
        "quick saves of arbitrary content. BEFORE storing, carefully scan content for API keys, tokens, passwords, " +
        "credentials, connection strings, or any sensitive data. If you detect OR SUSPECT sensitive data, STOP and ask the user.",
      inputSchema: {
        content: z.string().describe("The snippet content"),
        tags: z.array(z.string()).optional().describe("Tags for categorization"),
        force_store: z.boolean().optional().default(false),
      },
    },
    async ({ content, tags, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(content);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const embedding = await getEmbedding(content, apiKey);
        const { error } = await supabase.from("snippets").insert({
          content,
          tags: tags || [],
          embedding,
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to save snippet: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Snippet saved${tags?.length ? ` (tags: ${tags.join(", ")})` : ""}: ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`,
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
    "search_snippets",
    {
      title: "Search Snippets",
      description:
        "Search saved snippets by semantic query or tags. Use when the user says 'I saved a command for that' " +
        "or 'what was that regex I used before?'. Returns content with tags for context.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().optional().default(10),
      },
    },
    async ({ query, limit }) => {
      try {
        const qEmb = await getEmbedding(query, apiKey);
        const { data, error } = await supabase.rpc("match_snippets", {
          query_embedding: qEmb,
          match_threshold: 0.4,
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
            content: [{ type: "text" as const, text: `No snippets found matching "${query}".` }],
          };
        }

        const results = data.map((s: Record<string, unknown>, i: number) => {
          const parts = [`--- Snippet ${i + 1} (${((s.similarity as number) * 100).toFixed(1)}% match) ---`];
          if ((s.tags as string[])?.length) parts.push(`Tags: ${(s.tags as string[]).join(", ")}`);
          parts.push(`\n${s.content}`);
          return parts.join("\n");
        });

        return {
          content: [{ type: "text" as const, text: `Found ${data.length} snippet(s):\n\n${results.join("\n\n")}` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ── 4c. Session Continuity ───────────────────────────────

  server.registerTool(
    "start_session",
    {
      title: "Start Session",
      description:
        "Record the start of a work session. REQUIRES project_id. Include branch, objective (what the user intends " +
        "to accomplish), and optional notes. Call this when beginning focused work. " +
        "SECURITY: Scan objective and notes for secrets before storing. If you suspect sensitive data, ask the user.",
      inputSchema: {
        project_id: z.string().uuid().describe("Project ID (REQUIRED)"),
        branch: z.string().optional(),
        objective: z.string().describe("What the user intends to accomplish"),
        notes: z.string().optional(),
        force_store: z.boolean().optional().default(false).describe("Bypass sensitive data check after user confirmation"),
      },
    },
    async ({ project_id, branch, objective, notes, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(objective, notes);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", project_id)
          .single();

        if (!project) {
          return {
            content: [
              { type: "text" as const, text: `Project not found (id: ${project_id}).` },
            ],
            isError: true,
          };
        }

        const { data: inserted, error } = await supabase
          .from("sessions")
          .insert({
            project_id,
            branch: branch || null,
            objective,
            status: "active",
            notes: notes || null,
          })
          .select("id")
          .single();

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to start session: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Session started for "${project.name}" (id: ${inserted.id})\nObjective: ${objective}${branch ? `\nBranch: ${branch}` : ""}`,
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
    "end_session",
    {
      title: "End Session",
      description:
        "Mark a session as ended. Include notes summarizing what was accomplished and what's left. " +
        "Ask the user: 'Should I save a session summary so we can pick up here next time?'",
      inputSchema: {
        session_id: z.string().uuid().describe("Session ID (REQUIRED)"),
        notes: z.string().optional().describe("Summary of what was accomplished and what's left"),
        status: z.enum(["completed", "paused"]).optional().default("completed"),
      },
    },
    async ({ session_id, notes, status }) => {
      try {
        const { data: updated, error } = await supabase
          .from("sessions")
          .update({ status, notes: notes || undefined })
          .eq("id", session_id)
          .select("id, objective, status")
          .single();

        if (error || !updated) {
          return {
            content: [
              { type: "text" as const, text: `Failed to end session: ${error?.message || "not found"}` },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Session ended (${updated.status}): "${updated.objective}"${notes ? `\nNotes: ${notes}` : ""}`,
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
    "resume_session",
    {
      title: "Resume Session",
      description:
        "Find the most recent session for a project to resume. Use at session start: " +
        "'Last time you were working on [objective] on branch [branch]. You noted: [notes]. Want to continue from there?'",
      inputSchema: {
        project_id: z.string().uuid().describe("Project ID"),
      },
    },
    async ({ project_id }) => {
      try {
        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", project_id)
          .single();

        if (!project) {
          return {
            content: [
              { type: "text" as const, text: `Project not found (id: ${project_id}).` },
            ],
            isError: true,
          };
        }

        const { data, error } = await supabase
          .from("sessions")
          .select("*")
          .eq("project_id", project_id)
          .order("updated_at", { ascending: false })
          .limit(1);

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
                text: `No previous sessions found for "${project.name}". Use start_session to begin tracking.`,
              },
            ],
          };
        }

        const s = data[0];
        const parts = [
          `Last session for "${project.name}":`,
          `  Status: ${s.status}`,
          `  Objective: ${s.objective}`,
        ];
        if (s.branch) parts.push(`  Branch: ${s.branch}`);
        if (s.notes) parts.push(`  Notes: ${s.notes}`);
        parts.push(`  Last updated: ${new Date(s.updated_at).toLocaleString()}`);
        parts.push(`  Session ID: ${s.id}`);

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ── 4d. Skills ───────────────────────────────────────────

  server.registerTool(
    "update_skill",
    {
      title: "Update Skill",
      description:
        "Add or update a skill/technology in the user's knowledge profile. Use this to build a living profile — " +
        "when you see the user working fluently in a technology, update their proficiency. " +
        "Ask before recording: 'You seem very comfortable with Go — should I update your skill profile?'",
      inputSchema: {
        name: z.string().describe("Skill/technology name"),
        category: z.enum(["language", "framework", "tool", "platform", "concept"]).optional(),
        proficiency: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
        notes: z.string().optional(),
      },
    },
    async ({ name, category, proficiency, notes }) => {
      try {
        const { data: existing } = await supabase
          .from("skills")
          .select("id, proficiency")
          .eq("name", name)
          .limit(1);

        if (existing?.length) {
          const updates: Record<string, unknown> = { last_used: new Date().toISOString() };
          if (category) updates.category = category;
          if (proficiency) updates.proficiency = proficiency;
          if (notes) updates.notes = notes;

          const { error } = await supabase
            .from("skills")
            .update(updates)
            .eq("id", existing[0].id);

          if (error) {
            return {
              content: [{ type: "text" as const, text: `Failed to update skill: ${error.message}` }],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Updated skill: ${name}${proficiency ? ` (${existing[0].proficiency} → ${proficiency})` : ""}`,
              },
            ],
          };
        }

        const { error } = await supabase.from("skills").insert({
          name,
          category: category || null,
          proficiency: proficiency || "beginner",
          notes: notes || null,
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to add skill: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Added skill: ${name} (${proficiency || "beginner"}${category ? `, ${category}` : ""})`,
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
    "get_skills",
    {
      title: "Get Skills",
      description:
        "Retrieve the user's skill profile. Filter by category or get all. " +
        "Use this to calibrate explanations — if the user is an expert in Python, don't explain basic syntax. " +
        "Call this at session start alongside get_preferences for a complete picture.",
      inputSchema: {
        category: z.enum(["language", "framework", "tool", "platform", "concept"]).optional(),
      },
    },
    async ({ category }) => {
      try {
        let q = supabase
          .from("skills")
          .select("*")
          .order("category")
          .order("proficiency", { ascending: false });

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
                text: "No skills recorded yet. Use update_skill to build the user's knowledge profile over time.",
              },
            ],
          };
        }

        const grouped: Record<string, string[]> = {};
        for (const s of data) {
          const cat = s.category || "uncategorized";
          if (!grouped[cat]) grouped[cat] = [];
          const lastUsed = s.last_used
            ? new Date(s.last_used).toLocaleDateString()
            : "unknown";
          grouped[cat].push(
            `  • ${s.name}: ${s.proficiency} (last used: ${lastUsed})${s.notes ? ` — ${s.notes}` : ""}`
          );
        }

        const lines = Object.entries(grouped).map(
          ([cat, skills]) => `[${cat}]\n${skills.join("\n")}`
        );

        return {
          content: [
            { type: "text" as const, text: `${data.length} skill(s):\n\n${lines.join("\n\n")}` },
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

  // ── 4e. People Graph ─────────────────────────────────────

  server.registerTool(
    "lookup_person",
    {
      title: "Lookup Person",
      description:
        "Search for a person by name or semantic query. Use when the user mentions someone — " +
        "'What was I discussing with Sarah?' or 'Who's the DevOps lead?'. " +
        "If multiple matches found, ask the user to clarify which person they mean.",
      inputSchema: {
        query: z.string().describe("Person name or description"),
        limit: z.number().optional().default(5),
      },
    },
    async ({ query, limit }) => {
      try {
        // Try exact name match first
        const { data: exact } = await supabase
          .from("people")
          .select("*")
          .ilike("name", `%${query}%`)
          .limit(limit);

        if (exact?.length) {
          const results = exact.map((p: Record<string, unknown>) => {
            const parts = [`${p.name}`];
            if (p.role) parts.push(`  Role: ${p.role}`);
            if (p.context) parts.push(`  Context: ${p.context}`);
            if (p.last_contact)
              parts.push(`  Last contact: ${new Date(p.last_contact as string).toLocaleDateString()}`);
            if (p.notes) parts.push(`  Notes: ${p.notes}`);
            return parts.join("\n");
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${exact.length} person(s):\n\n${results.join("\n\n")}`,
              },
            ],
          };
        }

        // Fall back to semantic search
        const qEmb = await getEmbedding(query, apiKey);
        const { data, error } = await supabase.rpc("match_people", {
          query_embedding: qEmb,
          match_threshold: 0.4,
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
              { type: "text" as const, text: `No person found matching "${query}". Use update_person to add them.` },
            ],
          };
        }

        const results = data.map((p: Record<string, unknown>) => {
          const parts = [`${p.name} (${((p.similarity as number) * 100).toFixed(0)}% match)`];
          if (p.role) parts.push(`  Role: ${p.role}`);
          if (p.context) parts.push(`  Context: ${p.context}`);
          if (p.notes) parts.push(`  Notes: ${p.notes}`);
          return parts.join("\n");
        });

        return {
          content: [
            { type: "text" as const, text: `Found ${data.length} person(s):\n\n${results.join("\n\n")}` },
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
    "update_person",
    {
      title: "Update Person",
      description:
        "Add or update a person's record. Include name, and optionally role, context (how the user knows them), " +
        "notes. Updates last_contact automatically. Use when the user mentions interactions with people. " +
        "SECURITY: Scan notes and context for secrets before storing. If you suspect sensitive data, ask the user.",
      inputSchema: {
        name: z.string().describe("Person's name"),
        role: z.string().optional().describe("Their role or title"),
        context: z.string().optional().describe("How the user knows them"),
        notes: z.string().optional().describe("Additional notes"),
        force_store: z.boolean().optional().default(false).describe("Bypass sensitive data check after user confirmation"),
      },
    },
    async ({ name, role, context, notes, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(role, context, notes);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        // Check if person exists
        const { data: existing } = await supabase
          .from("people")
          .select("id")
          .ilike("name", name)
          .limit(1);

        const embeddingText = [name, role, context, notes].filter(Boolean).join(" — ");
        const embedding = await getEmbedding(embeddingText, apiKey);

        if (existing?.length) {
          const updates: Record<string, unknown> = {
            last_contact: new Date().toISOString(),
            embedding,
          };
          if (role) updates.role = role;
          if (context) updates.context = context;
          if (notes) updates.notes = notes;

          const { error } = await supabase
            .from("people")
            .update(updates)
            .eq("id", existing[0].id);

          if (error) {
            return {
              content: [{ type: "text" as const, text: `Failed to update person: ${error.message}` }],
              isError: true,
            };
          }

          return {
            content: [
              { type: "text" as const, text: `Updated person: ${name}${role ? ` (${role})` : ""}` },
            ],
          };
        }

        const { error } = await supabase.from("people").insert({
          name,
          role: role || null,
          context: context || null,
          notes: notes || null,
          last_contact: new Date().toISOString(),
          embedding,
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to add person: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            { type: "text" as const, text: `Added person: ${name}${role ? ` (${role})` : ""}` },
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
