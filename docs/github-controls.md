# GitHub acceptance controls

This is the reviewed local setup, not evidence that remote enforcement is active. On 29 September 2026, the public personal fork `peaceandchaos/ai-chat-demo` had no rulesets. Its default Actions token was read-only and Actions approval of PR reviews was disabled. Preserve those settings. The read-only default is a default, not a ceiling. Any workflow can request `statuses: write` or `checks: write` in its `permissions` block, as `target-health.yml` does.

Actions run on this fork. GitHub registered `ci.yml` and started CI on the first bot push on 30 September 2026.

## Bot identity

The user selected a GitHub App bot on the current Mac account. `PeaceAndChaos Codex Agent` is installed only on `peaceandchaos/ai-chat-demo`. Its webhook and user OAuth flow are disabled. Local authentication was verified on 30 September 2026.

| Repository permission                                   | Access         | Purpose                                |
| ------------------------------------------------------- | -------------- | -------------------------------------- |
| Contents                                                | Read and write | Publish candidate branches             |
| Pull requests                                           | Read and write | Open and update PRs                    |
| Workflows                                               | None           | Removed after the enforcement exercise |
| Actions                                                 | Read-only      | Inspect CI results                     |
| Metadata                                                | Read-only      | Identify the repository                |
| Administration, checks, statuses, secrets, environments | None           | Remain outside the bot's authority     |

Use an **installation access token**, which identifies the bot. A user access token would act as the owner. Do not give the app a ruleset bypass. The owner approves its PRs; the bot must not merge them automatically.

The owner removed Workflows write from the app on 30 September 2026, after the baseline push and the enforcement exercise. GitHub then rejected bot pushes that add or edit a workflow, and returned HTTP 403 when the bot tried to create a status, a check run, or a workflow dispatch. The bot has no Statuses, Checks, or Actions write permission, and CI runs with a read-only token, so it has no route to a required result. A later workflow change needs a temporary owner grant for that one reviewed PR. While Workflows write existed, a bot workflow on an unreviewed `submission/**` branch could have published results as the GitHub Actions app, ID `15368`.

No permission removes one limit. CI runs the candidate's own code, so a candidate can weaken its own tests or check list. Those results are real, not forged, and CODEOWNERS review of every test and checking file is the control against them.

The private key is stored in macOS Keychain. The local helper verifies the app and installation identities, requests a short-lived installation token, and checks that it grants exactly the permissions above to this one repository. The replaced key was revoked after verification, and the downloaded PEM was removed. Do not put private keys or tokens in chat, tracked files, URLs, shell history, or build artifacts.

The user chose the current Mac account and declined a separate OS user. Owner credentials and the owner's authenticated GitHub browser remain accessible on this account. The helper provides a distinct bot identity and restricted token; it does not isolate the agent from those other credentials. Agent writes must use the bot. Report this remaining limitation when describing enforcement. Local hooks and instructions do not create a credential boundary.

Sources: [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), [installation-token identity](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps), [credential guidance](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app).

## Checks and rules

`tools/github/integration-rules.json` defines the intended repository ruleset. The owner applies it in two stages, described in the bootstrap section below. It protects every branch except `submission/**`. These refs are candidate uploads, not acceptance targets. Do not merge or promote work through them. The repository owner can still deliberately change rules.

Require `quality-gate` and `target-health` from the GitHub Actions app, ID `15368`. Require a PR, current checks, owner review, dismissal of stale approvals, approval after the latest push, and resolved review conversations. Permit no bypass actors, force pushes, deletion, or merge commits on protected targets. Keep auto-merge disabled. CODEOWNERS assigns all files to the owner during this milestone.

CI uses pinned actions and Ubuntu 24.04. For PRs it verifies the candidate head and proposed merge result in separate clean checkouts. Push CI verifies the actual resulting commit. The full implemented suite includes lint, formatting, types, meaningful tests, credentials, the iOS/shared scanner, dependency policy, server build, iOS release JavaScript bundling, and the compiler report. The compiler report fails only if the tool crashes, so it is a report, not a gate. The overall check fails if a verification job fails, skips, or is cancelled.

Only PR runs publish the required `quality-gate` check. Push runs name their gate `post-push-gate`. A push run on a PR's head branch therefore cannot replace a failed merge-result check with a later success on the same commit. Each candidate also defines its own check list in `tools/verification/checks.cjs`, so owner review of that file is the control that keeps the list complete.

The target-health controller checks the latest push run for the target's exact current SHA, then checks its required jobs and steps. A test ties those job and step names to `ci.yml`. It sets status on the PR head, not its own workflow SHA. If multiple PRs share that head, all their targets must pass. It rechecks PR and target identities before publishing success. It reads metadata and trusted default-branch code only; it never executes PR code or downloads candidate artifacts or caches.

