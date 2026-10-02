# Skill routing

`tools/skills/routing.json` maps kinds of change to the skills an agent must apply. `npm run skills:required` reads a change, matches it against the rules, and prints each required skill with the rule and file that require it. The same change always prints the same sorted output.

## Set the skill roots

Skill files live outside this repository. `routing.json` names each skill's root, and each root names an environment variable. Set the two roots that have no default before you run the script:

```sh
export SKILL_ROOT_PSTACK=<pstack checkout>/plugins/pstack/skills
export SKILL_ROOT_GLOW_GUIDES=<glow-guides checkout>/skills
```

`SKILL_ROOT_REPO` defaults to `.agents/skills`, and `SKILL_ROOT_USER` defaults to `~/.claude/skills`. The script fails and names the variable when a root is unset or missing, when a skill has no `<root>/<skill>/SKILL.md`, or when that file declares a different `name:`. `npm run skills:catalog` resolves every catalogued skill. `npm run skills:catalog -- --lock` rewrites `tools/skills/catalog.lock.json` from the skill files. The lock holds each skill's SHA-256, headings, and numbered rules. CI has no skill files and reads the lock instead. Review a lock change like a check change.

## List the skills for a change

For a branch, pass the base. The script diffs the merge base with `HEAD`, or with a head you name:

```sh
npm run skills:required -- origin/main
npm run skills:required -- origin/main work/feature
```

Before you write code, list the files you plan to touch. A bare path is a modified file. `A:`, `D:`, and `R:<old>:` mark added, deleted, and renamed files:

```sh
npm run skills:required -- --plan packages/server/src/models.ts A:packages/server/src/limits.ts
```

A plan has no file contents or commits, so the script lists the content rules it could not evaluate. Run the branch form again after you commit.

## How rules match

Every filter in a rule must match. A `change` rule matches the whole change once, as the subject `<change>`, when a changed file falls outside its `excludePaths`. It can also require a minimum number of changed lines in those files (`minChangedLines`) or a matching commit subject (`commitSubject`). A `file` rule matches each changed file that passes all of its filters: `paths`, `excludePaths`, `status`, `addedLines` (a case-insensitive pattern tested against added lines), and `removedExports` (an ES or CommonJS export that the change deletes or renames). A renamed file matches by its old or new path.

Globs match whole repository paths. `**` matches any number of directories, including dot directories. `*` and `?` stay within one directory. `{a,b}` matches either choice. Other characters, including `[`, match literally.

`large-change` requires `thermo-nuclear-code-quality-review` above 400 changed lines. That is a judgment of what one reviewer reads in one sitting. Lockfile and skill-record lines do not count.

## Record the skills a change applied

Each change carries a record at `tools/skills/records/<change-id>.json`. Write or update it from the branch:

```sh
npm run skills:record -- skill-routing origin/main
```

