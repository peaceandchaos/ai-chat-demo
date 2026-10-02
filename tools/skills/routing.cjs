const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, resolve } = require('node:path');
const { z } = require('zod');

const routingPath = 'tools/skills/routing.json';
const changeSubject = '<change>';

const regexSource = z.string().refine(source => {
  try {
    new RegExp(source, 'iu');
    return true;
  } catch {
    return false;
  }
}, 'must be a valid regular expression');
const globs = z.array(z.string().min(1)).min(1);
const ruleFields = {
  id: z.string().regex(/^[a-z0-9-]+$/u),
  why: z.string().min(1),
  skills: z.array(z.string().min(1)).min(1),
  excludePaths: globs.optional(),
};
const fileRule = z.strictObject({
  ...ruleFields,
  scope: z.literal('file'),
  paths: globs.optional(),
  status: z
    .array(z.enum(['added', 'modified', 'deleted', 'renamed']))
    .min(1)
    .optional(),
  addedLines: regexSource.optional(),
  removedExports: z.literal(true).optional(),
});
const changeRule = z.strictObject({
  ...ruleFields,
  scope: z.literal('change'),
  minChangedLines: z.int().positive().optional(),
  commitSubject: regexSource.optional(),
});
const routingSchema = z.strictObject({
  roots: z.record(
    z.string().regex(/^[a-z0-9-]+$/u),
    z.strictObject({
      env: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
      default: z.string().min(1).optional(),
    }),
  ),
  skills: z.record(z.string().regex(/^[a-z0-9-]+$/u), z.string()),
  rules: z.array(z.discriminatedUnion('scope', [fileRule, changeRule])).min(1),
});

function parseRouting(text) {
  const routing = routingSchema.parse(JSON.parse(text));
  const problems = [];
  const ids = new Set();
  for (const [skill, root] of Object.entries(routing.skills)) {
    if (!routing.roots[root])
      problems.push(`Skill ${skill} names unknown root ${root}.`);
  }
  for (const rule of routing.rules) {
    if (ids.has(rule.id)) problems.push(`Rule ${rule.id} appears twice.`);
    ids.add(rule.id);
    for (const skill of rule.skills) {
      if (!routing.skills[skill])
        problems.push(`Rule ${rule.id} names unknown skill ${skill}.`);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return routing;
}

function globPattern(glob) {
  let source = '';
  let braces = 0;
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (glob.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 2;
    } else if (glob.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else if (character === '{') {
      braces += 1;
      source += '(?:';
    } else if (character === '}' && braces) {
      braces -= 1;
      source += ')';
    } else if (character === ',' && braces) source += '|';
    else source += character.replace(/[$()+.[\\\]^{|}]/u, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

function matchesAny(path, patterns) {
  return patterns.some(glob => globPattern(glob).test(path));
}

function needsContent(rule) {
  return (
    rule.addedLines !== undefined ||
    rule.removedExports !== undefined ||
    rule.minChangedLines !== undefined ||
    rule.commitSubject !== undefined
  );
}

function fileMatches(rule, file, change) {
  const paths =
    file.status === 'renamed' ? [file.from, file.path] : [file.path];
  if (rule.paths && !paths.some(path => matchesAny(path, rule.paths)))
    return null;
  if (
    rule.excludePaths &&
    paths.every(path => matchesAny(path, rule.excludePaths))
  )
    return null;
  if (rule.status && !rule.status.includes(file.status)) return null;
  if (rule.addedLines !== undefined) {
    const pattern = new RegExp(rule.addedLines, 'iu');
    const lines = change.added.get(file.path) ?? [];
    if (!lines.some(line => pattern.test(line))) return null;
  }
  if (rule.removedExports) {
    const names = change.removedExports.get(file.path);
    return names ? { subject: file.path, detail: names.join(', ') } : null;
  }
  return { subject: file.path };
}

function changeMatch(rule, change) {
  if (rule.minChangedLines !== undefined) {
    let lines = 0;
    for (const [path, count] of change.lines) {
      if (!rule.excludePaths || !matchesAny(path, rule.excludePaths))
        lines += count;
    }
    if (lines < rule.minChangedLines) return null;
    return { subject: changeSubject, detail: `${lines} changed lines` };
  }
  if (rule.commitSubject !== undefined) {
    const pattern = new RegExp(rule.commitSubject, 'iu');
    const subjects = change.subjects.filter(subject => pattern.test(subject));
    if (!subjects.length) return null;
    return { subject: changeSubject, detail: subjects.join('; ') };
  }
  return { subject: changeSubject };
}

function ruleMatches(rule, change) {
  if (rule.scope === 'change') {
    const match = changeMatch(rule, change);
    return match ? [match] : [];
  }
  const matches = [];
  for (const file of change.files) {
    const match = fileMatches(rule, file, change);
    if (match) matches.push(match);
  }
  return matches;
}

function byText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Returns each required skill once, with every rule and subject that requires it.
function requiredSkills(routing, change) {
  const skipped = [];
  const required = new Map();
  if (!change.files.length) return { required: [], skipped };
  for (const rule of routing.rules) {
    if (change.kind === 'plan' && needsContent(rule)) {
      skipped.push(rule.id);
      continue;
    }
    const matches = ruleMatches(rule, change);
    if (!matches.length) continue;
    matches.sort((a, b) => byText(a.subject, b.subject));
    for (const skill of rule.skills) {
      if (!required.has(skill)) required.set(skill, []);
      required.get(skill).push({ rule: rule.id, why: rule.why, matches });
    }
  }
  return {
    required: [...required]
      .sort(([a], [b]) => byText(a, b))
      .map(([skill, reasons]) => ({
        skill,
        reasons: reasons.sort((a, b) => byText(a.rule, b.rule)),
      })),
    skipped: skipped.sort(byText),
  };
}

function rootDirectory(routing, name, env, repository) {
  const root = routing.roots[name];
  const configured = env[root.env] ?? root.default;
  if (!configured) {
    throw new Error(
      `Skill root ${name} is not configured. Set ${root.env} to the directory that holds <skill>/SKILL.md.`,
    );
  }
  const directory = configured.startsWith('~/')
    ? join(homedir(), configured.slice(2))
    : resolve(repository, configured);
  if (!existsSync(directory)) {
    throw new Error(
      `Skill root ${name} does not exist at ${directory}. Set ${root.env} to the directory that holds <skill>/SKILL.md.`,
    );
  }
  return directory;
}

function resolveSkill(routing, skill, env, repository) {
  const root = routing.skills[skill];
  const file = join(
    rootDirectory(routing, root, env, repository),
    skill,
    'SKILL.md',
  );
  if (!existsSync(file))
    throw new Error(
      `Skill ${skill} has no SKILL.md in root ${root} (${file}).`,
    );
  const name = /^---\n(?:.*\n)*?name:\s*(\S+)\s*\n/u.exec(
    readFileSync(file, 'utf8'),
  );
  if (name?.[1] !== skill)
    throw new Error(`${file} does not declare name: ${skill}.`);
  return file;
}

module.exports = {
  routingPath,
  changeSubject,
  parseRouting,
  matchesAny,
  requiredSkills,
  resolveSkill,
};
