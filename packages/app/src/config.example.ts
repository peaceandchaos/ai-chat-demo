// Template for src/config.ts (which is gitignored). Copy this file to
// src/config.ts and fill in your own keys.
//
// DEMO ONLY. Shipping an API key inside an app binary is unsafe for production:
// anyone can extract it from the bundle. For this local demo we accept that
// tradeoff and talk to OpenAI's WebSocket endpoint directly. For anything real,
// put a relay server in front and keep the key server-side.

export const OPENAI_API_KEY = 'sk-proj-...';

// Endpoint and model verified from OpenAI's WebSocket mode docs:
// https://developers.openai.com/api/docs/guides/websocket-mode
export const OPENAI_WS_URL = 'wss://api.openai.com/v1/responses';
export const OPENAI_MODEL = 'gpt-5.5';

// Pinecone (Margelo knowledge base for the search_margelo_kb RAG tool). The
// index uses integrated embedding (llama-text-embed-v2, 1024-dim, cosine); the
// upsert text field is "chunk_text". See scripts/ingest-kb.mjs.
export const PINECONE_API_KEY = 'pcsk_...';
export const PINECONE_INDEX_HOST =
  'https://<your-index>.svc.<region>.pinecone.io';
export const PINECONE_NAMESPACE = 'kb';
