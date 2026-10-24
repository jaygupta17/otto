/** How models are titled in the pickers: display name, provider name, free tag. */
import type { ModelInfo } from "@opencode/client";

const PROVIDER_NAMES: Record<string, string> = {
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google: "Google",
  deepseek: "DeepSeek",
  "github-copilot": "GitHub Copilot",
  "cloudflare-workers-ai": "Cloudflare",
  "zai-coding-plan": "Z.AI",
  xai: "xAI",
  mistral: "Mistral",
  groq: "Groq",
};

export function providerName(id: string) {
  return PROVIDER_NAMES[id] ?? id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A free model, by id suffix or by price. */
export function isFree(m: ModelInfo) {
  return m.id.endsWith("-free") || m.id.endsWith(":free") || (m.cost?.[0]?.input === 0 && m.cost?.[0]?.output === 0);
}

/** "Exo Free", "Big Pickle (free)", "foo-free" → the name without the free tag. */
export function cleanName(m: ModelInfo) {
  return m.name.replace(/\s*[·(\-–:]?\s*free\)?$/i, "").trim() || m.name;
}

export const keyOf = (m: { providerID: string; id: string }) => `${m.providerID}/${m.id}`;

/**
 * Display labels for a list of models, so no two rows read the same. A free
 * and a paid model can share one name ("MiMo-V2.6-Flash"): among same-named
 * models the free ones say "… · Free" and the paid one keeps its plain name —
 * it only changes when that alone still leaves two rows alike (then the
 * provider name, and the id as a last resort).
 */
export function modelLabels(models: ModelInfo[]): Map<string, string> {
  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const base = cleanName(m);
    groups.set(base, [...(groups.get(base) ?? []), m]);
  }
  const labels = new Map<string, string>();
  const tagged: { m: ModelInfo; base: string; tag: string }[] = [];
  for (const [base, twins] of groups) {
    if (twins.length === 1) {
      labels.set(keyOf(twins[0]), base);
      continue;
    }
    const mixed = twins.some(isFree) && twins.some((t) => !isFree(t));
    const tag = (t: ModelInfo) => (mixed ? (isFree(t) ? "Free" : "") : isFree(t) ? `${providerName(t.providerID)} · Free` : providerName(t.providerID));
    const tags = twins.map(tag);
    const counts = new Map<string, number>();
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    // A tag two of them share tells them apart from nothing: name the provider instead.
    twins.forEach((m, i) => {
      const fallback = isFree(m) ? `${providerName(m.providerID)} · Free` : providerName(m.providerID);
      tagged.push({ m, base, tag: counts.get(tags[i])! > 1 ? fallback : tags[i] });
    });
  }
  const texts = tagged.map((t) => ({ ...t, text: t.tag ? `${t.base} · ${t.tag}` : t.base }));
  const seen = new Map<string, number>();
  for (const t of texts) seen.set(t.text, (seen.get(t.text) ?? 0) + 1);
  for (const t of texts) {
    // Same name, provider and price: only the raw id is left to tell them apart.
    labels.set(keyOf(t.m), seen.get(t.text)! > 1 ? `${t.base} · ${t.m.id}` : t.text);
  }
  return labels;
}

/** One model's label within `models` (see modelLabels); its plain name when nothing shares it. */
export function modelLabel(models: ModelInfo[], m: ModelInfo): string {
  return modelLabels(models).get(keyOf(m)) ?? cleanName(m);
}
