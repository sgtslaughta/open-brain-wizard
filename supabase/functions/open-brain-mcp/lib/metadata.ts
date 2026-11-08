// Any OpenAI-compatible chat endpoint works (OpenRouter by default, or a local
// Ollama server). The model must support response_format json_object.
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "https://openrouter.ai/api/v1";
const LLM_MODEL = Deno.env.get("LLM_MODEL") ?? "openai/gpt-4o-mini";

export async function extractMetadata(
  text: string,
  apiKey: string
): Promise<Record<string, unknown>> {
  const r = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}
