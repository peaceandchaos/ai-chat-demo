const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { z } = require('zod');
const { git } = require('../verification/snapshot.cjs');
const { globPattern, requiredSkills } = require('./routing.cjs');

const recordsDirectory = 'tools/skills/records';
const recordFile = /^tools\/skills\/records\/([a-z0-9-]+)\.json$/u;

const findingSchema = z
  .strictObject({
    finding: z.string().min(1),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/u)
      .optional(),
    none: z.string().min(1).optional(),
  })
  .transform((finding, context) => {
    if ((finding.commit === undefined) === (finding.none === undefined)) {
      context.addIssue({
        code: 'custom',
        message:
          'needs exactly one resolution: "commit" with the fixing commit, or "none" with the reason',
      });
      return z.NEVER;
    }
    return finding.commit === undefined
      ? {
          finding: finding.finding,
          resolution: { kind: 'none', reason: finding.none },
        }
      : {
          finding: finding.finding,
          resolution: { kind: 'commit', commit: finding.commit },
        };
  });
const recordSchema = z.strictObject({
  change: z.string().regex(/^[a-z0-9-]+$/u),
  skills: z
    .array(
      z.strictObject({
        skill: z.string().min(1),
        files: z.array(z.string().min(1)).min(1),
        reason: z.string().min(1).optional(),
        findings: z.array(findingSchema),
      }),
    )
    .min(1),
});

function describeIssues(path, error) {
  return error.issues.map(
    issue => `${path}: ${issue.path.join('.') || 'record'} ${issue.message}`,
  );
}

function readRecords(root, change) {
  const records = [];
  const problems = [];
  for (const file of change.files) {
    const match = recordFile.exec(file.path);
    if (!match || file.status === 'deleted') continue;
    let parsed;
    try {
      parsed = recordSchema.safeParse(
        JSON.parse(git(root, ['show', `${change.head}:${file.path}`])),
      );
    } catch (error) {
      problems.push(`${file.path}: ${error.message}`);
      continue;
    }
    if (!parsed.success)
      problems.push(...describeIssues(file.path, parsed.error));
    else if (parsed.data.change !== match[1])
      problems.push(`${file.path}: change must be ${match[1]}.`);
    else records.push({ path: file.path, record: parsed.data });
  }
  return { records, problems };
}

function entryProblems(path, entry, routing, required) {
  const problems = [];
  if (!routing.skills[entry.skill])
    problems.push(
      `${path}: ${entry.skill} is not a catalogued skill in tools/skills/routing.json.`,
    );
  else if (!required.has(entry.skill) && !entry.reason)
    problems.push(
      `${path}: ${entry.skill} is not required for this change; give a reason for applying it.`,
    );
  if (!entry.findings.length)
    problems.push(
      `${path}: ${entry.skill} has no findings. When the skill found nothing, record that with "none" and the reason.`,
    );
  return problems;
}

function findingProblems(path, entry, commits) {
  const problems = [];
  for (const { finding, resolution } of entry.findings) {
    if (resolution.kind === 'none') continue;
    const matches = commits.filter(commit =>
      commit.startsWith(resolution.commit),
    );
    if (matches.length !== 1)
      problems.push(
        `${path}: ${entry.skill} finding "${finding}" cites ${resolution.commit}, which is ${matches.length ? 'ambiguous' : 'not a commit'} in this range.`,
      );
  }
  return problems;
}

function coverageProblems(required, entries) {
  const problems = [];
  for (const [skill, reasons] of required) {
    const patterns = entries
      .filter(entry => entry.skill === skill)
      .flatMap(entry => entry.files.map(globPattern));
    for (const { rule, matches } of reasons) {
      const missing = matches
        .map(match => match.subject)
        .filter(subject => !patterns.some(pattern => pattern.test(subject)));
      if (missing.length)
        problems.push(
          `${skill} is required by ${rule} for ${missing.join(', ')}, but no skill record covers it.`,
        );
    }
  }
  return problems;
}

function checkRecords(root, routing, change) {
  const required = new Map(
    requiredSkills(routing, change).required.map(({ skill, reasons }) => [
      skill,
      reasons,
    ]),
  );
  const { records, problems } = readRecords(root, change);
  if (required.size && !records.length && !problems.length)
    problems.push(
      `No skill record changed in this range. Run npm run skills:record -- <change-id> <base>.`,
    );
  const commits = git(root, ['rev-list', `${change.base}..${change.head}`])
    .split('\n')
    .filter(Boolean);
  const entries = [];
  for (const { path, record } of records) {
    const seen = new Set();
    for (const entry of record.skills) {
      if (seen.has(entry.skill))
        problems.push(`${path}: ${entry.skill} appears twice.`);
      seen.add(entry.skill);
      problems.push(
        ...entryProblems(path, entry, routing, required),
        ...findingProblems(path, entry, commits),
      );
      entries.push(entry);
    }
  }
  problems.push(...coverageProblems(required, entries));
  return {
    problems,
    records: records.map(({ path }) => path),
    required: required.size,
  };
}

function serialize(record) {
  return {
    change: record.change,
    skills: record.skills.map(({ skill, files, reason, findings }) => ({
      skill,
      files,
      ...(reason ? { reason } : {}),
      findings: findings.map(({ finding, resolution }) =>
        resolution.kind === 'commit'
          ? { finding, commit: resolution.commit }
          : { finding, none: resolution.reason },
      ),
    })),
  };
}

function writeRecord(root, routing, change, id) {
  const path = join(root, recordsDirectory, `${id}.json`);
  const record = existsSync(path)
    ? recordSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    : { change: id, skills: [] };
  for (const { skill, reasons } of requiredSkills(routing, change).required) {
    let entry = record.skills.find(candidate => candidate.skill === skill);
    if (!entry) {
      entry = { skill, files: [], findings: [] };
      record.skills.push(entry);
    }
    for (const { matches } of reasons) {
      for (const { subject } of matches) {
        if (!entry.files.some(glob => globPattern(glob).test(subject)))
          entry.files.push(subject);
      }
    }
    entry.files.sort();
  }
  record.skills.sort((a, b) => (a.skill < b.skill ? -1 : 1));
  mkdirSync(join(root, recordsDirectory), { recursive: true });
  writeFileSync(path, `${JSON.stringify(serialize(record), null, 2)}\n`);
  return path;
}

module.exports = { checkRecords, writeRecord };
