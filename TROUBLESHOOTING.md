# open-brain-wizard Troubleshooting

![open-brain-wizard](media/ob.png)

If the suggestions below do not fix the issue, use the Supabase AI assistant (chat icon in the bottom-right of your project dashboard). Paste the error and the step you are on; it can help with Supabase-specific problems.

---

## Setup and CLI

### supabase link hangs

The Supabase CLI can hang when linking if it cannot complete the auth flow. Fix it by using an access token:

1. Create a token at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
2. Set it in your environment, then run link again.

**PowerShell (Windows):**
```powershell
$env:SUPABASE_ACCESS_TOKEN = 'your-token-here'
.\scripts\link.ps1
```

**Bash (Linux / Mac):**
```bash
export SUPABASE_ACCESS_TOKEN='your-token-here'
./scripts/link.sh
```

Then run your link script as usual (or `supabase link --project-ref YOUR_REF`).

---

## Capture (Slack to Supabase)

### Slack says "Request URL not verified"

The ingest-thought Edge Function is not deployed or not reachable. Redeploy:

```bash
supabase functions deploy ingest-thought --no-verify-jwt
```

Copy the function URL from the output and use it in Slack Event Subscriptions.

### Messages are not triggering the function

- **Event Subscriptions:** In your Slack app, under Event Subscriptions, enable both **message.channels** and **message.groups**. Public channels use the first; private channels use the second. If only one is enabled, messages in the other type will not reach your function.
- **Invite the bot to the channel:** If your capture channel is **private**, you must invite the Slack app bot into that channel (e.g. in the channel type: `/invite @open-brain-wizard`). Slack does not add bots to private channels automatically; without this, the bot never sees messages and you get no errors and no rows in Supabase.
- **Channel ID:** Confirm `SLACK_CAPTURE_CHANNEL` in Supabase secrets matches the actual channel ID (right-click channel → View channel details → copy the ID at the bottom).

### Seeing when Slack hits your function

Use the **Supabase web console**: open your project → Edge Functions → select `ingest-thought` → **Logs** or **Invocations**. This shows when Slack sends events and helps debug missing or failed requests.

### Slack creates duplicate database entries

Slack retries webhook delivery if the response takes longer than about 3 seconds. Embedding plus metadata extraction can take 4–5 seconds, so Slack may send the event twice and create two rows. The content is identical; search is unaffected. You can delete the duplicate in Supabase Table Editor if desired.

### Function runs but nothing in the database

Check Edge Function logs in the dashboard (Edge Functions → ingest-thought → Logs). Often the OpenRouter API key is wrong or has no credits. Verify secrets:

```bash
supabase secrets list
```

Then set or correct: `OPENROUTER_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_CAPTURE_CHANNEL`.

### No confirmation reply in Slack

The bot token may be wrong, or the `chat:write` scope may be missing. In the Slack app go to OAuth & Permissions and confirm the scope. If you added the scope after installing, reinstall the app to the workspace.

### Metadata extraction seems off

Metadata is best-effort from the LLM. Semantic search uses the embedding, so retrieval works even when metadata is imperfect. You can use capture templates to give the model clearer signals.

---

## Retrieval (MCP)

### Claude Desktop tools do not appear

Add the connector in Settings → Connectors (not by editing a JSON config). Ensure the connector is enabled for the current conversation (e.g. "+" → Connectors → open-brain-wizard on). If it still does not show, remove and re-add the connector with the same URL.

### ChatGPT does not use open-brain-wizard tools

Turn on Developer Mode: Settings → Apps & Connectors → Advanced settings. Ensure the connector is active for the conversation. You can say explicitly: "Use the open-brain-wizard search_thoughts tool to search for [topic]."

### Getting 401 errors

The access key in the URL or header does not match the value in Supabase secrets. Check that the `?key=` value in your MCP URL matches `MCP_ACCESS_KEY` exactly. If using a header (e.g. Claude Code or mcp-remote), the header must be `x-brain-key` (lowercase, with the hyphen).

### Search returns no results

Capture some test messages in Part 1 first. Try a lower threshold (e.g. "search with threshold 0.3"). If it still returns nothing, check the open-brain-mcp Edge Function logs in the Supabase dashboard.

### Tools work but responses are slow

The first request to a cold Edge Function can take a few seconds. Later calls are faster. If it is always slow, check that your Supabase project region is close to you.

### Capture tool saves but metadata is wrong

Same as Slack capture: metadata is best-effort. The embedding drives semantic search regardless of how metadata is classified.
