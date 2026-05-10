import type { Recipe } from '../types.ts';

/**
 * DeepSeek exposes an OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Model lineup (as of 2026-05):
 *   deepseek-v4-pro   — deep reasoner, used for synthesis / think / dream
 *   deepseek-v4-flash — fast chat model, suited for expansion and routing
 *
 * Note: deepseek-chat and deepseek-reasoner are deprecated and will be
 * retired in July 2026. Use the versioned v4 names instead.
 */
export const deepseek: Recipe = {
  id: 'deepseek',
  name: 'DeepSeek',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://api.deepseek.com/v1',
  auth_env: {
    required: ['DEEPSEEK_API_KEY'],
    setup_url: 'https://platform.deepseek.com/api_keys',
  },
  touchpoints: {
    chat: {
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: false,
      max_context_tokens: 1_000_000,
      cost_per_1m_input_usd: 0.14,
      cost_per_1m_output_usd: 0.28,
      price_last_verified: '2026-05-10',
    },
    expansion: {
      models: ['deepseek-v4-flash'],
      cost_per_1m_tokens_usd: 0.07,
      price_last_verified: '2026-05-10',
    },
  },
  setup_hint: 'Get an API key at https://platform.deepseek.com/api_keys, then `export DEEPSEEK_API_KEY=...`',
};
