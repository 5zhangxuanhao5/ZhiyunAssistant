export interface AiUsage { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number }
export interface AiUsageTotals { requests: number; prompt: number; output: number; hit: number; miss: number }
export function addUsage(previous: AiUsageTotals, usage: AiUsage): AiUsageTotals {
  const amount = (value?: number): number => Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
  const prompt = amount(usage.prompt_tokens), hit = Math.min(prompt, amount(usage.prompt_cache_hit_tokens));
  return { requests: previous.requests + 1, prompt: previous.prompt + prompt, output: previous.output + amount(usage.completion_tokens), hit: previous.hit + hit, miss: previous.miss + Math.max(0, prompt - hit) };
}
