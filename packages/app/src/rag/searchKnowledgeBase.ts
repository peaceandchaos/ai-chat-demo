import { fetch } from 'react-native-nitro-fetch';
import {
  PINECONE_API_KEY,
  PINECONE_INDEX_HOST,
  PINECONE_NAMESPACE,
} from '../config';

// Pinecone data-plane API version
// https://docs.pinecone.io/reference/api/2025-01/data-plane/search_records
const PINECONE_API_VERSION = '2025-01';

const SEARCH_TIMEOUT_MS = 10000;

type SearchHit = { fields?: { chunk_text?: string; title?: string } };

// Query the Margelo knowledge base. The index uses integrated embedding, so we
// send raw text and Pinecone embeds it server-side. Returns the top matching
// chunks joined into one context string for the model, or '' if nothing matched.
export async function searchMargeloKb(
  query: string,
  topK = 5,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${PINECONE_INDEX_HOST}/records/namespaces/${PINECONE_NAMESPACE}/search`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Api-Key': PINECONE_API_KEY,
          'X-Pinecone-Api-Version': PINECONE_API_VERSION,
        },
        body: JSON.stringify({
          query: { inputs: { text: query }, top_k: topK },
          fields: ['title', 'chunk_text'],
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Pinecone search failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as { result?: { hits?: SearchHit[] } };
    const hits = data.result?.hits ?? [];
    return hits
      .map(hit => hit.fields?.chunk_text ?? '')
      .filter(Boolean)
      .join('\n\n---\n\n');
  } finally {
    clearTimeout(timeout);
  }
}
