import type { ModelKey } from '../../../shared/contracts';

export type ModelConfig = {
  id: string;
  wire: 'responses' | 'gateway';
  window: number;
  maxOutput: number;
  // The server's working-context limit: text bytes plus a per-image estimate.
  threshold: number;
  // OpenAI Responses only: the token count sent as compact_threshold.
  compactThreshold?: number;
};

// Source links and the selected output budget are recorded in docs/providers.md.
export const models: Record<ModelKey, ModelConfig> = {
  kimi: {
    id: 'moonshotai/kimi-k3',
    wire: 'gateway',
    window: 1_000_000,
    maxOutput: 32_768,
    threshold: 850_000,
  },
  deepseek: {
    id: 'deepseek/deepseek-v4.1-flash',
    wire: 'gateway',
    window: 1_000_000,
    maxOutput: 32_768,
    threshold: 800_000,
  },
  'gpt-6.1-sol': {
    id: 'gpt-6.1-sol',
    wire: 'responses',
    window: 1_050_000,
    maxOutput: 32_768,
    threshold: 800_000,
    compactThreshold: 200_000,
  },
  'gpt-6-astra': {
    id: 'gpt-6-astra',
    wire: 'responses',
    window: 1_050_000,
    maxOutput: 32_768,
    threshold: 800_000,
    compactThreshold: 200_000,
  },
};

export function checkpointMethod(model: ModelKey) {
  if (model === 'kimi') return 'kimi-summary';
  if (model === 'deepseek') return 'deepseek-summary';
  return 'openai-compaction';
}
