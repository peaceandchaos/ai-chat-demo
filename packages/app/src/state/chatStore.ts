import { Alert } from 'react-native';
import { create } from 'zustand';
import { connectionManager } from '../openai/connectionManager';
import {
  buildFunctionCallOutput,
  buildResponseCreate,
  parseServerEvent,
} from '../openai/protocol';
import { searchMargeloKb } from '../rag/searchKnowledgeBase';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'streaming' | 'done' | 'error';

// A picked image: `uri` is the local file (for display), `dataUrl` is the
// base64 data URL sent to OpenAI.
export type Attachment = { uri: string; dataUrl: string };

export type Message = {
  id: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  statusLabel?: string;
  attachments?: string[];
  reasoning?: string;
};

// Demo-only in-memory cap. Production would page older messages from a store
// (SQLite) instead of dropping them; the model keeps full context either
// way via previousResponseId.
const MAX_MESSAGES = 500;

const MAX_TOOL_CALLS = 4;

let messageCounter = 0;
const nextMessageId = (): string => `m${++messageCounter}`;

let previousResponseId: string | undefined;
let streamingId: string | null = null;
let pendingToolCall: { callId: string; name: string; args: string } | null =
  null;
let toolCallCount = 0;
let pendingText = '';
let pendingReasoning = '';
let flushHandle: number | null = null;

type ChatState = {
  messages: Message[];
  isStreaming: boolean;
  send: (rawText: string, attachments?: Attachment[]) => void;
  stop: () => void;
  newChat: () => void;
};

