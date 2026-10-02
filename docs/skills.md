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

## Limits

The routing lists skills. It cannot tell whether an agent read or applied one. `security-review` is a Claude Code command with no skill file, so the catalog leaves it out.
