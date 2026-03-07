/**
 * Open Brain ingest-thought Edge Function.
 * Receives Slack events, generates embedding and metadata, stores in Supabase.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// Lazy-init so url_verification works even if env vars aren't set yet
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
  }
  return _supabase;
}

async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.` },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try { return JSON.parse(d.choices[0].message.content); }
  catch { return { topics: ["uncategorized"], type: "observation" }; }
}

async function replyInSlack(channel: string, threadTs: string, text: string): Promise<void> {
  const token = Deno.env.get("SLACK_BOT_TOKEN") ?? "";
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle url_verification as fast as possible - Slack has a 3s timeout
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (body.type === "url_verification") {
    return new Response(
      JSON.stringify({ challenge: body.challenge }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Acknowledge Slack immediately for event callbacks, process async
  // Slack retries if it doesn't get a 200 within 3s
  try {
    const event = body.event as Record<string, string> | undefined;
    const captureChannel = Deno.env.get("SLACK_CAPTURE_CHANNEL") ?? "";
    if (!event || event.type !== "message" || event.subtype || event.bot_id
        || event.channel !== captureChannel) {
      return new Response("ok", { status: 200 });
    }
    const messageText = event.text;
    const channel = event.channel;
    const messageTs = event.ts;
    if (!messageText || messageText.trim() === "") return new Response("ok", { status: 200 });

    const [embedding, metadata] = await Promise.all([
      getEmbedding(messageText),
      extractMetadata(messageText),
    ]);

    const supabase = getSupabase();
    const { error } = await supabase.from("thoughts").insert({
      content: messageText,
      embedding,
      metadata: { ...metadata, source: "slack", slack_ts: messageTs },
    });

    if (error) {
      console.error("Supabase insert error:", error);
      await replyInSlack(channel, messageTs, `Failed to capture: ${error.message}`);
      return new Response("error", { status: 500 });
    }

    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured as *${meta.type || "thought"}*`;
    if (Array.isArray(meta.topics) && meta.topics.length > 0)
      confirmation += ` - ${meta.topics.join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length > 0)
      confirmation += `\nPeople: ${meta.people.join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
      confirmation += `\nAction items: ${meta.action_items.join("; ")}`;

    await replyInSlack(channel, messageTs, confirmation);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("error", { status: 500 });
  }
});
