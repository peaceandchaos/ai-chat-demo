# GitHub acceptance controls

This is the reviewed local setup, not evidence that remote enforcement is active. On 29 September 2026, the public personal fork `peaceandchaos/ai-chat-demo` had no rulesets. Its default Actions token was read-only and Actions approval of PR reviews was disabled. Preserve those settings.

## Bot identity

The user selected a GitHub App bot. The owner can keep their normal account. Register an app owned by `peaceandchaos`, available only to that account, with no webhook server or user OAuth flow. Install it only on `ai-chat-demo`.

| Repository permission                                   | Access         | Purpose                            |
| ------------------------------------------------------- | -------------- | ---------------------------------- |
| Contents                                                | Read and write | Publish candidate branches         |
| Pull requests                                           | Read and write | Open and update PRs                |
| Workflows                                               | Read and write | Submit reviewed workflow changes   |
| Actions                                                 | Read-only      | Inspect CI results                 |
| Metadata                                                | Read-only      | Identify the repository            |
| Administration, checks, statuses, secrets, environments | None           | Remain outside the bot's authority |

Use an **installation access token**, which identifies the bot. A user access token would act as the owner. Do not give the app a ruleset bypass. The owner approves its PRs; the bot must not merge them automatically.

The owner registers and installs the app through GitHub settings, then stores its private key in a credential store dedicated to the agent runtime. Generate short-lived installation tokens for this one repository. Do not put private keys or tokens in chat, tracked files, URLs, shell history, or build artifacts.

The bot does not remove owner credentials already available on this computer. A real boundary requires an agent runtime without those credentials or access to the owner's authenticated GitHub browser. Use a separate OS user or isolated remote environment, or remove the owner's credential access from the agent runtime. That environment choice and credential provisioning remain pending. Local hooks and instruction text cannot create this boundary.

Sources: [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), [installation-token identity](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps), [credential guidance](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app).

## Checks and rules

`tools/github/integration-rules.json` defines the intended repository ruleset. Review and apply it through the owner account after bootstrap. It protects every branch except `submission/**`. These refs are candidate uploads, not acceptance targets. Do not merge or promote work through them. The repository owner can still deliberately change rules.

Require `quality-gate` and `target-health` from the GitHub Actions app, ID `15368`. Require a PR, current checks, owner review, dismissal of stale approvals, approval after the latest push, and resolved review conversations. Permit no bypass actors, force pushes, deletion, or merge commits on protected targets. Keep auto-merge disabled. CODEOWNERS assigns all files to the owner during this milestone.

CI uses pinned actions and Ubuntu 24.04. For PRs it verifies the candidate head and proposed merge result in separate clean checkouts. Push CI verifies the actual resulting commit. The full implemented suite includes lint, formatting, types, meaningful tests, credentials, the iOS/shared scanner, dependency policy, server build, and the compiler report. The overall check fails if a verification job fails, skips, or is cancelled.

The target-health controller checks the latest push run for the target's exact current SHA, then checks its required jobs and steps. It sets status on the PR head, not its own workflow SHA. If multiple PRs share that head, all their targets must pass. It rechecks PR and target identities before publishing success. It reads metadata and trusted default-branch code only; it never executes PR code or downloads candidate artifacts or caches.

GitHub events and status updates are asynchronous. This is not an atomic merge lock. Required-check provenance still depends on owner review of workflows and checking code. Any future deployment mechanism must explicitly require a healthy target; there is no release automation in this milestone.

Sources: [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs), [latest-attempt jobs](https://docs.github.com/en/rest/actions/workflow-jobs), [rulesets](https://docs.github.com/en/rest/repos/rules).

## Repair and first publication

When an accepted target fails, hold unrelated merges and releases. The owner may dispatch `Target health` on the default branch with `operation=approve-repair`, the PR number, exact candidate SHA, and exact failing target SHA. This grants only a target-health exception. A new push or target commit invalidates it. Full candidate checks and owner review still apply. A revert needs separate approval.

The first baseline is a bootstrap case: its target does not yet contain the new trusted workflow. Review the nine original commits in the agreed three groups and review the new controls. All candidate checks must pass before acceptance. The owner must explicitly approve the one-time bootstrap and initial installation order; a missing target-health workflow must never silently count as a pass. After the first healthy default-branch run, activate the full ruleset and test it before accepting another change.

Before claiming enforcement, verify a deliberately failing candidate cannot merge; a missing/skipped/cancelled check blocks; a stale base blocks; a target rerun holds unrelated PRs; and an exact owner-approved repair retains every candidate check. Also verify bot permissions, owner credential isolation, CODEOWNERS matching, and rule coverage on a feature target. Local controller fixtures cannot prove these GitHub behaviors.
