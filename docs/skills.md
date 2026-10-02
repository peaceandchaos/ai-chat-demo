# Skill routing

`tools/skills/routing.json` maps kinds of change to the skills an agent must apply. `npm run skills:required` reads a change, matches it against the rules, and prints each required skill with the rule and file that require it. The same change always prints the same sorted output.

## Set the skill roots

Skill files live outside this repository. `routing.json` names each skill's root, and each root names an environment variable. Set the two roots that have no default before you run the script:

```sh
export SKILL_ROOT_PSTACK=<pstack checkout>/plugins/pstack/skills
export SKILL_ROOT_GLOW_GUIDES=<glow-guides checkout>/skills
```

`SKILL_ROOT_REPO` defaults to `.agents/skills`, and `SKILL_ROOT_USER` defaults to `~/.claude/skills`. The script fails and names the variable when a root is unset or missing, when a skill has no `<root>/<skill>/SKILL.md`, or when that file declares a different `name:`. `npm run skills:catalog` resolves every catalogued skill.

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

The command adds every required skill with the files that require it and keeps any findings already in the file, so running it again is safe. Fill in what each skill found:

```json
{
  "skill": "principle-boundary-discipline",
  "files": ["packages/server/src/**"],
  "findings": [
    {
      "finding": "The handler trusted a parsed header.",
      "commit": "2958652b9656"
    },
    {
      "finding": "Checked the new route.",
      "none": "It already parses its input."
    }
  ]
}
```

A finding names the commit that resolves it, or gives the reason under `none`. A skill that found nothing still records one `none` finding. A skill the routing did not require needs a `reason` field.

`npm run skills:check -- origin/main` reads only the records that the range adds or changes, from the head commit. It fails when:

- a required skill has no entry whose `files` globs cover each file that requires it
- a finding has no resolution, or has both
- a cited commit is not in the range
- an entry names a skill outside the catalog, appears twice in one record, has no findings, or is not required and has no `reason`
- the range changes no record

`verify:commit` and the pre-push hook run this check against the merge base with `origin/main`. Pass `--base <ref>` to use another base. `verify:current` runs it only when it gets `--base`, because CI checks out one commit without history.

The check proves that a change claimed each required skill and that every finding it recorded has a resolution. It does not prove the skill was applied well, or that the findings are complete. Review judges that.

### Where records live

Records live in the repository, so `verify:commit` checks the same commit offline in a fresh clone, and review sees the record in the diff next to the code. Each change has its own file, so stacked branches do not conflict: a range that spans two stacked changes reads both records.

Records stay in the tree after merge, and git history keeps every version. The check ignores records that a range does not change, so old records cost one small file per change and never affect later checks. Remove old records only by owner decision.

## Limits

The routing lists skills. It cannot tell whether an agent read or applied one. `security-review` is a Claude Code command with no skill file, so the catalog leaves it out.
