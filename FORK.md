# Hongyuatcufe Fork of GBrain

This is a personal fork of upstream `gbrain` adapted for a China-region
DeepSeek + Alibaba DashScope stack. Read this file **before merging upstream
master** — auto-merge has silently dropped these customizations once already
(see commit `fbcf393b fix: merge back custom fork features lost in upstream
merge`).

Upstream defaults assume Anthropic + OpenAI + ZeroEntropy. Our fork's daily
stack is:

| Touchpoint | Provider | Model | Notes |
|---|---|---|---|
| chat / expansion / synthesis | DeepSeek (OpenAI-compatible) | `deepseek-v4-flash` (fast), `deepseek-v4-pro` (reasoner) | $0.14 / $0.28 per M tok |
| embedding | DashScope (OpenAI-compatible) | `text-embedding-v4` @ 1024 dims (Matryoshka) | $0.07 / M tok |
| subagent multi-turn tool-loop | **Anthropic still required** | `claude-sonnet-4-6` | DeepSeek lacks an Anthropic-shape adapter |

## Required user setup

```bash
# 1. ~/gbrain/.env (single source of truth for API keys)
cat > ~/gbrain/.env <<'EOF'
DEEPSEEK_API_KEY=sk-...
DASHSCOPE_API_KEY=sk-...
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EOF

# 2. ~/.zshrc — auto-load .env into every shell so MCP-spawned children inherit
#    `set -a` makes every assignment in the sourced file auto-exported.
if [ -f "$HOME/gbrain/.env" ]; then
  set -a
  source "$HOME/gbrain/.env"
  set +a
fi

# 3. ~/.gbrain/config.json — fork-aware model selection
#    embedding_dimensions MUST match the brain's pgvector column at init time.
{
  "engine": "pglite",
  "embedding_model": "dashscope:text-embedding-v4",
  "embedding_dimensions": 1024,
  "expansion_model": "deepseek:deepseek-v4-flash",
  "chat_model": "deepseek:deepseek-v4-flash"
}

# 4. DB-plane override so ALL tier-routed callers (think/dream/etc.) honor DeepSeek.
#    Without this, callers like `gbrain think` resolve through TIER_DEFAULTS
#    and land on anthropic:claude-opus-4-7 → require ANTHROPIC_API_KEY.
gbrain config set models.default deepseek:deepseek-v4-flash
```

## Anti-patterns (will silently break the fork)

- **Do NOT** set `GBRAIN_EMBEDDING_DIMENSIONS` in your shell. It overrides
  `config.json`; if it disagrees with the brain's column dim you get
  `expected N dimensions, not M` from pgvector. Use `config.json` only.
- **Do NOT** set `GBRAIN_EMBEDDING_MODEL` in your shell for the same reason.
- **Do NOT** `cp` a compiled binary over the path `~/.bun/bin/gbrain` ever
  references — that symlink resolves through `~/node_modules/gbrain →
  ~/gbrain`, so the `cp` overwrites the actual TypeScript source. Restore
  via `git restore src/cli.ts` if it happens.
- **Do NOT** rely on the compiled `bin/gbrain` for PGLite paths. Bun
  compiled binaries hit upstream issue #1340 — `/$bunfs/root` is read-only
  on macOS, PGLite can't extract its WASM payload. Run via source instead
  (`gbrain` symlink → `bun src/cli.ts`).

## Files we own (any upstream change here needs careful review)

### Provider plumbing
- `src/core/ai/recipes/deepseek.ts` — DeepSeek recipe with v4 models, chat
  touchpoint (flash listed first as default). Upstream `deepseek-chat` /
  `deepseek-reasoner` aliases kept for back-compat (deprecation 2026-07).
- `src/core/ai/recipes/dashscope.ts` — DashScope recipe with embedding-only
  touchpoint. `base_url_default` points at the China endpoint
  (`https://dashscope.aliyuncs.com/compatible-mode/v1`), not the international
  one.
- `src/core/ai/build-gateway-config.ts` — folds `deepseek_api_key` /
  `dashscope_api_key` from `config.json` into the gateway env. Required so
  daemons/launchd-spawned children that don't inherit `~/.zshrc` still find
  the keys.
- `src/core/config.ts` — adds `deepseek_api_key` + `dashscope_api_key`
  fields to `GBrainConfig`, env-var fallback rows (`DEEPSEEK_API_KEY`,
  `DASHSCOPE_API_KEY`), and DB-plane merge for `chat_model` / `expansion_model`
  (fix `2234db0e`).
- `src/core/ai/dims.ts` — DashScope `text-embedding-v3` and `text-embedding-v4`
  routed through the openai-compat `dimensions:` field so the Matryoshka
  shrink to 1024 actually takes effect.
