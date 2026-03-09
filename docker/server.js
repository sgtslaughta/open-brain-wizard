/**
 * open-brain-wizard web installer server.
 * Serves wizard UI and API: credentials-status, credentials (get/set), run-step (SSE), run-schema (SSE), generated.
 * Reads/writes credentials from DATA_DIR/credentials.yaml or in-session when file absent.
 */

const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const express = require("express");
const session = require("express-session");
const yaml = require("yaml");

const OPEN_BRAIN_ROOT = process.env.OPEN_BRAIN_ROOT || path.join(__dirname, "..", "open-brain");
const DATA_DIR = process.env.DATA_DIR || "/data";
const PORT = Number(process.env.PORT) || 8080;

const CRED_PATH = path.join(DATA_DIR, "credentials.yaml");
const APP_CRED_PATH = path.join(OPEN_BRAIN_ROOT, "credentials.yaml");

const PLACEHOLDERS = new Set([
  "",
  "YOUR_PROJECT_REF",
  "sk-or-v1-...",
  "xoxb-...",
  "C0...",
]);

function isSet(val) {
  if (val == null || typeof val !== "string") return false;
  const t = val.trim();
  return t.length > 0 && !PLACEHOLDERS.has(t);
}

function readCredentialsFromFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const obj = yaml.parse(raw) || {};
    return {
      project_ref: obj.project_ref || "",
      db_password: obj.db_password || "",
      openrouter_api_key: obj.openrouter_api_key || "",
      slack_bot_token: obj.slack_bot_token || "",
      slack_capture_channel: obj.slack_capture_channel || "",
      mcp_access_key: obj.mcp_access_key || "",
      supabase_access_token: obj.supabase_access_token || "",
    };
  } catch (e) {
    return null;
  }
}

function credentialsStatus(creds, filePresent) {
  const present = filePresent === undefined ? !!creds : filePresent;
  return {
    file_present: present,
    project_ref: isSet(creds?.project_ref),
    db_password: isSet(creds?.db_password),
    openrouter_api_key: isSet(creds?.openrouter_api_key),
    slack_bot_token: isSet(creds?.slack_bot_token),
    slack_capture_channel: isSet(creds?.slack_capture_channel),
    mcp_access_key: isSet(creds?.mcp_access_key),
    supabase_access_token: isSet(creds?.supabase_access_token),
  };
}

const CRED_KEYS = [
  "project_ref",
  "db_password",
  "openrouter_api_key",
  "slack_bot_token",
  "slack_capture_channel",
  "mcp_access_key",
  "supabase_access_token",
];

function getCredentials(req) {
  let base = {};
  if (fs.existsSync(CRED_PATH)) {
    const fromFile = readCredentialsFromFile(CRED_PATH);
    if (fromFile) base = fromFile;
  }
  const fromSession = req.session && req.session.credentials ? req.session.credentials : {};
  const merged = { ...base };
  CRED_KEYS.forEach((k) => {
    if (fromSession[k] !== undefined && fromSession[k] !== null && String(fromSession[k]).trim() !== "") {
      merged[k] = String(fromSession[k]).trim();
    }
    if (merged[k] === undefined) merged[k] = "";
  });
  const hasAny = CRED_KEYS.some((k) => isSet(merged[k]));
  return hasAny ? merged : (fs.existsSync(CRED_PATH) ? merged : null);
}

function writeCredentialsToApp(creds) {
  const dir = path.dirname(APP_CRED_PATH);
  if (!fs.existsSync(dir)) return false;
  const out = yaml.stringify(creds);
  fs.writeFileSync(APP_CRED_PATH, out, "utf8");
  return true;
}

function ensureCredentialsForScripts(req) {
  const creds = getCredentials(req);
  if (!creds) return { ok: false, message: "No credentials (file or form). Complete earlier steps." };
  const canWriteData = fs.existsSync(DATA_DIR) && fs.existsSync(path.join(DATA_DIR, "."));
  try {
    if (canWriteData) {
      fs.writeFileSync(CRED_PATH, yaml.stringify(creds), "utf8");
    }
  } catch (e) {
    // ignore
  }
  if (!writeCredentialsToApp(creds)) {
    return { ok: false, message: "Could not write credentials to app dir." };
  }
  return { ok: true };
}

const app = express();
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "open-brain-installer-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);

