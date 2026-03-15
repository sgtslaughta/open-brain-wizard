import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scanForSensitiveData, sensitiveDataWarning } from "../lib/sensitive.ts";

export function registerEnvironmentTools(
  server: McpServer,
  supabase: SupabaseClient,
) {
  server.registerTool(
    "save_config",
    {
      title: "Save Environment Config",
      description:
        "Store an environment configuration item within a named environment. The environment_name groups configs " +
        "that belong to a specific machine or setup (e.g., 'windows-desktop', 'macbook-pro', 'devops-server', " +
        "'research-lab', or a hostname like 'archon'). If the user doesn't specify an environment name, ASK them " +
        "what to call this environment — suggest using the machine hostname or a descriptive name. " +
        "Requires config_type (shell/editor/extension/package/dotfile/system), name, and at least one of " +
        "config_content (full file content for dotfiles) or install_command. " +
        "Include platform (linux/macos/windows/all) — critical for cross-OS bootstrap scripts. " +
        "SECURITY: BEFORE storing, scan config_content and install_command for secrets, API keys, tokens, passwords, " +
        "or credentials. If you detect OR SUSPECT sensitive data, STOP and ask the user. " +
        "NEVER store actual secrets — only references like 'API key stored in ~/.env'.",
      inputSchema: {
        environment_name: z.string().describe(
          "Name of the environment/machine (e.g., 'windows-desktop', 'macbook-pro', 'devops-server', hostname). " +
          "If the user hasn't specified one, ask them."
        ),
        config_type: z.enum(["shell", "editor", "extension", "package", "dotfile", "system"]),
        name: z.string().describe("Config item name (e.g., 'zsh', 'neovim', 'docker')"),
        version: z.string().optional(),
        config_content: z.string().optional().describe("Full file content for dotfiles"),
        install_command: z.string().optional().describe("Install command for this tool/package"),
        platform: z.enum(["linux", "macos", "windows", "all"]).optional().default("all"),
        priority: z.number().optional().default(100).describe("Install order (lower = first)"),
        metadata: z
          .record(z.unknown())
          .optional()
          .describe("Additional metadata (e.g., { target_path: '~/.zshrc' })"),
        force_store: z.boolean().optional().default(false),
      },
    },
    async ({ environment_name, config_type, name, version, config_content, install_command, platform, priority, metadata, force_store }) => {
      try {
        if (!config_content && !install_command) {
          return {
            content: [
              {
                type: "text" as const,
                text: "At least one of config_content or install_command is required.",
              },
            ],
            isError: true,
          };
        }

        if (!force_store) {
          const scan = scanForSensitiveData(config_content, install_command);
          if (scan.hasSensitiveData) return sensitiveDataWarning(scan);
        }

        // Check if config with same environment+type+name+platform exists
        const { data: existing } = await supabase
          .from("environment_configs")
          .select("id")
          .eq("environment_name", environment_name)
          .eq("config_type", config_type)
          .eq("name", name)
          .eq("platform", platform)
          .limit(1);

        if (existing?.length) {
          const { error } = await supabase
            .from("environment_configs")
            .update({
              version: version || undefined,
              config_content: config_content || undefined,
              install_command: install_command || undefined,
              priority,
              metadata: metadata || undefined,
            })
            .eq("id", existing[0].id);

          if (error) {
            return {
              content: [{ type: "text" as const, text: `Failed to update config: ${error.message}` }],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Updated config in "${environment_name}": ${name} (${config_type}, platform: ${platform})`,
              },
            ],
          };
        }

        const { error } = await supabase.from("environment_configs").insert({
          environment_name,
          config_type,
          name,
          version: version || null,
          config_content: config_content || null,
          install_command: install_command || null,
          platform,
          priority,
          metadata: metadata || {},
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to save config: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Saved config in "${environment_name}": ${name} (${config_type}, platform: ${platform}, priority: ${priority})`,
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
    "get_environment",
    {
      title: "Get Environment Configs",
      description:
        "Retrieve stored environment configs. Optionally filter by environment_name, config_type, and/or platform. " +
        "When called WITHOUT environment_name, returns a summary of ALL named environments (with item counts). " +
        "When called WITH environment_name, returns the full config list for that environment. " +
        "If the user asks about their setup on a specific OS, filter by that platform plus 'all' (cross-platform items). " +
        "Ask the user which environment they mean if it's ambiguous.",
      inputSchema: {
        environment_name: z.string().optional().describe(
          "Name of the environment to retrieve. Omit to list all environments."
        ),
        config_type: z.enum(["shell", "editor", "extension", "package", "dotfile", "system"]).optional(),
        platform: z.enum(["linux", "macos", "windows", "all"]).optional(),
      },
    },
    async ({ environment_name, config_type, platform }) => {
      try {
        // If no environment specified, return a summary of all environments
        if (!environment_name) {
          const { data, error } = await supabase
            .from("environment_configs")
            .select("environment_name, platform");

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
                  text: "No environments stored yet. Use save_config to add configs for a named environment " +
                    "(e.g., your machine hostname or a descriptive name like 'windows-desktop').",
                },
              ],
            };
          }

          // Group by environment_name
          const envs: Record<string, { count: number; platforms: Set<string> }> = {};
          for (const row of data) {
            const env = row.environment_name;
            if (!envs[env]) envs[env] = { count: 0, platforms: new Set() };
            envs[env].count++;
            envs[env].platforms.add(row.platform);
          }

          const lines = Object.entries(envs).map(
            ([env, info]) =>
              `  • ${env}: ${info.count} config(s), platforms: ${[...info.platforms].join(", ")}`
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `${Object.keys(envs).length} environment(s):\n\n${lines.join("\n")}\n\n` +
                  "Use get_environment with a specific environment_name to see its full config.",
              },
            ],
          };
        }

        // Fetch configs for a specific environment
        let q = supabase
          .from("environment_configs")
          .select("*")
          .eq("environment_name", environment_name)
          .order("config_type")
          .order("priority", { ascending: true });

        if (config_type) q = q.eq("config_type", config_type);
        if (platform) q = q.or(`platform.eq.${platform},platform.eq.all`);

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
                text: `No configs found for environment "${environment_name}". Use save_config to add tools, packages, and dotfiles.`,
              },
            ],
          };
        }

        // Group by type
        const grouped: Record<string, string[]> = {};
        for (const c of data) {
          const t = c.config_type;
          if (!grouped[t]) grouped[t] = [];
          const parts = [`  • ${c.name}`];
          if (c.version) parts[0] += ` v${c.version}`;
          parts[0] += ` (platform: ${c.platform}, priority: ${c.priority})`;
          if (c.install_command) parts.push(`    Install: ${c.install_command}`);
          if (c.config_content)
            parts.push(
              `    Content: ${c.config_content.length} chars${c.metadata?.target_path ? ` → ${c.metadata.target_path}` : ""}`
            );
          grouped[t].push(parts.join("\n"));
        }

        const lines = Object.entries(grouped).map(
          ([t, items]) => `[${t}] (${items.length})\n${items.join("\n")}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Environment "${environment_name}" — ${data.length} config(s):\n\n${lines.join("\n\n")}`,
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
    "export_bootstrap",
    {
      title: "Export Bootstrap Script",
      description:
        "Generate a bootstrap script from a named environment's configs. Requires environment_name and platform. " +
        "The script installs packages in priority order, writes dotfile contents to target paths, and runs install commands. " +
        "This is how you replicate one machine's setup onto another. Review the generated script with the user before they run it. " +
        "Uses platform-appropriate package managers (apt/brew/choco/winget) and handles path differences.",
      inputSchema: {
        environment_name: z.string().describe("Name of the environment to export"),
        format: z.enum(["shell"]).default("shell").describe("Script format (shell for now)"),
        platform: z.enum(["linux", "macos", "windows"]).describe("Target platform"),
      },
    },
    async ({ environment_name, platform }) => {
      try {
        const { data, error } = await supabase
          .from("environment_configs")
          .select("*")
          .eq("environment_name", environment_name)
          .or(`platform.eq.${platform},platform.eq.all`)
          .order("priority", { ascending: true });

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
                text: `No configs found for environment "${environment_name}" on platform "${platform}". ` +
                  "Use save_config to add tools and dotfiles first.",
              },
            ],
          };
        }

        const isWindows = platform === "windows";
        const shebang = isWindows
          ? "# PowerShell bootstrap script"
          : "#!/usr/bin/env bash\nset -euo pipefail";
        const lines: string[] = [
          shebang,
          `# Generated by open-brain-wizard`,
          `# Environment: ${environment_name} | Platform: ${platform} | ${data.length} config items`,
          `# Review this script before running!`,
          "",
        ];

        // Install commands
        const installable = data.filter((c) => c.install_command);
        if (installable.length) {
          lines.push("# ── Package Installation ──────────────────────");
          for (const c of installable) {
            lines.push(`# ${c.name}${c.version ? ` v${c.version}` : ""} (${c.config_type})`);
            lines.push(c.install_command);
            lines.push("");
          }
        }

        // Dotfiles
        const dotfiles = data.filter((c) => c.config_content && c.metadata?.target_path);
        if (dotfiles.length) {
          lines.push("# ── Dotfile Configuration ─────────────────────");
          for (const c of dotfiles) {
            const target = c.metadata.target_path;
            if (isWindows) {
              lines.push(`# ${c.name} → ${target}`);
              const winPath = (target as string).replace(/^~/, "$env:USERPROFILE");
              lines.push(`$parentDir = Split-Path -Parent "${winPath}"`);
              lines.push(`if (!(Test-Path $parentDir)) { New-Item -ItemType Directory -Path $parentDir -Force }`);
              lines.push(`@'\n${c.config_content}\n'@ | Set-Content -Path "${winPath}"`);
            } else {
              lines.push(`# ${c.name} → ${target}`);
              lines.push(`mkdir -p "$(dirname "${target}")"`);
              lines.push(`cat > "${target}" << 'DOTFILE_EOF'`);
              lines.push(c.config_content);
              lines.push("DOTFILE_EOF");
            }
            lines.push("");
          }
        }

        lines.push(`echo "Bootstrap complete! ${installable.length} packages installed, ${dotfiles.length} dotfiles written."`);

        const script = lines.join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Generated bootstrap script for "${environment_name}" (${platform}, ${data.length} items):\n\n\`\`\`${isWindows ? "powershell" : "bash"}\n${script}\n\`\`\`\n\nReview this script carefully before running. It will install ${installable.length} packages and write ${dotfiles.length} dotfiles.`,
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
    "list_environments",
    {
      title: "List Environments",
      description:
        "List all named environments with their config counts and platforms. " +
        "Use this to quickly see what environments have been captured. " +
        "Equivalent to calling get_environment without an environment_name.",
      inputSchema: {},
    },
    async () => {
      try {
        const { data, error } = await supabase
          .from("environment_configs")
          .select("environment_name, config_type, platform");

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
                text: "No environments stored yet. Use save_config to capture an environment — " +
                  "name it after the machine hostname or a descriptive label (e.g., 'windows-desktop', 'macbook-pro').",
              },
            ],
          };
        }

        const envs: Record<string, { count: number; platforms: Set<string>; types: Set<string> }> = {};
        for (const row of data) {
          const env = row.environment_name;
          if (!envs[env]) envs[env] = { count: 0, platforms: new Set(), types: new Set() };
          envs[env].count++;
          envs[env].platforms.add(row.platform);
          envs[env].types.add(row.config_type);
        }

        const lines = Object.entries(envs).map(
          ([env, info]) =>
            `  • ${env}\n    ${info.count} config(s) | platforms: ${[...info.platforms].join(", ")} | types: ${[...info.types].join(", ")}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `${Object.keys(envs).length} environment(s):\n\n${lines.join("\n\n")}`,
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