The command adds every required skill with the files that require it and keeps any findings already in the file. It also copies receipts for those skills from the receipts file, as [Prove each load with a signed receipt](#prove-each-load-with-a-signed-receipt) describes. Running it again changes nothing.

The command stores the base as the record's `base`, with the commit and its patch-id:

```json
"base": { "commit": "e22c06d6553fe1465e67fa558db1a2d93e2f7569", "patch": "1fe66208be68d67a4ee6cf844c7ef1caa7e16206" }
```

The base starts the record's own range. The range ends at the nearest later base of any record at the head commit, or at the head. A stack of changes therefore splits into one range per record, and each record answers only for its own commits. After a rebase, the check finds the base by its patch-id in the checked range. Fill in what each skill found:

```json
{
  "skill": "principle-boundary-discipline",
  "files": ["packages/server/src/**"],
  "findings": [
    {
      "finding": "The handler trusted a parsed header.",
      "cites": "Boundary Discipline",
      "commit": "2958652b9656",
      "patch": "5f0c3e1d9a7b2c4e6f8091a3b5c7d9e1f2a4b6c8"
    },
    {
      "finding": "Checked the new route.",
      "cites": "Boundary Discipline",
      "none": "It already parses its input."
    }
  ],
  "receipts": [
    { "v": 1, "skill": "principle-boundary-discipline", "sig": "..." }
  ]
}
```

Each finding cites the heading or numbered rule of the skill that produced it. A numbered rule is its heading and number, such as `Steps 2`. The check reads the allowed citations from the lock, and `catalog.lock.json` lists them for each skill. Never type a receipt. `skills:record` writes them.

A finding names the commit that resolves it, or gives the reason under `none`. Write only `commit`. `skills:record` adds `patch`, the commit's `git patch-id --stable`. A cherry-picked or rebased copy of the commit keeps that patch-id when its diff applies unchanged, so the citation still resolves on a new branch. Run `skills:record` again on the new branch, and it rewrites `commit` to the copy in the range. A copy whose conflict you resolved by hand gets a new patch-id, and so does a squash of several commits, so a citation of the original no longer resolves. Cite the new commit instead. A skill that found nothing still records one `none` finding. A skill the routing did not require needs a `reason` field.

`npm run skills:check -- origin/main` reads only the records that the range adds or changes, from the head commit. It fails when:

- a record's `base` is not an ancestor of the head, and no commit in the range has its patch-id
- a commit in the range falls in no changed record's own range
- a skill that a record's own range requires has no entry in that record whose `files` globs cover each file that requires it
- an author entry has no valid receipt
- a record has a `review` section, and a review entry has no valid receipt from a session and agent pair that made none of the record's author receipts, or a skill that the record's range requires has no review entry
- a pull request run finds a record in the range without a `review` section
- a record holds an invalid receipt
- a finding cites a heading or rule that the lock does not list for its skill
- the head commit has no `tools/skills/catalog.lock.json` or no `tools/skills/receipt-public-key.pem`
- a finding has no resolution, or has both
- a cited commit has no `patch`, or no commit in the range has that SHA or patch-id
- a cited commit is in the range but its patch-id differs from `patch`
- an entry names a skill outside the catalog, appears twice in one record, has no findings, or is not required and has no `reason`
- the range changes no record

A run is a pull request run when `GITHUB_EVENT_NAME` is `pull_request`. GitHub Actions sets that value for the `pull_request` event. The pre-push hook, `verify:commit`, and an author's own runs do not set it, so they pass before a reviewer adds the `review` sections. A passing pull request run ends its summary with `with independent review`.

`verify:commit` and the pre-push hook run this check against the merge base with `origin/main`. Pass `--base <ref>` to use another base. They fail when the range from the base to the commit has no commits, because the range checks would check nothing. `verify:current` runs the range checks only when it gets `--base` and the range has commits, because CI checks out one commit without history. Otherwise it lists them under `notRun` in `result.json` and ends its summary with `PASS (range checks not run: <names>)`.

The check proves that an agent loaded each required skill while working on the change, and that every finding it recorded has a resolution. It does not prove the skill was applied well, or that the findings are complete. Review judges that.

## Prove each load with a signed receipt

A Claude Code `PostToolUse` hook signs a receipt each time an agent loads a skill. The hook lives in the owner's user settings, never on a branch. `tools/skills/receipt-hook.mjs` is its reviewed source.

### Install the hook

The owner installs the hook once per machine. Set the plugin roots first, so the installer can write the roots the hook resolves skills from:

```sh
export SKILL_ROOT_PSTACK=<pstack checkout>/plugins/pstack/skills
export SKILL_ROOT_GLOW_GUIDES=<glow-guides checkout>/skills
node tools/skills/install-receipt-hook.mjs
node tools/skills/install-receipt-hook.mjs --apply
```

The first command prints every planned change and the settings diff, and writes nothing. `--apply` makes the changes:

1. It copies the hook to `~/.claude/hooks/skill-receipt-hook.mjs` and writes `~/.claude/hooks/skill-receipt-roots.json`.
2. It generates an Ed25519 keypair and writes the private key to `~/.claude/skill-receipts/private-key.pem` with mode 0600. It never replaces an existing key.
3. It backs up `~/.claude/settings.json`, then adds the `PostToolUse` entry for `Skill|Read` and the deny rules.
4. It prints the public key.

Commit the printed public key as `tools/skills/receipt-public-key.pem`. Until that file exists, `skills:check` fails every change that needs a skill. Running the installer again changes nothing. It leaves other `Skill|Read` hook entries, such as a logging spike, in place. Pass `--remove-spike` to remove them. The hook command runs the `node` that ran the installer.

The deny rules use the user-settings notation, where a path that starts with `/` is rooted at `~/.claude`. They stop the agent from reading or editing the hook and the key, from editing the receipts, and from running a shell command that names those paths.

### What a receipt holds

The hook appends one line to `~/.claude/skill-receipts/receipts.jsonl` for each Skill tool load and for each Read of a `SKILL.md`. A receipt holds the client (`claude-code` or `cursor`), the skill, the source tool, the SHA-256 of the `SKILL.md`, whether the read was partial, the session, the agent and its type, the tool use id, and the time. It also holds the SHA-256 of the working directory and of the git common dir, and the branch, `HEAD`, and patch-id of `HEAD`. The two paths are hashed, so committed records hold no machine paths. The hook signs the receipt with Ed25519 over JSON with sorted keys.

The Skill tool reports only the skill name. The hook finds the `SKILL.md` through the roots file and hashes it. A Read counts only when it has no `offset` or `limit` and returned the whole file. Any other Read of a `SKILL.md` gets `partial: true`, and the check rejects it. The hook always exits 0 and prints nothing. It writes its errors to `~/.claude/skill-receipts/errors.log`. `SKILL_RECEIPTS_DIR` and `SKILL_RECEIPTS_KEY` move the state and the key, for tests only.

### Pull receipts into the record

`npm run skills:record -- <change-id> <base>` copies receipts into the record's `skills` entries. A reviewer loads the required skills as another session or another agent and runs the same command with `--review`, which fills a `review` section. A pull request run needs one in every record that the range changes:

```json
"review": {
  "skills": [{ "skill": "unslop", "findings": [], "receipts": [] }]
}
```

The command reads only receipts made in this clone, matched by the hash of the git common dir. It keeps each entry's valid receipts and adds the earliest valid receipt to an entry that has none. The author side skips the reviewer's receipts, and the review side skips the author's. It names each required skill that still has no receipt.

A `--review` run needs the author's record, and its `<base>` must be the record's `base` or a commit with the same patch-id. It writes only the `review` section. It never changes `base`, the author entries, or their findings.

### Which receipts count

The check verifies each receipt with the committed public key. A receipt is valid when:

- the signature verifies
- the skill is in the catalog, and the receipt sits in that skill's entry
- its SHA-256 equals the lock's hash for the skill
- it is not partial
- it belongs to this change

An author receipt belongs to the record when its `head` is the record's base or a commit in the record's own range, or when its `headPatch` equals the patch-id of one of them. A review receipt and a finding's cited commit may also come from a later commit up to the head, because review and fixes follow the change. Review receipts count only when their session and agent pair appears in none of the record's author receipts.

This rule survives a cherry-pick and a rebase that keep the patches, because a copied commit keeps its patch-id. A time bound was the other candidate. It would reject every receipt after a rebase onto a newer `main`, and it would still accept a receipt from another change made after the same base. A receipt's `head` is always older than the commit that records it, so a receipt copied from a merged record can match this range only through a re-landed patch. The rule treats that patch as the same work.

### Limits

- A receipt made while `HEAD` was the base stops counting when the change moves to a newer base. Load the skill again on the branch.
- Squashing commits makes a new patch-id. Receipts made on the squashed commits stop counting. Load the skills again after a squash.
- A receipt made on the base by another change in the same clone also counts for this change. `skills:record` reads only this clone's receipts, but CI cannot check the clone, because the common-dir hash differs in CI.
- The deny rules stop an agent that names the key, the hook, or the receipts. A program that opens those files without naming them can still read the key and sign a receipt. The receipts stop lazy and mistaken claims. They do not stop deliberate forgery by a process running as the same user.
- A subagent that the author's session starts has its own agent id, so its receipts count as a reviewer's. The check cannot tell an independent reviewer from the author's helper. Review policy decides who may review.
- `skills:record --review` cannot tell which agent runs it. The hook reads the agent id from the payload that Claude Code passes to it. A command that an agent runs gets the session id in `CLAUDE_CODE_SESSION_ID`, which every agent in the session shares, and no agent id. A review run can therefore pull a receipt that another agent made. Before you commit a review, confirm that each pulled receipt is from your own load, by its `cwd` hash when you work in your own worktree.
- The pull request rule applies only where the skill-record check runs. Hosted CI runs `verify:current` without `--base`, so it skips the range checks, and the rule has no effect there yet. It takes effect when the workflow fetches history and passes the pull request's base as `--base`.
- The rule reads `GITHUB_EVENT_NAME`. A run without that value applies the author rule, so only the protected CI check can enforce review.
- A push run on `main` checks no range. After a merge, the merge base of `main` and `origin/main` is the pushed commit, so the range is empty. `verify:current` lists the range checks under `notRun`, and `verify:commit` fails until it gets an earlier `--base`.
- A receipt proves that the agent loaded the skill text. It does not prove the agent followed it. Review judges that.
- Many principle skills have one heading and no numbered rules, so a citation of one names only the skill.

### Where records live

Records live in the repository, so `verify:commit` checks the same commit offline in a fresh clone, and review sees the record in the diff next to the code. Each change has its own file, and a range that spans two stacked changes reads both records. Each record answers for its own range, so one record's receipts and entries never cover another record's commits. A range that edits an earlier change's record checks that record against its own range, even when that range starts below the checked base. After a rebase, the check finds a moved base only by its patch-id in the checked range, so check such a range from below the earlier record's base.

Records stay in the tree after merge, and git history keeps every version. The check ignores records that a range does not change, so old records cost one small file per change and never affect later checks. Remove old records only by owner decision.

## Quality ledger

`tools/skills/ledger.json` records each finding that should not recur. Each lesson has:

- `id` and `lesson`: a name and the rule to follow.
- `seen`: one line per sighting, naming the commit, branch, or PR. The count is the number of lines.
- `enforcement`: what stops the finding now. `guidance` means nothing does. `test` names a test `file` and its exact title in `name`. `type` names a test the same way, but `npm run typecheck` enforces it through a `@ts-expect-error` fixture, and Jest only runs it. `lint` names a `rule`. `check` names a `check` from `tools/verification/checks.cjs`.
- `paths` (optional): globs for guidance that applies only to some files. Without paths, a lesson applies to every change.
- `link` (optional): an https issue URL or a tracked decision file.

`npm run skills:required` prints the guidance lessons that match the change after the required skills, and names the enforced lessons it leaves out. Apply each listed lesson the same way you apply a skill.

When a finding recurs, add a line to its `seen` list, or add a lesson the first time. `npm run skills:ledger` runs in the verify suite as `quality-ledger`. It fails when:

- a guidance lesson has been seen twice or more and has no `link`.
- an enforcement names a check the suite does not run, a lint rule that `.oxlintrc.json` does not turn on, or a test title that its file does not pass as a string to a plain `test()` or `it()` call. A title in a comment, a `test.skip()`, or a `test.each()` table does not count.
- a `link` is neither an https URL nor a tracked file.
- two lessons share an id.

To promote a lesson, add the type, test, lint rule, or check in its own commit, with a fixture that fails without it. Then change the lesson's `enforcement` to name it. The routing script stops listing the lesson, and the ledger check fails if that check, rule, or test is later removed or renamed. To keep a repeated lesson as guidance, link the issue or decision that explains why.

The check confirms that the named enforcement exists. It does not prove that the enforcement catches the finding. The failing fixture in the promotion commit shows that. A title match is textual, and the counts are only as complete as the sightings people add.

## Limits

The routing lists skills. Receipts show that an agent loaded one. Nothing shows that it applied the skill well. `security-review` is a Claude Code command with no skill file, so the catalog leaves it out.