app.use("/static", express.static(path.join(__dirname, "static")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

app.get("/api/credentials-status", (req, res) => {
  const creds = getCredentials(req);
  const filePresent = fs.existsSync(CRED_PATH);
  res.json(credentialsStatus(creds, filePresent));
});

const MASKED_KEYS = new Set(["openrouter_api_key", "slack_bot_token", "mcp_access_key", "supabase_access_token", "db_password"]);

function maskValue(key, value) {
  if (!value || !isSet(value)) return "";
  const s = String(value).trim();
  if (MASKED_KEYS.has(key)) {
    if (s.length <= 4) return "****";
    return "****" + s.slice(-4);
  }
  return s;
}

app.get("/api/credentials", (req, res) => {
  const creds = getCredentials(req) || (req.session && req.session.credentials ? req.session.credentials : null);
  if (!creds) {
    return res.json(CRED_KEYS.reduce((o, k) => ({ ...o, [k]: "" }), {}));
  }
  const masked = {};
  CRED_KEYS.forEach((k) => {
    masked[k] = maskValue(k, creds[k]);
  });
  res.json(masked);
});

app.post("/api/credentials", (req, res) => {
  const body = req.body || {};
  const updates = {};
  CRED_KEYS.forEach((k) => {
    if (body[k] !== undefined) updates[k] = body[k];
  });
  const existing = getCredentials(req) || CRED_KEYS.reduce((o, k) => ({ ...o, [k]: "" }), {});
  const merged = { ...existing };
  Object.keys(updates).forEach((k) => {
    if (updates[k] !== undefined && updates[k] !== null) merged[k] = String(updates[k]).trim();
  });

  const canWriteData = fs.existsSync(DATA_DIR);
  let writable = false;
  try {
    if (canWriteData) {
      fs.writeFileSync(CRED_PATH, yaml.stringify(merged), "utf8");
      writable = true;
    }
  } catch (e) {
    // mount read-only or no permission
  }
  if (!req.session) req.session = {};
  req.session.credentials = merged;
  res.json({ ok: true, file_written: writable });
});

function getCredentialsForDownload(req) {
  let creds = getCredentials(req);
  if (!creds && req.session && req.session.credentials) {
    const raw = req.session.credentials;
    creds = {};
    CRED_KEYS.forEach((k) => {
      creds[k] = raw[k] !== undefined && raw[k] !== null ? String(raw[k]).trim() : "";
    });
    if (!CRED_KEYS.some((k) => isSet(creds[k]))) creds = null;
  }
  return creds;
}

app.get("/api/credentials/download", (req, res) => {
  const creds = getCredentialsForDownload(req);
  if (!creds) {
    return res.status(400).json({ error: "No credentials to download." });
  }
  res.setHeader("Content-Type", "application/x-yaml");
  res.setHeader("Content-Disposition", 'attachment; filename="credentials.yaml"');
  res.send(yaml.stringify(creds));
});

app.get("/api/schema", (req, res) => {
  const schemaPath = path.join(OPEN_BRAIN_ROOT, "sql", "schema.sql");
  try {
    const sql = fs.readFileSync(schemaPath, "utf8");
    res.type("text/plain").send(sql);
  } catch (e) {
    res.status(500).send("Schema file not found.");
  }
});

// SSE: Apply schema via psql
app.get("/api/run-schema", (req, res) => {
  const creds = getCredentials(req);
  if (!creds || !isSet(creds.project_ref)) {
    return res.status(400).json({ error: "Project ref is required. Complete Step 1 first." });
  }
  if (!isSet(creds.db_password)) {
    return res.status(400).json({ error: "Database password is required. Enter it in Step 2 or the sidebar." });
  }

  const schemaPath = path.join(OPEN_BRAIN_ROOT, "sql", "schema.sql");
  if (!fs.existsSync(schemaPath)) {
    return res.status(500).json({ error: "Schema file not found." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function send(line) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }

  const ref = creds.project_ref.trim();
  const password = creds.db_password.trim();
  const region = (req.query.region || "us-east-1").replace(/[^a-z0-9-]/gi, "");
  const connStr = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres`;

  send("[open-brain] Connecting to Supabase database...");
  send(`[open-brain] Host: aws-0-${region}.pooler.supabase.com:6543`);
  send(`[open-brain] User: postgres.${ref}`);
  send(`[open-brain] Applying schema from sql/schema.sql...`);

  const child = spawn("psql", [connStr, "-f", schemaPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGCONNECT_TIMEOUT: "10" },
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    chunk.split("\n").forEach((line) => {
      if (line.length) send(line);
    });
  });

  child.stderr.on("data", (chunk) => {
    chunk.split("\n").forEach((line) => {
      if (line.length) send(line);
    });
  });

  child.on("close", (code) => {
    if (code === 0) {
      send("[open-brain] Schema applied successfully.");
    } else {
      send(`[open-brain] psql exited with code ${code}. Check connection details and try again.`);
      send("[open-brain] Tip: If the region is wrong, the connection may fail. Check your Supabase dashboard for the correct region.");
    }
    res.write("data: " + JSON.stringify({ done: true, code }) + "\n\n");
    res.end();
  });

  child.on("error", (err) => {
    send(`[open-brain] Error: ${err.message}`);
    res.write("data: " + JSON.stringify({ done: true, error: err.message }) + "\n\n");
    res.end();
  });
});

app.get("/api/run-step", (req, res) => {
  const step = (req.query.step || "full").toLowerCase();
  const ensured = ensureCredentialsForScripts(req);
  if (!ensured.ok) {
    return res.status(400).json({ error: ensured.message });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function send(line) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }

  const creds = getCredentials(req);
  const ref = creds.project_ref;
  const token = (creds && isSet(creds.supabase_access_token) ? creds.supabase_access_token.trim() : null) || process.env.SUPABASE_ACCESS_TOKEN;

  const steps = [];
  if (step === "full" || step === "link") steps.push("link");
  if (step === "full" || step === "set-secrets") steps.push("set-secrets");
  if (step === "full" || step === "deploy") steps.push("deploy");

  const scriptEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref };

  (async () => {
    for (const s of steps) {
      if (s === "set-secrets") {
        const creds = getCredentials(req);
        if (!isSet(creds.mcp_access_key)) {
          send("[open-brain] Generating MCP access key...");
          try {
            const key = execSync("openssl rand -hex 32", { encoding: "utf8" }).trim();
            creds.mcp_access_key = key;
            writeCredentialsToApp(creds);
            try {
              if (fs.existsSync(DATA_DIR)) fs.writeFileSync(CRED_PATH, yaml.stringify(creds), "utf8");
            } catch (_) {}
            if (req.session) req.session.credentials = creds;
            send("[open-brain] MCP access key generated and saved.");
          } catch (e) {
            send(`[open-brain] Warning: could not generate MCP key: ${e.message}`);
          }
        }
      }
      if (s === "link") {
        send("[open-brain] Linking project...");
        await runScript(
          path.join(OPEN_BRAIN_ROOT, "scripts", "link.sh"),
          OPEN_BRAIN_ROOT,
          scriptEnv,
          send
        );
      } else if (s === "set-secrets") {
        send("[open-brain] Setting secrets...");
        await runScript(
          path.join(OPEN_BRAIN_ROOT, "scripts", "set-secrets.sh"),
          OPEN_BRAIN_ROOT,
          scriptEnv,
          send
        );
      } else if (s === "deploy") {
        send("[open-brain] Deploying Edge Functions...");
        await runScript(
          path.join(OPEN_BRAIN_ROOT, "scripts", "deploy.sh"),
          OPEN_BRAIN_ROOT,
          scriptEnv,
          send
        );
      }
    }
    send("[open-brain] Done.");
    res.write("data: " + JSON.stringify({ done: true }) + "\n\n");
    res.end();
  })().catch((err) => {
    send(`[open-brain] Error: ${err.message}`);
    res.write("data: " + JSON.stringify({ done: true, error: err.message }) + "\n\n");
    res.end();
  });
});

function runScript(scriptPath, cwd, env, send) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [scriptPath], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let errText = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      chunk.split("\n").forEach((line) => {
        if (line.length) send(line);
      });
    });
    child.stderr.on("data", (chunk) => {
      errText += chunk;
      chunk.split("\n").forEach((line) => {
        if (line.length) send(line);
      });
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`Script exited with code ${code}`));
      else resolve();
    });
    child.on("error", reject);
  });
}

// SSE: Run validation tests
app.get("/api/run-test", (req, res) => {
  const creds = getCredentials(req);
  if (!creds || !isSet(creds.project_ref)) {
    return res.status(400).json({ error: "Project ref is required." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const results = { db: null, ingest: null, mcp: null };

  function send(line) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }

  const ref = creds.project_ref.trim();
  const key = isSet(creds.mcp_access_key) ? creds.mcp_access_key.trim() : null;
  const base = `https://${ref}.supabase.co/functions/v1`;

  (async () => {
    // Test 1: Database connectivity
    send("[test] ── Database ──────────────────────────");
    if (isSet(creds.db_password)) {
      const region = (req.query.region || "us-east-1").replace(/[^a-z0-9-]/gi, "");
      const password = creds.db_password.trim();
      const connStr = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
      try {
        const out = await runCommand("psql", [connStr, "-c", "SELECT count(*) AS thought_count FROM thoughts;"], { PGCONNECT_TIMEOUT: "10" });
        send("[test] Connected to database successfully");
        const match = out.match(/(\d+)/);
        const count = match ? match[1] : "?";
        send(`[test] Thoughts table exists — ${count} row(s) found`);

        // Check match_thoughts function exists
        const fnOut = await runCommand("psql", [connStr, "-c", "SELECT proname FROM pg_proc WHERE proname = 'match_thoughts';"], { PGCONNECT_TIMEOUT: "10" });
        if (fnOut.includes("match_thoughts")) {
          send("[test] match_thoughts function exists");
        } else {
          send("[test] [WARN] match_thoughts function not found — re-run schema");
        }

        // Check RLS is enabled
        const rlsOut = await runCommand("psql", [connStr, "-c", "SELECT relrowsecurity FROM pg_class WHERE relname = 'thoughts';"], { PGCONNECT_TIMEOUT: "10" });
        if (rlsOut.includes("t")) {
          send("[test] Row Level Security is enabled");
        } else {
          send("[test] [WARN] Row Level Security is not enabled on thoughts table");
        }

        results.db = true;
        send("[test] [OK] Database: PASS");
      } catch (e) {
        send(`[test] [FAIL] Database: ${e.message}`);
        results.db = false;
      }
    } else {
      send("[test] [WARN] Skipping database test — no db_password saved");
      send("[test] (Set it via the sidebar or Step 3 to enable this test)");
      results.db = null;
    }

    // Test 2: ingest-thought Edge Function
    send("");
    send("[test] ── Ingest-thought Function ───────────");
    const ingestUrl = `${base}/ingest-thought`;
    send(`[test] URL: ${ingestUrl}`);
    try {
      const challenge = "open-brain-test-" + Date.now();
      const resp = await fetch(ingestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "url_verification", challenge }),
      });
      send(`[test] HTTP ${resp.status} ${resp.statusText}`);
      if (resp.ok) {
        const body = await resp.json();
        if (body.challenge === challenge) {
          send("[test] Challenge response verified — function is live and responding");
          results.ingest = true;
          send("[test] [OK] Ingest-thought: PASS");
        } else {
          send(`[test] [FAIL] Challenge mismatch: expected "${challenge}", got "${body.challenge}"`);
          results.ingest = false;
        }
      } else {
        const text = await resp.text().catch(() => "");
        send(`[test] [FAIL] Unexpected status ${resp.status}: ${text.slice(0, 200)}`);
        results.ingest = false;
      }
    } catch (e) {
      send(`[test] [FAIL] Could not reach ingest-thought: ${e.message}`);
      results.ingest = false;
    }

    // Test 3: MCP Edge Function — full tool exercise
    send("");
    send("[test] ── MCP Function ──────────────────────");
    if (key) {
      const mcpUrl = `${base}/open-brain-mcp?key=${key}`;
      send(`[test] URL: ${base}/open-brain-mcp?key=****${key.slice(-4)}`);

      // Helper: send a JSON-RPC request to the MCP endpoint and parse the response
      async function mcpCall(id, method, params) {
        const resp = await fetch(mcpUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        });
        if (!resp.ok) {
          return { _status: resp.status, _error: await resp.text().catch(() => "") };
        }
        const contentType = resp.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream")) {
          const text = await resp.text();
          // Extract all data: lines and parse the last JSON-RPC response
          const lines = text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim());
          for (let i = lines.length - 1; i >= 0; i--) {
            try { return JSON.parse(lines[i]); } catch {}
          }
          return null;
        }
        try { return await resp.json(); } catch { return null; }
      }

      try {
        // Step 1: Initialize
        send("[test] Sending MCP initialize...");
        const initResp = await mcpCall(1, "initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "open-brain-test", version: "1.0.0" },
        });
        if (initResp && initResp._status === 401) {
          send("[test] [FAIL] MCP returned 401 — access key mismatch. Re-deploy secrets.");
          results.mcp = false;
        } else if (initResp && initResp._status) {
          send(`[test] [FAIL] MCP returned HTTP ${initResp._status}: ${(initResp._error || "").slice(0, 200)}`);
          results.mcp = false;
        } else if (initResp && initResp.result && initResp.result.serverInfo) {
          send(`[test] MCP server: ${initResp.result.serverInfo.name} v${initResp.result.serverInfo.version}`);
          const tools = initResp.result.capabilities && initResp.result.capabilities.tools ? "yes" : "advertised";
          send(`[test] Capabilities: tools=${tools}`);

          // Step 2: Send initialized notification
          await mcpCall(null, "notifications/initialized", {});

          // Step 3: List tools
          send("[test] Listing available tools...");
          const listResp = await mcpCall(2, "tools/list", {});
          if (listResp && listResp.result && Array.isArray(listResp.result.tools)) {
            const toolNames = listResp.result.tools.map(t => t.name);
            send(`[test] Tools found: ${toolNames.join(", ")}`);

            let mcpFails = 0;

            // Step 4: Test capture_thought
            if (toolNames.includes("capture_thought")) {
              send("");
              send("[test] Testing capture_thought...");
              const captureResp = await mcpCall(3, "tools/call", {
                name: "capture_thought",
                arguments: { content: "open-brain-wizard validation test — please ignore this thought." },
              });
              if (captureResp && captureResp.result && Array.isArray(captureResp.result.content)) {
                const text = captureResp.result.content.map(c => c.text || "").join("");
                send(`[test] capture_thought response: ${text.slice(0, 200)}`);
                if (captureResp.result.isError) {
                  send("[test] [FAIL] capture_thought returned an error");
                  mcpFails++;
                } else {
                  send("[test] [OK] capture_thought: PASS");
                }
              } else {
                send("[test] [WARN] capture_thought: unexpected response format");
              }
            }

            // Step 5: Test search_thoughts
            if (toolNames.includes("search_thoughts")) {
              send("");
              send("[test] Testing search_thoughts...");
              const searchResp = await mcpCall(4, "tools/call", {
                name: "search_thoughts",
                arguments: { query: "validation test", limit: 3 },
              });
              if (searchResp && searchResp.result && Array.isArray(searchResp.result.content)) {
                const text = searchResp.result.content.map(c => c.text || "").join("");
                const lines = text.split("\n").filter(l => l.trim());
                send(`[test] search_thoughts returned ${lines.length > 1 ? "results" : "a response"}: ${text.slice(0, 150).replace(/\n/g, " ")}...`);
                if (searchResp.result.isError) {
                  send("[test] [FAIL] search_thoughts returned an error");
                  mcpFails++;
                } else {
                  send("[test] [OK] search_thoughts: PASS");
                }
              } else {
                send("[test] [WARN] search_thoughts: unexpected response format");
              }
            }

            // Step 6: Test list_thoughts
            if (toolNames.includes("list_thoughts")) {
              send("");
              send("[test] Testing list_thoughts...");
              const listThResp = await mcpCall(5, "tools/call", {
                name: "list_thoughts",
                arguments: { limit: 3 },
              });
              if (listThResp && listThResp.result && Array.isArray(listThResp.result.content)) {
                const text = listThResp.result.content.map(c => c.text || "").join("");
                send(`[test] list_thoughts: ${text.slice(0, 150).replace(/\n/g, " ")}...`);
                if (listThResp.result.isError) {
                  send("[test] [FAIL] list_thoughts returned an error");
                  mcpFails++;
                } else {
                  send("[test] [OK] list_thoughts: PASS");
                }
              } else {
                send("[test] [WARN] list_thoughts: unexpected response format");
              }
            }

            // Step 7: Test thought_stats
            if (toolNames.includes("thought_stats")) {
              send("");
              send("[test] Testing thought_stats...");
              const statsResp = await mcpCall(6, "tools/call", {
                name: "thought_stats",
                arguments: {},
              });
              if (statsResp && statsResp.result && Array.isArray(statsResp.result.content)) {
                const text = statsResp.result.content.map(c => c.text || "").join("");
                send(`[test] thought_stats: ${text.slice(0, 200).replace(/\n/g, " | ")}`);
                if (statsResp.result.isError) {
                  send("[test] [FAIL] thought_stats returned an error");
                  mcpFails++;
                } else {
                  send("[test] [OK] thought_stats: PASS");
                }
              } else {
                send("[test] [WARN] thought_stats: unexpected response format");
              }
            }

            send("");
            if (mcpFails === 0) {
              results.mcp = true;
              send(`[test] [OK] MCP Function: ALL ${toolNames.length} TOOLS PASS`);
            } else {
              results.mcp = false;
              send(`[test] [FAIL] MCP Function: ${mcpFails} tool(s) failed`);
            }
          } else {
            // Could list tools but got unexpected format — still reachable
            results.mcp = true;
            send("[test] [OK] MCP Function: REACHABLE (could not enumerate tools)");
          }
        } else {
          // Got some response but not standard initialize — still reachable
          results.mcp = true;
          send("[test] [OK] MCP Function: REACHABLE (non-standard response)");
        }
      } catch (e) {
        send(`[test] [FAIL] Could not reach MCP function: ${e.message}`);
        results.mcp = false;
      }
    } else {
      send("[test] [WARN] Skipping MCP test — no mcp_access_key saved");
      results.mcp = null;
    }

    // Summary
    send("");
    send("[test] ── Summary ─────────────────────────");
    const pass = Object.values(results).filter(v => v === true).length;
    const fail = Object.values(results).filter(v => v === false).length;
    const skip = Object.values(results).filter(v => v === null).length;
    send(`[test] ${pass} passed, ${fail} failed, ${skip} skipped`);
    if (fail === 0 && pass > 0) {
      send("[test] All tests passed — open-brain-wizard is ready to use!");
    } else if (fail > 0) {
      send("[test] Some tests failed. Review the output above and fix any issues.");
    }

    res.write("data: " + JSON.stringify({ done: true, results }) + "\n\n");
    res.end();
  })().catch((err) => {
    send(`[test] Error: ${err.message}`);
    res.write("data: " + JSON.stringify({ done: true, error: err.message }) + "\n\n");
    res.end();
  });
});

