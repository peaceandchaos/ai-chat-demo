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

- Repository instructions, matching repository/global test-prune, staged/committed verification, and candidate GitHub controls are implemented locally.
- The empty smoke test was removed; missing model events, empty replay, malformed stream data, and unsafe reply links have meaningful regression checks. Link checks use React Native's actual JavaScript URL implementation with the OS boundary mocked.
- Approved parser/image-tool, Workflow, Metro, and Joi repairs are installed. The fresh audit reports zero high/critical and 15 moderate package entries with dated dispositions. The shared/iOS scanner reports zero findings.
- Both Metro asset paths and the release iOS JavaScript bundle pass. The already-locked Babel export-namespace transform is now directly declared and enabled. The bundle joins the full committed suite; it is not native compilation.
- Source-integrity diagnostics corrected the generated SWC cache allowance and lint-fixture cleanup. Unexpected source changes remain blocked. Run the full suite on the final commit before publication.
- GitHub App provisioning, owner credential isolation, remote enforcement tests, and owner review remain pending. No push, PR, merge, deployment, or paid provider call has occurred.
- Xcode license acceptance and native build verification remain with the owner. Native networking is the next separate task.
  Update this section with meaningful results, decisions, and unresolved failures as work proceeds. Keep task history concise.

## Next: native iOS transport

Repair cancellation and redirects in the native adapter before connecting it to the client. Use a controlled local server and narrow native harness. Verify cancellation, loss around acceptance, app lifecycle, credentialed redirects/admission errors, and split/truncated/large streams. Fake-driver tests remain contract evidence only.

## Later: application and hosted acceptance

The server jobs, provider adapters, saved-chat archive, and client protocol exist as separate foundations. Connect the session controller and the user-owned UI later. Verify parallel chats, saved reply branches, background completion, durable receipt, and provider compaction across the full path before claiming completion. Hosted tests, provider spending, deployment, and release require their own authorization.
