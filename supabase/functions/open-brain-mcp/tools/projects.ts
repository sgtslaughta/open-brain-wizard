import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding } from "../lib/embedding.ts";
import { scanForSensitiveData, sensitiveDataWarning } from "../lib/sensitive.ts";

export function registerProjectTools(
  server: McpServer,
  supabase: SupabaseClient,
  apiKey: string
) {
  server.registerTool(
    "register_project",
    {
      title: "Register Project",
      description:
        "Register a new project or update an existing one in the user's project registry. " +
        "Requires `name` and at least one of `repo_url`, `project_url`, or `description`. " +
        "The `project_url` is the web UI URL (e.g., GitLab/GitHub project page) — store this so you or other models " +
        "can link the user to it or fetch additional detail later. Returns the project `id` — you MUST use this ID " +
        "when calling any project-scoped tool (log_context, save_pattern, log_issue, etc.) to ensure data is correctly " +
        "attributed. If you're unsure which project you're working on, ask the user or call `search_projects` first.",
      inputSchema: {
        name: z.string().describe("Project name"),
        repo_url: z.string().optional().describe("Git repository URL"),
        project_url: z.string().optional().describe("Web UI URL (GitLab/GitHub project page, wiki, issues)"),
        provider: z.enum(["gitlab", "github", "bitbucket", "other"]).optional(),
        description: z.string().optional().describe("Project description"),
        languages: z.array(z.string()).optional().describe("Programming languages used"),
        frameworks: z.array(z.string()).optional().describe("Frameworks used"),
        status: z.enum(["active", "archived", "idea", "paused"]).optional().default("active"),
        local_path: z.string().optional().describe("Local filesystem path"),
        force_store: z.boolean().optional().default(false),
      },
    },
    async ({ name, repo_url, project_url, provider, description, languages, frameworks, status, local_path, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(repo_url, project_url, description, local_path);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const embeddingText = [
          name,
          description,
          languages?.join(", "),
          frameworks?.join(", "),
        ]
          .filter(Boolean)
          .join(" — ");
        const embedding = await getEmbedding(embeddingText, apiKey);

        // Check if project with same name exists
        const { data: existing } = await supabase
          .from("projects")
          .select("id")
          .eq("name", name)
          .limit(1);

        let projectId: string;

        if (existing?.length) {
          projectId = existing[0].id;
          const { error } = await supabase
            .from("projects")
            .update({
              repo_url: repo_url || undefined,
              project_url: project_url || undefined,
              provider: provider || undefined,
              description: description || undefined,
              languages: languages || undefined,
              frameworks: frameworks || undefined,
              status,
              local_path: local_path || undefined,
              embedding,
            })
            .eq("id", projectId);

          if (error) {
            return {
              content: [{ type: "text" as const, text: `Failed to update project: ${error.message}` }],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Updated project "${name}" (id: ${projectId}). Use this ID for all project-scoped operations.`,
              },
            ],
          };
        }

        const { data: inserted, error } = await supabase
          .from("projects")
          .insert({
            name,
            repo_url: repo_url || null,
            project_url: project_url || null,
            provider: provider || null,
            description: description || null,
            languages: languages || [],
            frameworks: frameworks || [],
            status,
            local_path: local_path || null,
            embedding,
          })
          .select("id")
          .single();

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to register project: ${error.message}` }],
            isError: true,
          };
        }

        projectId = inserted.id;
        return {
          content: [
            {
              type: "text" as const,
              text: `Registered project "${name}" (id: ${projectId}). Use this ID for all project-scoped operations.`,
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
    "search_projects",
    {
      title: "Search Projects",
      description:
        "Semantic search across all registered projects. Pass a `query` string to find projects by description, " +
        "tech stack, or purpose. Returns project details including IDs. Use this to find the correct `project_id` " +
        "before calling project-scoped tools. When results are ambiguous, present the matches to the user and ask " +
        "them to confirm which project they mean — never guess.",
      inputSchema: {
        query: z.string().describe("Search query (description, tech, purpose)"),
        limit: z.number().optional().default(10),
      },
    },
    async ({ query, limit }) => {
      try {
        const qEmb = await getEmbedding(query, apiKey);
        const { data, error } = await supabase.rpc("match_projects", {
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
              {
                type: "text" as const,
                text: `No projects found matching "${query}". Use register_project to add projects to the registry.`,
              },
            ],
          };
        }

        const results = data.map(
          (p: Record<string, unknown>, i: number) => {
            const parts = [
              `${i + 1}. ${p.name} (id: ${p.id})`,
              `   Status: ${p.status} | Provider: ${p.provider || "unknown"}`,
            ];
            if (p.description) parts.push(`   Description: ${p.description}`);
            if ((p.languages as string[])?.length)
              parts.push(`   Languages: ${(p.languages as string[]).join(", ")}`);
            if ((p.frameworks as string[])?.length)
              parts.push(`   Frameworks: ${(p.frameworks as string[]).join(", ")}`);
            if (p.project_url) parts.push(`   URL: ${p.project_url}`);
            parts.push(`   Match: ${((p.similarity as number) * 100).toFixed(1)}%`);
            return parts.join("\n");
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${data.length} project(s):\n\n${results.join("\n\n")}`,
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
    "save_pattern",
    {
      title: "Save Pattern",
      description:
        "Extract and store a reusable pattern from a specific project. REQUIRES `project_id` to attribute the pattern " +
        "correctly. Patterns are searchable across ALL projects, enabling cross-project knowledge reuse. " +
        "Only save patterns that are genuinely reusable — not project-specific config. " +
        "SECURITY: Before storing, scan code_snippet and description for hardcoded secrets, API keys, tokens, or credentials. " +
        "If you detect or suspect sensitive data, STOP and ask the user to confirm or sanitize before storing. " +
        "If you're unsure whether something is a reusable pattern, ask the user.",
      inputSchema: {
        project_id: z.string().uuid().describe("Project ID (REQUIRED — use search_projects to find it)"),
        pattern_type: z.enum(["architecture", "deployment", "testing", "code_pattern", "config"]),
        title: z.string().describe("Pattern title"),
        description: z.string().optional().describe("Pattern description"),
        code_snippet: z.string().optional().describe("Example code"),
        file_path: z.string().optional().describe("Source file path"),
        force_store: z.boolean().optional().default(false),
      },
    },
    async ({ project_id, pattern_type, title, description, code_snippet, file_path, force_store }) => {
      try {
        if (!force_store) {
          const scan = scanForSensitiveData(description, code_snippet);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        const embeddingText = [title, description, code_snippet]
          .filter(Boolean)
          .join("\n");
        const embedding = await getEmbedding(embeddingText, apiKey);

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

        const { error } = await supabase.from("project_patterns").insert({
          project_id,
          pattern_type,
          title,
          description: description || null,
          code_snippet: code_snippet || null,
          file_path: file_path || null,
          embedding,
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to save pattern: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Pattern saved: "${title}" (${pattern_type}) in project "${project.name}". This pattern is now searchable across all projects.`,
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
    "find_patterns",
    {
      title: "Find Patterns",
      description:
        "Search reusable patterns across ALL projects by semantic query. Use when the user asks 'How did I handle auth before?' " +
        "or 'What testing pattern did I use?'. Optionally filter by project_id or pattern_type. " +
        "Always tell the user which project a pattern came from so they have full context.",
      inputSchema: {
        query: z.string().describe("What pattern to search for"),
        project_id: z.string().uuid().optional().describe("Filter to a specific project"),
        pattern_type: z
          .enum(["architecture", "deployment", "testing", "code_pattern", "config"])
          .optional(),
        limit: z.number().optional().default(10),
      },
    },
    async ({ query, project_id, pattern_type, limit }) => {
      try {
        const qEmb = await getEmbedding(query, apiKey);
        const { data, error } = await supabase.rpc("match_patterns", {
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

        let filtered = data || [];
        if (pattern_type) {
          filtered = filtered.filter(
            (p: Record<string, unknown>) => p.pattern_type === pattern_type
          );
        }

        if (!filtered.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No patterns found matching "${query}". Use save_pattern to store reusable patterns as you work.`,
              },
            ],
          };
        }

        const results = filtered.map((p: Record<string, unknown>, i: number) => {
          const parts = [
            `--- Pattern ${i + 1} (${((p.similarity as number) * 100).toFixed(1)}% match) ---`,
            `Title: ${p.title}`,
            `Type: ${p.pattern_type} | Project: ${p.project_name} (id: ${p.project_id})`,
          ];
          if (p.description) parts.push(`Description: ${p.description}`);
          if (p.file_path) parts.push(`File: ${p.file_path}`);
          if (p.code_snippet) parts.push(`\nCode:\n${p.code_snippet}`);
          return parts.join("\n");
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${filtered.length} pattern(s):\n\n${results.join("\n\n")}`,
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
