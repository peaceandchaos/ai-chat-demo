# Current implementation plan

Updated 29 September 2026. Starting commit: `6fd91118260a377d4010c574534d18b8dd22adb7`.

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
- Post-merge failure holds unrelated merges and releases. Revert needs approval. A specifically approved repair waives only target health, never its own checks.
- The target-health controller reads metadata from trusted default-branch code. It never checks out PR code. GitHub event delay is an accepted limit.
- Preserve the original nine commits. Review tooling/workspace, server, and saved-chat/client foundations as three groups before one baseline PR.
- Global skill guidance stays generic. `.agents/skills/test-prune/SKILL.md` is the maintained source; explicitly copy reviewed changes to the global install and compare hashes.

### Progress and evidence

- Local commit `dab4fe9` adds instructions, matching repository/global `test-prune`, staged/committed verification, dependency policy, iOS scanner scope, and candidate GitHub controls. Its staged snapshot passed a clean install, lint, formatting, and credential checks.
- The retained suite and control regressions pass 108 checks locally after the test-prune changes. Deliberate missing-event and empty-replay faults fail the strengthened assertions. A broken committed fixture remains failing despite unstaged code and gate fixes. A real skipped Jest case is rejected by the acceptance runner.
- The user approved the eight-family dependency repair proposal and selected a GitHub App bot. Neither selection establishes that the repairs or remote controls are complete.

- The approved dependency review found 39 affected npm package entries, 14 advisory-bearing families, and 42 advisories. This dated scan is not a clean result. No remedy has been applied.
- Source review found four shared-source rnsec findings and two Android-only findings. Excluding Android does not fix the shared findings.
- The original 103 tests passed at the starting checkpoint. That is local evidence, not hosted or native acceptance.
- The available GitHub login is the owner/admin account. A distinct limited actor and removal of owner credentials from the agent environment remain prerequisites for remote writes.
- Xcode license acceptance and native build verification remain with the owner. No native verification is claimed.

Update this section with meaningful results, decisions, and unresolved failures as work proceeds. Keep task history concise.

## Next: native iOS transport

Repair cancellation and redirects in the native adapter before connecting it to the client. Use a controlled local server and narrow native harness. Verify cancellation, loss around acceptance, app lifecycle, credentialed redirects/admission errors, and split/truncated/large streams. Fake-driver tests remain contract evidence only.

## Later: application and hosted acceptance

The server jobs, provider adapters, saved-chat archive, and client protocol exist as separate foundations. Connect the session controller and the user-owned UI later. Verify parallel chats, saved reply branches, background completion, durable receipt, and provider compaction across the full path before claiming completion. Hosted tests, provider spending, deployment, and release require their own authorization.