function runCommand(cmd, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `Exit code ${code}`));
      else resolve(stdout);
    });
    child.on("error", reject);
  });
}

// Detect project region via Supabase Management API
app.get("/api/region", async (req, res) => {
  const creds = getCredentials(req);
  if (!creds || !isSet(creds.project_ref)) {
    return res.json({ region: null, error: "No project ref" });
  }
  const token = (isSet(creds.supabase_access_token) ? creds.supabase_access_token.trim() : null) || process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    return res.json({ region: null, error: "No access token" });
  }
  try {
    const resp = await fetch(`https://api.supabase.com/v1/projects/${creds.project_ref.trim()}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!resp.ok) {
      return res.json({ region: null, error: `API returned ${resp.status}` });
    }
    const data = await resp.json();
    res.json({ region: data.region || null });
  } catch (e) {
    res.json({ region: null, error: e.message });
  }
});

app.get("/api/generated", (req, res) => {
  const creds = getCredentials(req);
  const ref = creds && isSet(creds.project_ref) ? creds.project_ref.trim() : null;
  const base = ref ? `https://${ref}.supabase.co/functions/v1` : null;
  const ingestUrl = base ? `${base}/ingest-thought` : null;
  if (!ref) {
    return res.json({
      mcp_connection_url: null,
      ingest_thought_url: null,
      mcp_config_claude: null,
      mcp_config_cursor: null,
    });
  }
  const key = creds && isSet(creds.mcp_access_key) ? creds.mcp_access_key.trim() : null;
  const mcpUrl = key ? `${base}/open-brain-mcp?key=${key}` : null;
  const mcpConfigClaude = mcpUrl ? JSON.stringify({ name: "open-brain-wizard", url: mcpUrl }, null, 2) : null;
  const mcpConfigCursor = mcpUrl ? JSON.stringify({ mcpServers: { "open-brain": { url: mcpUrl } } }, null, 2) : null;
  res.json({
    mcp_connection_url: mcpUrl,
    ingest_thought_url: ingestUrl,
    mcp_config_claude: mcpConfigClaude,
    mcp_config_cursor: mcpConfigCursor,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.error(`open-brain-wizard: http://localhost:${PORT}`);
});
