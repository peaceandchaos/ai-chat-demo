# Personal iOS chat: foundation checkpoint

This repository extends the [Margelo chat demo](https://blog.margelo.com/building-native-llm-chat-app-with-rag). The visible app still uses the inherited demo screens and direct-provider connection. The new server, saved-chat archive, and connection client are separate foundations. They are not connected to those screens yet.

The user owns the UI. Current engineering scope is iOS and shared app/server code. Android sources remain inherited material outside this milestone.

Read [AGENTS.md](AGENTS.md) for task boundaries and [PLANS.md](PLANS.md) for the current milestone. [Provider contracts](docs/providers.md) describe the approved provider behavior. [Dependency review](docs/dependencies.md) records all findings from the dated scan.

## Setup and commands

Use Node `22.23.3` from `.node-version`. Install from the repository root:

```sh
npm ci
cp packages/app/src/config.example.ts packages/app/src/config.ts
```

Keep the example values for static checks. Do not put provider credentials in the app. Native builds require Xcode, CocoaPods, and `pod install` in `packages/app/ios`. Xcode license acceptance and native build verification remain pending; the current local checks do not establish device behavior.

```sh
npm start                    # Metro
npm run ios                  # native build and launch
npm run lint                 # selected Oxlint rules; warnings fail
npm run format               # format without import/package-field sorting
npm run format:check
npm run typecheck
npm test                     # ordinary local test feedback
npm run test:verified        # also reject empty/skipped/unfinished suites
npm run secrets
npm run security             # iOS/shared scan; HIGH or undisposed app findings block
npm run audit:check          # all high/critical findings block
npm run build:server
npm run build:ios-js          # release JS bundle; not native compilation
npm run react-compiler-check # report; not proof of native compilation
npm run verify:commit -- HEAD
```

## Verification and review

The pre-commit hook checks lint, formatting, and credentials in a snapshot of the Git index. It performs a fresh locked install there. It cannot use unstaged fixes or your local `node_modules`. The pre-push hook runs the full implemented suite for each commit being published.

`verify:commit` runs the selected commit's own checking code in a fresh checkout. It records the commit, tree, commands, results, and source integrity in ignored `.quality-results/`. A commit that tracks files under `.quality-results/` fails, so a candidate cannot supply its own result records. Only committed example configuration enters that checkout. Checks cannot silently change source while running. Logs and results remain available after the temporary checkout is removed.

Local hooks are feedback controls and remain bypassable by the machine owner. Git runs the hooks only after `npm ci` has installed them in that checkout. A new worktree without an install skips them without warning. Acceptance also requires protected GitHub checks and owner review. CI checks both the PR head and proposed merge result, then checks the exact resulting commit after a push. Only PR runs publish the required `quality-gate` check; push runs publish `post-push-gate`. Every implemented check must finish successfully. The compiler report fails only if the tool crashes, so it is a report, not a gate. Dependency and scanner failures remain failures.

The GitHub target-health workflow reads trusted code and API metadata. It checks the current target's latest post-push result. Missing, pending, failed, cancelled, or incomplete verification holds unrelated merges. An owner-authorized repair exception requires a completed push run that failed verification. It binds one PR, head SHA, target SHA, and target run attempt, and it counts only from a fresh successful approval dispatch. A target rerun invalidates that approval; candidate checks and reviews still apply. Event delivery is asynchronous. Remote rules and controller behavior require hosted verification before we can claim enforcement. See [GitHub setup](docs/github-controls.md).

The GitHub App bot is installed and its repository-scoped authentication is verified. The user chose the current Mac account. The bot key is in Keychain, and agent writes use its installation token. The owner approves PRs through their normal account. Owner credentials remain accessible on this Mac account, so the setup does not establish credential isolation. The bot has no Workflows, Statuses, Checks, or Actions write permission, so it cannot publish a required result. Hosted enforcement tests on 30 September 2026 confirmed the ruleset and this limit; see [GitHub setup](docs/github-controls.md).

The 13 selected anti-slop rules remain errors. Their source and license are in `tools/vendor/anti-slop/UPSTREAM.md`. Exact legacy-file overrides preserve inherited demo files until their feature logic is replaced. A raw-input decoder may suppress `anti-slop/no-unknown-parameters` on the parameter declaration with a named rule and reason after `--`. Existing fixtures verify that exception and reject undocumented suppressions. The Effect plugin remains unregistered.

Every high/critical dependency advisory blocks acceptance, regardless of exposure. Moderate/low findings have dated dispositions in `tools/verification/dependency-dispositions.json`; new or expired findings need review. No update or override is automatic.

The scanner excludes Android-specific files and scans the remaining app. Stream and tool arguments receive schema validation; raw network errors are not logged. Reply links require HTTP/HTTPS, structural validation, and OS support. Checks exercise React Native's actual JavaScript URL implementation. The fresh scanner run reports no shared-code findings and six medium dependency entries. The separate dependency gate checks their advisory dispositions. Any other scanner finding fails unless `tools/verification/security-dispositions.json` records a current, reasoned disposition for it. Neither check proves native networking safety. All four native patches and the Metro patch must apply during `npm ci`.

## Test review

The reusable `test-prune` skill lives in `.agents/skills/test-prune/SKILL.md`. This is the maintained source. Copy reviewed changes explicitly to the global Codex skill and compare hashes; do not link the two directories or update them during package installation.

The test review removed an empty shell smoke check and strengthened two existing event-order/replay assertions. Deliberately missing model events and empty replay results now fail those checks. SQL, local-socket, archive, protocol, and parser checks retain their distinct behavioral protection. Full app E2E and native transport verification remain later milestones.

## Workspace

`packages/app` contains the native app, archive, and client protocol. `packages/server` contains provider adapters, durable job logic, and authenticated routes. `shared` contains validated wire contracts. Install dependencies and run checks at the root. Native projects remain inside the app package; Metro and CocoaPods resolve workspace dependencies.

### Connection foundation checkpoint

`packages/app/src/network/client.ts` implements the server protocol behind injected
HTTP, WebSocket, and text-decoder drivers. Manual Gateway submissions use HTTP;
GPT and Auto use a shared socket. Recovery reads an existing attempt. Reader abort
and explicit Stop use separate operations. Runtime schemas validate delivery, and
large inputs upload acknowledged parts before one commit. This layer never retries
a submission automatically. Its consumer must persist acceptance, results, and
cursors before acknowledging them to the server.

This layer is not connected to the app yet. The user owns the UI work. The existing
screens and mocked Recents list retain their UI. The demo store now validates tool inputs,
and the old connection no longer logs raw errors. Its native connection behavior is unchanged.
The native transport binding remains separate work.

Before native integration, fix or replace the streaming adapter in the installed
`react-native-nitro-fetch` package. Inspection of `src/fetch.ts` found that
`nitroStreamFetch` does not connect `init.signal` or stream cancellation to the native
request. It also does not enforce `init.redirect`. The iOS builder follows redirects
after its callback. The new driver must stop native readers and reject credentialed
redirects. Disable header recording in the network inspector before using the device
credential. These are source findings; native behavior still needs a device check.

Focused client tests use injected drivers. They verify protocol routing, parallel
reply isolation, multipart handoff, interrupted delivery, explicit cancellation,
large snapshots, and invalid data. They do not prove native networking or end-to-end
app recovery. Hosted CI requires a push; local checks are reported separately.

### Session controller checkpoint

`packages/app/src/state/session.ts` connects the saved-chat archive to the
transport. It is not connected to the screens yet. `attempt.ts` reads each
saved reply into one phase: unsent, accepted, Stop pending, final but not yet
confirmed to the server, or settled. Each phase has one next operation. Every
reply has its own runner, so one chat's failure, refusal, or reconnect does not
pause another. Token updates stay in memory and reach storage on a bounded
checkpoint. Acceptance, final results, and Stop are saved before the session
continues. The phone acknowledges a reply only after its final result is saved.
Recovery resends the same attempt or receipt and never creates a new version.
A submit refusal is trusted only when a resend of the same attempt is refused
again. `nativeSession.ts` forwards React Native `AppState` to the session;
backgrounding detaches readers without cancelling server work.

Integration tests in `packages/server/tests/session-*.test.ts` run the real
archive, `ServerTransport`, and session against `handleRequest` and the socket
route's `SocketConnection` over PGlite, with the real worker and scripted fake
providers. They live in the server suite because PGlite does not load under the
React Native jest preset. They do not prove native networking, device lifecycle
behavior, or the hosted Workflow runtime.

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
