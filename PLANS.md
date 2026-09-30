# Current implementation plan

Updated 30 September 2026. Starting commit: `6fd91118260a377d4010c574534d18b8dd22adb7`.

## Current milestone: quality foundation

The user approved repository instructions, repository/global `test-prune`, checks of staged and committed content, owner review for tests/controls, and GitHub acceptance controls. Specific dependency updates still require review. The nine existing commits remain intact.

| Work                   | Done means                                                                                                                          | Failure or remaining boundary                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Instructions and skill | Commands and boundaries match the implementation; repository and global skill copies match.                                         | A future capability is described as working, or copies drift.                      |
| Test quality           | Remove the empty app-shell smoke check; strengthen missing-event and empty-replay assertions in existing scenarios.                 | Removing useful protection or accepting a vacuous result.                          |
| Local checks           | Staged checks use the index. Full checks use a fresh locked install of the specified commit and record commit/tree/results.         | Unstaged code or existing dependencies supply a hidden fix.                        |
| CI                     | PR head and proposed merge result are checked; post-push checks record the exact resulting commit. Every required job must succeed. | Missing, cancelled, skipped, stale, or failed checks appear green.                 |
| Dependency policy      | Every advisory is reviewed; approved fixes remove all high/critical findings. Lower severities have dated dispositions.             | A high finding is waived, or an update is applied without review.                  |
| iOS/shared scanner     | Android-only files are excluded; applicable findings are fixed or precisely adjudicated.                                            | Broad shared-source suppression or claiming the JS scanner proves native safety.   |
| GitHub controls        | Separate limited actor; PR and owner review; strict current checks on every integration target; trusted target-health check.        | Owner credentials remain available to the agent, or remote behavior is unverified. |

### Decisions

- `submission/**` refs hold unaccepted candidates. Every other acceptance/integration target requires the configured PR controls.
- All test files, check scripts, workflows, configurations, suppressions, and instructions require owner review.
- Post-merge failure holds unrelated merges and releases. Revert needs approval. A specifically approved repair waives only target health, never its own checks. Approval requires a completed push run that failed verification (not cancelled) and binds its run ID and attempt. A fresh successful approval dispatch must name the same PR, candidate, and target. Rerunning the target invalidates approval.
- The target-health controller reads metadata from trusted default-branch code. It never checks out PR code. GitHub event delay is an accepted limit.
- Preserve the original nine commits. Review tooling/workspace, server, and saved-chat/client foundations as three groups before one baseline PR.
- The user delegated the brace-expansion patch, fork Actions handling, and bot-permission choices on 30 September. The patch moves the approved overrides to 1.1.21 and 5.0.12.
- Only PR runs publish `quality-gate`; push runs publish `post-push-gate`, which the target-health controller reads.
- Use the GitHub App from the current Mac account, as the user selected. Agent writes use its repository-scoped installation token. Owner credentials remain accessible on this account, so this setup does not establish credential isolation.
- Global skill guidance stays generic. `.agents/skills/test-prune/SKILL.md` is the maintained source; explicitly copy reviewed changes to the global install and compare hashes.

### Progress and evidence

- Repository instructions, matching repository/global test-prune, staged/committed verification, and candidate GitHub controls are implemented locally.
- The empty smoke test was removed; missing model events, empty replay, malformed stream data, and unsafe reply links have meaningful regression checks. Link checks use React Native's actual JavaScript URL implementation with the OS boundary mocked.
- Approved parser/image-tool, Workflow, Metro, and Joi repairs are installed. The fresh audit reports zero high/critical and 15 moderate package entries with dated dispositions. The scanner reports no shared-code findings and six medium dependency entries, covered by the separate advisory policy.
- Both Metro asset paths and the release iOS JavaScript bundle pass. The already-locked Babel export-namespace transform is now directly declared and enabled. The bundle joins the full committed suite; it is not native compilation.
- Source-integrity diagnostics corrected the generated SWC cache allowance and lint-fixture cleanup. Unexpected source changes remain blocked. Run the full suite on the final commit before publication.
- The 30 September control review found that the bot's Workflows write permission lets it publish required results from an unreviewed `submission/**` workflow, and that the bot can update `main` until a ruleset exists. The user delegated both decisions. A bootstrap ruleset protects `main` before the baseline merges (`tools/github/ruleset.cjs`). The owner removed Workflows write after the enforcement exercise, and GitHub then rejected bot workflow pushes and bot status, check, and dispatch calls. The same review fixed repair deadlocks, rerun re-approval, borrowed approval runs, and duplicate `quality-gate` names. The compiler report is non-gating.
- GitHub App installation and local authentication are verified. The replacement key is in macOS Keychain; the old key was revoked and the downloaded PEM removed.
- PR #1 merged by rebase on 30 September 2026. `main` is `6ec51a3`, whose tree matches the tested head `014b6b8`. Hosted CI passed on the PR head, the proposed merge, and `main`'s push run (36742620898). The owner ran the approval and merge because Claude Code's permission classifier blocks the agent from acting under the owner account; the approval text records this. No deployment or paid provider call has occurred.
- Ruleset `24258945` is active with the full rules and a `creation` rule. The hosted enforcement exercise is complete (see `docs/github-controls.md`); it found and fixed unrestricted protected-branch creation (#10) and unusable repair approvals (#14).
- The owner accepted the Xcode 27.0 license. Native networking repair and the session controller are in progress on separate branches.
  Update this section with meaningful results, decisions, and unresolved failures as work proceeds. Keep task history concise.

## Next: native iOS transport

Repair cancellation and redirects in the native adapter before connecting it to the client. Use a controlled local server and narrow native harness. Verify cancellation, loss around acceptance, app lifecycle, credentialed redirects/admission errors, and split/truncated/large streams. Fake-driver tests remain contract evidence only.

## Later: application and hosted acceptance

The server jobs, provider adapters, saved-chat archive, and client protocol exist as separate foundations. Connect the session controller and the user-owned UI later. Verify parallel chats, saved reply branches, background completion, durable receipt, and provider compaction across the full path before claiming completion. Hosted tests, provider spending, deployment, and release require their own authorization.
