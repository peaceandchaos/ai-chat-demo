<img src="img/demo.png" alt="MargeloChat running on iPhone 16" width="280" align="right">

### MargeloChat

A ChatGPT-style mobile chat app with a twist: it knows about **Margelo**. You talk to a streaming AI assistant that renders replies as live markdown, shows its reasoning, and answers any question about Margelo (the company, its people, and its open-source libraries) by searching a real knowledge base instead of guessing.

Ask it anything. For general questions it just replies; for Margelo questions it calls a retrieval tool, pulls matching facts from a vector database, and answers only from what it found.

> [!NOTE]
> Read the full blog post about building a ChatGPT-Style AI Chat App in React Native here: https://blog.margelo.com/building-native-llm-chat-app-with-rag

### How it works

- **Brain** - OpenAI's Responses API, streamed over a **WebSocket** ([`react-native-nitro-websockets`](https://github.com/mrousavy/nitro)) rather than HTTP. The socket is prewarmed natively at app start, before the JS bundle loads, so it's already open by the first message. Reply text and reasoning summaries stream token-by-token; turns are chained with `previous_response_id` so the model remembers the conversation.
- **Knowledge base (RAG)** - the model can call a `search_margelo_kb` tool, which queries a [Pinecone](https://www.pinecone.io/) index (integrated embedding, so raw text goes up and Pinecone embeds it server-side) over [`react-native-nitro-fetch`](https://github.com/margelo/react-native-nitro-fetch). Margelo questions are answered from the retrieved context, never from the model's memory.
- **Rendering** - replies render as native markdown with a streaming animation and tappable links ([`react-native-enriched-markdown`](https://github.com/software-mansion-labs/react-native-enriched-markdown)). The collapsible "thought process" opens in a bottom sheet ([`react-native-true-sheet`](https://github.com/lodev09/react-native-true-sheet)).
- **List** - a keyboard-aware [`@legendapp/list`](https://github.com/LegendApp/legend-list) with anchored end-space, for ChatGPT-style scroll and anchor behavior while a reply streams in.
- **Look** - real Liquid Glass surfaces on iOS 26+ ([`@callstack/liquid-glass`](https://github.com/callstack/liquid-glass)) with plain fallbacks everywhere else, a Skia shimmer "Thinking" label ([`@shopify/react-native-skia`](https://github.com/Shopify/react-native-skia)), and SF Symbols that fall back to Material Design Icons on Android.
- **Attachments** - pick images ([`react-native-image-picker`](https://github.com/react-native-image-picker/react-native-image-picker)), sent to the model as base64 data URLs and shown as thumbnails ([`react-native-nitro-image`](https://github.com/mrousavy/react-native-nitro-image)).

### Requirements

Runs on **iOS and Android** (New Architecture). Liquid Glass needs **iOS 26+**; on older iOS and on Android those surfaces fall back to a plain rounded style.

- Xcode + CocoaPods, Node `22.23.3` (see `.node-version`), and the [React Native environment](https://reactnative.dev/docs/set-up-your-environment).
- An **OpenAI API key** and a populated **Pinecone index** for the knowledge-base tool.

> **Note:** this is a demo. The API keys live in the app bundle, which is fine locally but unsafe for production - anyone can extract them. For anything real, put a relay server in front and keep the keys server-side.

### Setup

```sh
cd app
npm install
cp src/config.example.ts src/config.ts   # then fill in your keys
cd ios && pod install && cd ..
```

Open `src/config.ts` and add your OpenAI key, Pinecone key, and index host. This file is gitignored and never committed.

### Run

```sh
cd app
npm start          # Metro
npm run ios        # build + launch on the iOS simulator/device
npm run android    # build + launch on the Android emulator/device
```

Other scripts (also run in CI):

```sh
npm run lint                 # oxlint, including type-aware rules; warnings fail
npm run typecheck            # tsc --noEmit
npm run format               # oxfmt; preserves import and package-field order
npm run format:check         # oxfmt --check
npm run secrets              # inspect tracked files without printing secret values
npm run security             # rnsec; findings need review
npm run react-compiler-check # react-compiler healthcheck
npm test                     # jest
```

Husky runs lint, formatting, and a staged-credential check before each commit.
Use the pinned Node version; the vendored TypeScript lint plugin requires native
type stripping. The 13 selected anti-slop rules are registered as errors. Their
source commit and license are in `app/tools/vendor/anti-slop/UPSTREAM.md`.

The exact legacy-file override in `.oxlintrc.json` preserves the existing demo
during the first tooling slice. It does not exempt future files in those folders.
Remove a file from that override when its feature logic is replaced. A raw-input
decoder can suppress `anti-slop/no-unknown-parameters` on its parameter declaration
with a named rule and a reason after `--`. The lint fixtures verify this exception
and rejection of undocumented suppressions. The Effect plugin stays unregistered.

CI runs each check separately. The existing app-shell test mocks native navigation;
it does not establish device rendering, keyboard behavior, or streaming fidelity.
The React Compiler healthcheck is a report, not proof that every component compiled.

The first rnsec baseline has six findings in the inherited demo: unvalidated links
and JSON, raw connection-error logging, an exported Android launcher, and no Android
network security configuration. The security CI job remains a blocking check.
Review or fix these findings during the implementation slices; do not suppress the
whole baseline. Native builds still need verification after Xcode license acceptance.

All four native patches apply during a clean `npm ci`. The Nitro Symbols patch now
records the upstream file's missing final newline correctly, preserving its Swift
extension and closing brace. Package installation fails if any patch fails.

### Project structure

```
app/
  src/
    config.ts                 # API keys (gitignored; copy from config.example.ts)
    theme.ts                  # dark theme + shared markdown design tokens
    markdownStyle.ts          # maps the theme onto the markdown renderer
    notImplemented.ts         # "demo only" alert for stubbed controls
    state/
      chatStore.ts            # zustand store: chat state, streaming, tool-call loop
    openai/
      protocol.ts             # builds Responses API requests, parses server events
      connectionManager.ts    # module-level WebSocket lifecycle + reconnect with backoff
    rag/
      searchKnowledgeBase.ts  # Pinecone knowledge-base search (the model's tool)
    hooks/
      useAttachments.ts       # image picking
    screens/
      RootDrawer.tsx          # pager: recents <-> chat
      ChatScreen.tsx          # the conversation, list, and composer wiring
      RecentsScreen.tsx       # chat history (mocked for the UI pass)
    components/
      ChatMessages.tsx        # subscription boundary: only re-renders on message changes
      Composer.tsx            # the input pill (grow/shrink, attachment thumbnails)
      AttachmentMenu.tsx      # the "+" dropdown for picking attachments
      MessageBubble.tsx       # user bubble / assistant markdown + reasoning trace
      ReasoningSheet.tsx      # bottom sheet showing the thinking trace
      ShimmerText.tsx         # Skia shimmer "Thinking" label
      Header.tsx              # top bar
      Glass.tsx               # Liquid Glass wrapper with a plain fallback
      Icon.tsx                # SF Symbol with a Material Design Icon fallback
      EmptyState.tsx          # centered logo before the first message
      ScrollToBottomButton.tsx
```

### Open-source libraries

This app stands on the shoulders of these projects (thank you to their authors):

- [react-native](https://github.com/facebook/react-native) & [react](https://github.com/facebook/react) - Meta
- [react-native-nitro-modules](https://github.com/mrousavy/nitro) - Marc Rousavy / Margelo
- [react-native-nitro-websockets](https://github.com/mrousavy/nitro) - Marc Rousavy / Margelo
- [react-native-nitro-image](https://github.com/mrousavy/react-native-nitro-image) - Marc Rousavy / Margelo
- [react-native-nitro-fetch](https://github.com/margelo/react-native-nitro-fetch) & [react-native-nitro-text-decoder](https://github.com/margelo/react-native-nitro-fetch) - Szymon Kapała / Margelo
- [react-native-nitro-symbols](https://github.com/DaveyEke/react-native-nitro-symbols) - Dave Mkpa Eke / Margelo
- [react-native-reanimated](https://github.com/software-mansion/react-native-reanimated) & [react-native-worklets](https://github.com/software-mansion/react-native-reanimated) - Software Mansion
- [react-native-keyboard-controller](https://github.com/kirillzyusko/react-native-keyboard-controller) - Kiryl Ziusko / Margelo
- [@legendapp/list](https://github.com/LegendApp/legend-list) - LegendApp
- [react-native-enriched-markdown](https://github.com/software-mansion-labs/react-native-enriched-markdown) - Software Mansion
- [react-native-true-sheet](https://github.com/lodev09/react-native-true-sheet) - Jovanni Lo
- [@shopify/react-native-skia](https://github.com/Shopify/react-native-skia) - Shopify
- [@callstack/liquid-glass](https://github.com/callstack/liquid-glass) - Callstack
- [react-native-pager-view](https://github.com/callstack/react-native-pager-view) - Callstack
- [zeego](https://github.com/nandorojo/zeego) - Fernando Rojo
- [@react-native-menu/menu](https://github.com/react-native-menu/menu) - Jesse Katsumata
- [@react-native-vector-icons/material-design-icons](https://github.com/oblador/react-native-vector-icons) - Joel Arvidsson
- [react-native-image-picker](https://github.com/react-native-image-picker/react-native-image-picker) - community
- [react-native-safe-area-context](https://github.com/AppAndFlow/react-native-safe-area-context) - Janic Duplessis
- [react-native-bootsplash](https://github.com/zoontek/react-native-bootsplash) & [react-native-edge-to-edge](https://github.com/zoontek/react-native-edge-to-edge) - Mathieu Acthernoene
- Vector database: [Pinecone](https://www.pinecone.io/) · Model API: [OpenAI](https://openai.com/)
