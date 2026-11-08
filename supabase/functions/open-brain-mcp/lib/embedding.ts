// Any OpenAI-compatible embeddings endpoint works (OpenRouter by default, or a
// local Ollama server). The model's output dimension must match the vector(N)
// columns in sql/schema.sql.
const EMBED_BASE_URL = Deno.env.get("EMBED_BASE_URL") ?? "https://openrouter.ai/api/v1";
const EMBED_MODEL = Deno.env.get("EMBED_MODEL") ?? "openai/text-embedding-3-small";

export async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  const r = await fetch(`${EMBED_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Embeddings request failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}