- `src/core/ai/gateway.ts` (`reconfigureGatewayWithEngine`) — drops the
  `tier: 'utility' / 'reasoning'` argument so the user's `cfg.expansion_model`
  / `cfg.chat_model` from `config.json` survives `resolveModel`'s step-7
  `TIER_DEFAULTS` override. Without this, every DB-connected call path
  silently switches `chat_model` to `anthropic:claude-sonnet-4-6`.
- `src/core/ai/capabilities.ts` — `dashscope` removed from the
  "providers with chat" hint string. Re-add only after dashscope.ts
  declares a chat touchpoint.

### Pricing
- `src/core/model-pricing.ts` — adds `deepseek:deepseek-v4-flash` /
  `deepseek-v4-pro` plus legacy aliases (`deepseek-chat`, `deepseek-reasoner`).
- `src/core/embedding-pricing.ts` — adds `dashscope:text-embedding-v1/v2/v3/v4`
  entries (all $0.07/M tok). Note: v1/v2 are actually $0.10/M; refine if
  cost accuracy matters for those.
- `src/core/budget/budget-tracker.ts` — chat-pricing lookup routes through
  `canonicalLookup` (model-pricing.ts) instead of the anthropic-only view,
  so DeepSeek/OpenAI/Together chat models hit the budget gate's `--max-cost`
  path. Without this, brainstorm/lsd's TX5 reserve raises
  `BudgetExhausted(no_pricing)` on every cross call.

### Provider-neutral seams
- `src/core/think/index.ts` — `gbrain think` chat resolution went through
  upstream's Anthropic-only seam; this fork routes through `gateway.chat()`
  so DeepSeek-as-chat works. JSON mode (`responseFormat: { type: 'json_object' }`)
  added so DeepSeek v4's `response_format` is set, eliminating
  `LLM_OUTPUT_NOT_JSON` parse failures.
- `src/core/brainstorm/orchestrator.ts` — `modelStr` fallback no longer
  hard-codes `anthropic:claude-sonnet-4-6`; falls through to
  `gateway.getChatModel()`. Chat call's `model` field is `modelStr`
  (resolved) instead of `opts.modelOverride` (often undefined), preventing
  the gateway from re-resolving to TIER_DEFAULTS mid-run.
- `src/core/extract-takes-from-pages.ts` — chat call's fallback no
  longer hard-codes `anthropic:claude-haiku-4-5`; falls through to
  `gateway.getChatModel()`. Without this, capture/dream's takes
  extraction silently failed every page (the catch-and-continue
  swallowed the missing-key throw).

## Known remaining Anthropic-dependent paths (out of scope)

- `gbrain skillopt` and any other `subagent` tier caller. Subagent uses
  Anthropic Messages API tool-loop with prompt-cache markers; DeepSeek
  OpenAI-compat doesn't accept the same shape. Needs a DeepSeek-side
  adapter that translates `cacheControl: { type: 'ephemeral' }` markers
  into DeepSeek's prompt-cache protocol. Large project, deferred.
- `src/core/cycle/patterns.ts:67` — dream pattern detection has a hard
  `if (!process.env.ANTHROPIC_API_KEY)` env check that runs before
  `resolveModel`. Skips silently when unset. If you want pattern detection
  to run on DeepSeek, replace the env check with `isAvailable('chat')`.

## How to merge upstream master safely

1. `git fetch upstream`
2. **Diff this file's "Files we own" against upstream first**:
   ```bash
   for f in $(grep -oE 'src/[^ ]+\.ts' FORK.md | sort -u); do
     echo "=== $f ==="
     git diff upstream/master -- "$f" | head -40
   done
   ```
3. `git merge upstream/master`
4. On conflicts in the "Files we own" list: **prefer ours** for the fork-
   specific blocks (search for `hongyuatcufe fork` markers), then re-apply
   any non-conflicting upstream improvements line by line.
5. Run `bun run typecheck` then the targeted regression set:
   ```bash
   bun test test/ai/ test/budget/ test/brainstorm/ test/model-pricing.test.ts \
     test/model-config.test.ts test/embedding-pricing.test.ts \
     test/think-gateway-adapter.test.ts test/cycle/
   ```
6. Smoke test before commit:
   ```bash
   gbrain providers test --touchpoint chat       # → deepseek:deepseek-v4-flash pong
   gbrain providers test --touchpoint embedding  # → 1024 dims
   echo test | gbrain capture --stdin --slug "merge-smoke-$(date +%s)"
   gbrain brainstorm "test" --limit 2 --max-cost 1 --no-save
   ```
7. If anything fails, check whether upstream re-introduced a
   `'anthropic:claude-*'` literal in the "Files we own" list and replace
   with the gateway-routed fallback pattern (`getChatModel()` with
   try/catch).

## Version

Latest synced upstream: v0.42.26.0 (commit `80581445`).