GitHub events and status updates are asynchronous. This is not an atomic merge lock. If the controller fails before it marks a PR head `pending`, an earlier `success` on that head remains until the next complete run. Required-check provenance still depends on owner review of workflows and checking code. Any future deployment mechanism must explicitly require a healthy target; there is no release automation in this milestone.

Sources: [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs), [latest-attempt jobs](https://docs.github.com/en/rest/actions/workflow-jobs), [rulesets](https://docs.github.com/en/rest/repos/rules).

## Repair and first publication

When an accepted target fails, hold unrelated merges and releases. The owner may dispatch `Target health` on the default branch with `operation=approve-repair`, the PR number, exact candidate SHA, and exact failing target SHA. The controller requires a completed push run for that target that failed verification. A failed, timed-out, or startup-failed run qualifies, and so does a successful run whose required jobs or steps did not pass. A missing, pending, or cancelled run does not qualify. Rerun a cancelled run instead. If the target has no push run at all, only an owner ruleset change can release the hold.

The approval binds the PR, candidate SHA, target SHA, target run ID, and target run attempt. The controller chooses the run and attempt; the owner does not supply them. The approval counts only while its dispatch is a first attempt that succeeded, and while the run name records the same PR, candidate, and target. Dispatch again instead of rerunning an old approval. A new push, target commit, or target rerun invalidates the approval. This grants only a target-health exception; full candidate checks and owner review still apply. A revert needs separate approval.

With one human reviewer, `require_last_push_approval` means the owner cannot approve their own push. Let the bot update a stale candidate branch. The owner's **Update branch** button creates an owner push that the owner cannot approve.

The first baseline is a bootstrap case. Its target does not contain the trusted workflows yet. `pull_request_target`, `workflow_run`, and `workflow_dispatch` all read the workflow file from the default branch, so the baseline PR receives no `target-health` result at all. That missing result is not a pass. The owner approves the one-time installation order explicitly:

1. Apply the bootstrap ruleset from the owner account. It is `integration-rules.json` without the `target-health` entry, so `main` requires a PR, owner review, and `quality-gate` before the baseline can merge. Until the owner applies it, the bot's Contents write can update `main` directly.

   ```sh
   node tools/github/ruleset.cjs bootstrap | gh api -X POST repos/peaceandchaos/ai-chat-demo/rulesets --input -
   ```

2. Review the nine original commits in the agreed three groups and review the new controls. All candidate checks must pass.
3. Merge with **Rebase and merge**. It keeps each commit as a separate commit on `main`, with new SHAs. **Squash and merge** collapses them into one commit.
4. Confirm that push CI and `post-push-gate` pass for the resulting `main` commit.
5. Update the ruleset to the full `integration-rules.json`, including `target-health`. Use the `id` that step 1 returned.

   ```sh
   node tools/github/ruleset.cjs full | gh api -X PUT repos/peaceandchaos/ai-chat-demo/rulesets/<id> --input -
   ```

6. Test the rules before accepting another change, then remove the app's Workflows write permission and confirm the bot can no longer push a workflow. All six steps were completed on 30 September 2026.

The hosted exercise on 30 September 2026 used labelled test PRs #2 to #8 and #11 to #13, which stay open as history. With a fresh owner approval and a passing `target-health`, GitHub blocked each candidate whose `quality-gate` failed, was missing, was skipped, or was cancelled. A skipped gate job reports under its unevaluated name expression, so the required check stays missing. A content change after approval dismissed the approval, and an outdated base was blocked. A bot rebase kept the displayed approval, but the last-push rule still required a fresh one. Rerunning `main`'s push run held open PRs until it passed. On the disposable target `exercise/creation-from-green`, an owner-approved repair released only its bound PR, an unrelated PR stayed held, and a target rerun revoked the approval. Two defects appeared only on GitHub and are fixed: unrestricted protected-branch creation, and repair approvals that GitHub's `details_url` rewrite made unusable. Owner credentials remain reachable on this Mac account, and `target-health` updates are asynchronous.

Nobody can create a protected branch while the ruleset is active. The `creation` rule applies to every branch except `submission/**`, and the ruleset has no bypass actors. On 30 September 2026, before this rule existed, the bot created `exercise/creation-from-green` at a commit that carried both required results. Every open PR head carries both results before review, so the bot could create an undeletable protected branch from unreviewed code. Creation at the `main` tip was rejected because that commit carries `post-push-gate`, not `quality-gate` or `target-health`. To add a new integration target, the owner edits the ruleset deliberately, creates the branch from a reviewed `main` commit, and restores the rule.
