import type { Recipe } from '../types.ts';

export const dashscope: Recipe = {
  id: 'dashscope',
  name: 'DashScope (Alibaba Cloud)',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  auth_env: {
    required: ['DASHSCOPE_API_KEY'],
    setup_url: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  touchpoints: {
    embedding: {
      models: ['text-embedding-v1', 'text-embedding-v2', 'text-embedding-v3', 'text-embedding-v4'],
      default_dims: 1536,
      dims_options: [768, 1024, 1536],
      max_batch_tokens: 25000, // DashScope v4 limit per API doc
      cost_per_1m_tokens_usd: 0.0007,
      price_last_verified: '2026-05-08',
    },
  },
  setup_hint: 'Get an API key at https://bailian.console.aliyun.com, then `export DASHSCOPE_API_KEY=...`',
};
