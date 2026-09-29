# Provider integration

Model ids were checked against the official provider and Gateway model pages on
2026-09-28. Account access and live behavior still require approved provider calls.
The server owns this allowlist. Phone requests cannot supply model URLs or ids.

| Picker   | Upstream id                    | Transport                         | Configured context window |
| -------- | ------------------------------ | --------------------------------- | ------------------------- |
| Kimi     | `moonshotai/kimi-k3`           | Gateway Chat Completions HTTP/SSE | 1,000,000                 |
| DeepSeek | `deepseek/deepseek-v4.1-flash` | Gateway Chat Completions HTTP/SSE | 1,000,000                 |
| GPT-5.6  | `gpt-5.6-sol`                  | OpenAI Responses WebSocket        | 1,050,000                 |
| GPT-6    | `gpt-6-sol`                    | OpenAI Responses WebSocket        | 1,050,000                 |

Sources: [Kimi](https://vercel.com/ai-gateway/models/kimi-k3),
[DeepSeek](https://vercel.com/ai-gateway/models/deepseek-v4.1-flash),
[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol).

The initial application output budget is 32,768 tokens per call. This is a chosen
request budget, not a claim about the models' maximum output. A length-limited
answer is an explicit failure with its partial text retained. Worker duration and
this output budget need live verification together before release.

`ai@7.0.122` and `@ai-sdk/gateway@4.0.100` are used only for Jev evaluation. Both
Jev operations set `maxRetries: 0`. The pinned Gateway adapter passes `abortSignal`
to its HTTP call. A local fixture checks that cancellation reaches that call and
that HTTP 500 does not cause a second evaluation. Billing cessation is unverified.

## Context methods and provenance

OpenAI uses [Responses compaction](https://developers.openai.com/api/docs/guides/compaction),
`store: false`, and encrypted reasoning inclusion. Each attempt uses its own
socket. No previous-response id is required for recovery. After a regular response,
the saved working window can drop items before its last compaction item. The
standalone `/responses/compact` result is kept as its full canonical window.

Kimi's method is adapted from
[Kimi CLI at `9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82`](https://github.com/MoonshotAI/kimi-cli/tree/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82):
`src/kimi_cli/soul/compaction.py`, `src/kimi_cli/config.py`, and its compact prompt.
It compacts the prefix and retains the two most recent working messages. The
threshold follows the published 0.85 ratio and reserved-space rule.

DeepSeek's method is adapted from
[DeepSeek Harness at `4878cdabd87d4041bdaff61d04c966883b9fd07a`](https://github.com/deepseek-ai/deepseek-harness/tree/4878cdabd87d4041bdaff61d04c966883b9fd07a):
its compaction-basic configuration, summarizer, and subsystem documentation.
It uses a 0.8 pressure threshold, a 0.16 retained-tail ratio, and completion
headroom. The summary call replays the prefix followed by the published
compaction instruction. Empty or limited summaries cannot become checkpoints.

The adapted prompts use general chat wording. No coding tools or harness runtime
are imported. Multimodal parts remain in the summary input; hidden reasoning is
excluded from visible summaries. Apache license and NOTICE files for Kimi and
the DeepSeek MIT license are beside the adapted source under
`packages/server/src/compaction/`.

The app uses a conservative UTF-8 byte estimate for working-context pressure.
Provider tokenizers are unavailable through the chosen APIs. This may compact
earlier than provider usage would require, especially for images. It avoids the
Kimi reference's acknowledged multilingual undercount from `characters / 4`.
Oversize inline images fail visibly. Actual token usage and image limits remain
part of live verification.

On a provider switch, the server reconstructs only the selected path. It never
sends an OpenAI encrypted item to Gateway. Long original text can be divided into
bounded working pieces and compacted in sequence. This does not edit the visible
archive. Checkpoints include their model and ancestry anchor. An anchor from a
sibling branch is rejected. Incomplete assistant text is excluded from future
model input, while remaining visible on the phone.

All auxiliary compaction calls check Stop before they start and after they return.
There are no automatic paid-call retries. A worker deadline or ambiguous provider
disconnect preserves the partial result and requires explicit Retry.
