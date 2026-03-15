/**
 * Server-side sensitive data scanner.
 * Defense-in-depth: runs on all content fields before insertion.
 * The LLM should also scan before calling tools, but this catches what the model misses.
 */

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Common API key prefixes
  { pattern: /\bsk-[a-zA-Z0-9]{20,}/g, label: "OpenAI-style API key (sk-...)" },
  { pattern: /\bghp_[a-zA-Z0-9]{36,}/g, label: "GitHub personal access token (ghp_...)" },
  { pattern: /\bgho_[a-zA-Z0-9]{36,}/g, label: "GitHub OAuth token (gho_...)" },
  { pattern: /\bghu_[a-zA-Z0-9]{36,}/g, label: "GitHub user token (ghu_...)" },
  { pattern: /\bghs_[a-zA-Z0-9]{36,}/g, label: "GitHub server token (ghs_...)" },
  { pattern: /\bglpat-[a-zA-Z0-9\-_]{20,}/g, label: "GitLab personal access token (glpat-...)" },
  { pattern: /\bAKIA[A-Z0-9]{16}/g, label: "AWS access key ID (AKIA...)" },
  { pattern: /\bxox[bpras]-[a-zA-Z0-9\-]{10,}/g, label: "Slack token (xox-...)" },
  { pattern: /\bBearer\s+[a-zA-Z0-9\-_.]{20,}/g, label: "Bearer token" },

  // Connection strings with embedded passwords
  {
    pattern: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:]+:[^@\s]{3,}@[^\s]+/gi,
    label: "Database connection string with embedded password",
  },

  // Generic key=value patterns for secrets
  {
    pattern: /(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key|auth[_-]?token|api[_-]?secret|client[_-]?secret)\s*[:=]\s*['"]?[a-zA-Z0-9\-_.\/+]{16,}['"]?/gi,
    label: "Key-value pair with potential secret",
  },

  // Password in key=value
  {
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
    label: "Password in key-value pair",
  },

  // Private keys (PEM format)
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, label: "Private key (PEM format)" },

  // .env file lines with secrets
  {
    pattern: /^[A-Z_]{2,}(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH)\s*=\s*\S{8,}/gm,
    label: "Environment variable with potential secret",
  },
];

export interface ScanResult {
  hasSensitiveData: boolean;
  matches: Array<{ label: string; snippet: string }>;
}

/**
 * Scan a string for potential sensitive data.
 * Returns matches with labels and redacted snippets.
 */
export function scanForSensitiveData(...texts: (string | null | undefined)[]): ScanResult {
  const matches: Array<{ label: string; snippet: string }> = [];
  const seen = new Set<string>();

  for (const text of texts) {
    if (!text) continue;
    for (const { pattern, label } of SENSITIVE_PATTERNS) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const raw = match[0];
        // Deduplicate by label + first 10 chars
        const dedupeKey = `${label}:${raw.slice(0, 10)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        // Show first 6 and last 4 chars, mask the middle
        const snippet =
          raw.length > 16
            ? raw.slice(0, 6) + "****" + raw.slice(-4)
            : raw.slice(0, 4) + "****";
        matches.push({ label, snippet });
      }
    }
  }

  return {
    hasSensitiveData: matches.length > 0,
    matches,
  };
}

/**
 * Build a warning response for MCP tools when sensitive data is detected.
 */
export function sensitiveDataWarning(scan: ScanResult): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const details = scan.matches
    .map((m) => `  - ${m.label}: ${m.snippet}`)
    .join("\n");
  return {
    content: [
      {
        type: "text" as const,
        text:
          `⚠️ POTENTIAL SENSITIVE DATA DETECTED — storage blocked.\n\n` +
          `The following patterns were found in the content you tried to store:\n${details}\n\n` +
          `Storing secrets in the brain makes them permanently retrievable across all sessions and devices.\n\n` +
          `Please ask the user to confirm one of these options:\n` +
          `(a) Remove or redact the sensitive parts and retry\n` +
          `(b) Replace secrets with reference placeholders (e.g., "API key stored in ~/.env")\n` +
          `(c) Confirm this is a false positive and retry with force_store=true to bypass this check`,
      },
    ],
    isError: true,
  };
}
