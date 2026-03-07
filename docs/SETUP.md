# open-brain-wizard: Full Setup Guide

![open-brain-wizard](../media/ob.png)

Step-by-step setup for Capture (Slack to Supabase) and Retrieval (MCP server). Copy `credentials.yaml.template` to `credentials.yaml` and fill in the placeholders; the scripts (link, set-secrets) read from `credentials.yaml`. Never commit `credentials.yaml` or `.credentials`.

**Alternative: Docker installer.** You can use the bundled Docker image and web wizard instead of running scripts by hand: see the [Docker install section in the README](../README.md#option-a-docker-installer-recommended). The wizard guides you from registration through deploy and shows the generated MCP config.

**Time:** About 45 minutes.

---

## Part 1 — Capture (Slack to Supabase)

### Step 1: Create Supabase project

1. Go to [supabase.com](https://supabase.com), sign up (e.g. GitHub).
2. New Project → set name (e.g. open-brain), set Database password (store in `.credentials`), choose region, Create.
3. Copy the **Project ref** from the dashboard URL: `supabase.com/dashboard/project/THIS_PART` → into `credentials.yaml` (and optionally `.credentials`).

### Step 2: Database schema

1. In Supabase: **Database → Extensions** → enable **vector** (pgvector).
2. **SQL Editor → New query** → open `sql/schema.sql` from this repo, paste its contents, Run.  
   This creates the `thoughts` table, `match_thoughts` function, and RLS.
3. In **Table Editor** confirm `thoughts` exists; in **Database → Functions** confirm `match_thoughts`.

### Step 3: Supabase API details

**Settings (gear) → API.** Copy **Project URL** and **Secret key** (Service role key) into your tracker if you use `.credentials`; the scripts only need values that go into `credentials.yaml` (project_ref and secrets pushed by set-secrets).

### Step 4: OpenRouter API key

1. [openrouter.ai](https://openrouter.ai) → sign up → [openrouter.ai/keys](https://openrouter.ai/keys).
2. Create Key (e.g. name: open-brain), copy to `credentials.yaml` as `openrouter_api_key`.
3. Add credits (e.g. $5) so embeddings and metadata extraction work.

### Step 5: Slack capture channel

1. Create or use a Slack workspace ([slack.com](https://slack.com)).
2. Create a channel (e.g. "capture", "brain"). **Make it Private** (recommended).
3. Right-click channel → **View channel details** → copy the **Channel ID** (starts with `C`) into `credentials.yaml` as `slack_capture_channel`.

### Step 6: Slack app

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch → name (e.g. open-brain-wizard), pick workspace.
2. **OAuth & Permissions** → **Bot Token Scopes** → add: `channels:history`, `groups:history`, `chat:write`.
3. **Install to Workspace** → Allow → copy **Bot User OAuth Token** (starts with `xoxb-`) into `credentials.yaml` as `slack_bot_token`.
4. **Invite the bot to your capture channel:** In that channel type: `/invite @open-brain-wizard` (use your app name). **Required for private channels** — otherwise the bot never sees messages and nothing is stored.

Do **not** configure Event Subscriptions yet; you need the Edge Function URL first.

### Step 7: Install CLI, link, deploy ingest-thought

1. **Install prerequisites:**  
   - Windows: `.\scripts\install.ps1`  
   - Linux/Mac: `./scripts/install.sh`
2. **Log in:** `supabase login`
3. **Link project:**  
   - Windows: `.\scripts\link.ps1`  
   - Linux/Mac: `./scripts/link.sh`  
   The script uses `project_ref` from `credentials.yaml` if present. If link hangs, set `SUPABASE_ACCESS_TOKEN` (create at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)); see [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).
4. **Set secrets:**  
   - **From credentials.yaml:** run `.\scripts\set-secrets.ps1` or `./scripts/set-secrets.sh` to push all secrets from your filled-in `credentials.yaml` to Supabase.  
   - **Or manually:**  
     `supabase secrets set OPENROUTER_API_KEY=...`  
     `supabase secrets set SLACK_BOT_TOKEN=...`  
     `supabase secrets set SLACK_CAPTURE_CHANNEL=...`  
     (Add `MCP_ACCESS_KEY` in Part 2.)

5. **Deploy:**  
   - Windows: `.\scripts\deploy.ps1`  
   - Linux/Mac: `./scripts/deploy.sh`  
   Or: `supabase functions deploy ingest-thought --no-verify-jwt`
6. Copy the **Edge Function URL** (e.g. `https://YOUR_REF.supabase.co/functions/v1/ingest-thought`) into your tracker for Slack Event Subscriptions.

### Step 8: Connect Slack to the function

1. [api.slack.com/apps](https://api.slack.com/apps) → your app → **Event Subscriptions** → **Enable Events** ON.
2. **Request URL:** paste your ingest-thought Edge Function URL → wait for **Verified**.
3. **Subscribe to bot events:** add **message.channels** and **message.groups** (you need both; public channels use the first, private the second).
4. **Save Changes** (reinstall to workspace if prompted).

### Step 9: Test capture

In your Slack capture channel, send a test message. Within a few seconds you should get a threaded confirmation. In Supabase **Table Editor → thoughts** you should see one row. To debug: Supabase dashboard → **Edge Functions → ingest-thought → Logs / Invocations**.

---

## Part 2 — Retrieval (MCP server)

### Step 10: MCP access key

Generate a key and store it in Supabase:

**Linux/Mac:**
```bash
openssl rand -hex 32
```

**Windows (PowerShell):**
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

Copy the value into `credentials.yaml` as `mcp_access_key`, then either run `.\scripts\set-secrets.ps1` or `./scripts/set-secrets.sh` to push it (and any other updated secrets) to Supabase, or run:

```bash
supabase secrets set MCP_ACCESS_KEY=your-generated-key-here
```

### Step 11: Deploy MCP server

The repo already contains `supabase/functions/open-brain-mcp/`. Deploy it:

- Windows: `.\scripts\deploy.ps1` (deploys both functions)  
- Linux/Mac: `./scripts/deploy.sh`  

Or only MCP:

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

MCP Server URL: `https://YOUR_REF.supabase.co/functions/v1/open-brain-mcp`  
MCP Connection URL (for AI clients): same URL + `?key=YOUR_MCP_ACCESS_KEY`. Store both in `.credentials`.

### Step 12: Connect your AI client

Use the **MCP Connection URL** (with `?key=...`) in your AI tool:

- **Claude Desktop:** Settings → Connectors → Add custom connector → Remote MCP server URL = your connection URL.
- **ChatGPT:** Developer Mode on; add connector with MCP endpoint URL = your connection URL.
- **Cursor / Claude Code:** Use the connection URL and `x-brain-key` header if required.

---

## Verify

- Run **doctor:** `.\scripts\doctor.ps1` or `./scripts/doctor.sh` to check CLI, link, and secret names.
- Use **Supabase dashboard → Edge Functions → Logs / Invocations** to confirm Slack is calling ingest-thought.

For more help, see [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).
