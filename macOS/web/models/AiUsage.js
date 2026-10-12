export function addUsage(previous, usage) {
    const amount = (value) => Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
    const prompt = amount(usage.prompt_tokens), hit = Math.min(prompt, amount(usage.prompt_cache_hit_tokens));
    return { requests: previous.requests + 1, prompt: previous.prompt + prompt, output: previous.output + amount(usage.completion_tokens), hit: previous.hit + hit, miss: previous.miss + Math.max(0, prompt - hit) };
}
