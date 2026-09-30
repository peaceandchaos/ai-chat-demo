import { parseSearchQuery, parseServerEvent } from '../src/openai/protocol';

test('untrusted frames cannot supply objects or arrays as reply text', () => {
  for (const value of [
    null,
    [],
    { type: 'response.output_text.delta', delta: {} },
    { type: 'response.reasoning_summary_text.delta', delta: ['secret'] },
    { type: 'response.completed', response: { id: 5 } },
    {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'call',
        name: 'search_margelo_kb',
        arguments: {},
      },
    },
    { type: 'error', error: { message: {} } },
  ]) {
    expect(parseServerEvent(JSON.stringify(value))).toEqual({
      kind: 'ignored',
      type: '<unparseable>',
    });
  }
});

test('valid text, completed response, and function call retain their values', () => {
  expect(
    parseServerEvent('{"type":"response.output_text.delta","delta":"hello"}'),
  ).toEqual({ kind: 'delta', text: 'hello' });
  expect(
    parseServerEvent(
      '{"type":"response.completed","response":{"id":"response-1"}}',
    ),
  ).toEqual({ kind: 'completed', responseId: 'response-1' });
  expect(
    parseServerEvent(
      JSON.stringify({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'search_margelo_kb',
          arguments: '{"query":"Margelo"}',
        },
      }),
    ),
  ).toEqual({
    kind: 'tool_call',
    callId: 'call-1',
    name: 'search_margelo_kb',
    args: '{"query":"Margelo"}',
  });
});

test('search rejects missing or non-text queries before calling the service', () => {
  expect(parseSearchQuery('{"query":"Margelo"}')).toBe('Margelo');
  for (const raw of [
    'null',
    '{}',
    '{"query":{}}',
    '{"query":[]}',
    '{"query":""}',
    'broken',
  ]) {
    expect(() => parseSearchQuery(raw)).toThrow();
  }
});