export const useChatStore = create<ChatState>(set => {
  const setMessages = (updater: (prev: Message[]) => Message[]) =>
    set(state => ({ messages: updater(state.messages) }));

  const cancelFlush = () => {
    if (flushHandle != null) {
      cancelAnimationFrame(flushHandle);
      flushHandle = null;
    }
  };

  // Apply all buffered deltas in a single commit. Runs on the rAF tick and,
  // synchronously, from finishStreaming so the trailing tokens are never lost.
  const flushDeltas = () => {
    flushHandle = null;
    const id = streamingId;
    const text = pendingText;
    const reasoning = pendingReasoning;
    pendingText = '';
    pendingReasoning = '';
    if (!id || (!text && !reasoning)) {
      return;
    }
    setMessages(prev =>
      prev.map(m =>
        m.id === id
          ? {
              ...m,
              text: m.text + text,
              reasoning: reasoning
                ? (m.reasoning ?? '') + reasoning
                : m.reasoning,
            }
          : m,
      ),
    );
  };

  const scheduleFlush = () => {
    if (flushHandle == null) {
      flushHandle = requestAnimationFrame(flushDeltas);
    }
  };

  const appendDelta = (text: string) => {
    if (!streamingId) {
      return;
    }
    pendingText += text;
    scheduleFlush();
  };

  const appendReasoning = (text: string) => {
    if (!streamingId) {
      return;
    }
    pendingReasoning += text;
    scheduleFlush();
  };

  const setStatusLabel = (label: string) => {
    const id = streamingId;
    if (!id) {
      return;
    }
    setMessages(prev =>
      prev.map(m => (m.id === id ? { ...m, statusLabel: label } : m)),
    );
  };

  const finishStreaming = (status: MessageStatus) => {
    const id = streamingId;
    if (!id) {
      return;
    }
    // Drain any buffered deltas into the same commit that finalizes the status,
    // otherwise trailing tokens are lost once streamingId is cleared.
    cancelFlush();
    const text = pendingText;
    const reasoning = pendingReasoning;
    pendingText = '';
    pendingReasoning = '';
    setMessages(prev =>
      prev.map(m =>
        m.id === id
          ? {
              ...m,
              text: m.text + text,
              reasoning: reasoning
                ? (m.reasoning ?? '') + reasoning
                : m.reasoning,
              status,
            }
          : m,
      ),
    );
    streamingId = null;
    set({ isStreaming: false });
  };

  const runToolCall = async (
    toolCall: { callId: string; name: string; args: string },
    responseId: string,
  ) => {
    toolCallCount += 1;
    let output: string;
    if (toolCall.name !== 'search_margelo_kb') {
      output = `Unknown tool: ${toolCall.name}`;
    } else if (toolCallCount > MAX_TOOL_CALLS) {
      output = 'Tool call limit reached; answer from what you already have.';
    } else {
      try {
        const parsedArgs = JSON.parse(toolCall.args || '{}') as {
          query?: string;
        };
        const context = await searchMargeloKb(parsedArgs.query ?? '', 5);
        output =
          context || 'No matching Margelo knowledge base entries were found.';
      } catch (error) {
        output = `Knowledge base search failed: ${String(error)}`;
      }
    }
    const sent = connectionManager.send(
      buildFunctionCallOutput(toolCall.callId, output, responseId),
    );
    if (!sent) {
      finishStreaming('error');
      Alert.alert(
        'Not connected',
        'Lost the connection while answering. Please try again.',
      );
    }
  };

  const handleServerEvent = (raw: string) => {
    const parsed = parseServerEvent(raw);
    switch (parsed.kind) {
      case 'status':
        setStatusLabel(parsed.label);
        break;
      case 'delta':
        appendDelta(parsed.text);
        break;
      case 'reasoning':
        appendReasoning(parsed.text);
        break;
      case 'tool_call':
        pendingToolCall = {
          callId: parsed.callId,
          name: parsed.name,
          args: parsed.args,
        };
        setStatusLabel('Searching Margelo docs');
        break;
      case 'completed': {
        const toolCall = pendingToolCall;
        if (toolCall) {
          pendingToolCall = null;
          runToolCall(toolCall, parsed.responseId);
          break;
        }
        if (parsed.responseId) {
          previousResponseId = parsed.responseId;
        }
        finishStreaming('done');
        break;
      }
      case 'error':
        console.warn(
          '[openai] error event:',
          parsed.code ?? '',
          parsed.message,
        );
        // A failed turn evicts previous_response_id server-side, so drop it or every following send wedges.
        previousResponseId = undefined;
        // The 60-minute connection cap arrives as an error event (not a socket
        // close); OpenAI expects us to open a fresh connection.
        if (parsed.code === 'websocket_connection_limit_reached') {
          finishStreaming('done');
          connectionManager.forceReconnect();
          break;
        }
        finishStreaming('error');
        Alert.alert('Something went wrong', parsed.message);
        break;
      case 'ignored':
        // Ignore benign non-JSON frames
        if (parsed.type !== '<unparseable>') {
          console.log('[openai] event:', parsed.type);
        }
        break;
    }
  };

  connectionManager.setHandlers({
    onServerEvent: handleServerEvent,
    // previous_response_id lives only in the closed connection's cache, so drop it on disconnect.
    onDisconnect: () => {
      previousResponseId = undefined;
      if (streamingId) {
        finishStreaming('error');
      }
    },
  });

  return {
    messages: [],
    isStreaming: false,

    send: (rawText, attachments = []) => {
      const text = rawText.trim();
      if (!text && attachments.length === 0) {
        return;
      }

      const sent = connectionManager.send(
        buildResponseCreate(
          text,
          previousResponseId,
          attachments.map(a => a.dataUrl),
        ),
      );
      if (!sent) {
        Alert.alert(
          'Not connected',
          'Still connecting to the server. Please try again in a moment.',
        );
        return;
      }

      pendingToolCall = null;
      toolCallCount = 0;

      const userMessage: Message = {
        id: nextMessageId(),
        role: 'user',
        text,
        status: 'done',
        attachments: attachments.length
          ? attachments.map(a => a.uri)
          : undefined,
      };
      const assistantMessage: Message = {
        id: nextMessageId(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        statusLabel: 'Thinking',
      };
      streamingId = assistantMessage.id;
      setMessages(prev =>
        [...prev, userMessage, assistantMessage].slice(-MAX_MESSAGES),
      );
      set({ isStreaming: true });
    },

    stop: () => finishStreaming('done'),

    newChat: () => {
      cancelFlush();
      pendingText = '';
      pendingReasoning = '';
      previousResponseId = undefined;
      streamingId = null;
      pendingToolCall = null;
      toolCallCount = 0;
      set({ messages: [], isStreaming: false });
    },
  };
});
