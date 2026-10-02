const { execFileSync } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { z } = require('zod');
const { cleanEnvironment, git } = require('../verification/snapshot.cjs');
const { readLock } = require('./catalog.cjs');
const {
  actor,
  missingKey,
  pullReceipts,
  readPublicKey,
  receiptProblems,
  receiptSchema,
} = require('./receipts.cjs');
const { globPattern, requiredSkills } = require('./routing.cjs');

const recordsDirectory = 'tools/skills/records';
const recordFile = /^tools\/skills\/records\/([a-z0-9-]+)\.json$/u;

const changeId = /^[a-z0-9-]+$/u;
const findingSchema = z
  .strictObject({
    finding: z.string().min(1),
    cites: z.string().min(1),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/u)
      .optional(),
    patch: z
      .string()
      .regex(/^[0-9a-f]{40}$/u)
      .optional(),
    none: z.string().min(1).optional(),
  })
  .refine(
    finding => (finding.commit === undefined) !== (finding.none === undefined),
    'needs exactly one resolution: "commit" with the fixing commit, or "none" with the reason',
  )
  .refine(
    finding => finding.patch === undefined || finding.commit !== undefined,
    'has a "patch" without the "commit" it identifies',
  );
const recordSchema = z.strictObject({
  change: z.string().regex(changeId),
  skills: z
    .array(
      z.strictObject({
        skill: z.string().min(1),
        files: z.array(z.string().min(1)).min(1),
        reason: z.string().min(1).optional(),
        findings: z.array(findingSchema),
        receipts: z.array(receiptSchema),
      }),
    )
    .min(1),
  review: z
    .strictObject({
      skills: z
        .array(
          z.strictObject({
            skill: z.string().min(1),
            findings: z.array(findingSchema),
            receipts: z.array(receiptSchema),
          }),
        )
        .min(1),
    })
    .optional(),
});

// A copy keeps its patch-id unless a conflict changed its diff.
function patchIds(root, revisions) {
  const run = (args, input) =>
    execFileSync('git', args, {
      cwd: root,
      env: cleanEnvironment(),
      encoding: 'utf8',
      input,
      maxBuffer: 256 * 1024 * 1024,
    });
  const log = run([
    'log',
    '--patch',
    '--no-color',
    '--no-ext-diff',
    '--find-renames',
    '--format=commit %H',
    ...revisions,
  ]);
  const ids = new Map();
  for (const line of run(['patch-id', '--stable'], log).split('\n')) {
    const [patch, commit] = line.split(' ');
    if (commit) ids.set(commit, patch);
  }
  return ids;
}

function rangeCommits(root, change) {
  const commits = new Map(
    git(root, ['rev-list', `${change.base}..${change.head}`])
      .split('\n')
      .filter(Boolean)
      .map(commit => [commit, undefined]),
  );
  for (const [commit, patch] of patchIds(root, [
    `${change.base}..${change.head}`,
  ]))
    commits.set(commit, patch);
  return commits;
}

function headReader(root, head) {
  return path => {
    try {
      return git(root, ['show', `${head}:${path}`]);
    } catch {
      return null;
    }
  };
}

function workingReader(root) {
  return path =>
    existsSync(join(root, path))
      ? readFileSync(join(root, path), 'utf8')
      : null;
}

function sectionsOf(path, record) {
  return [
    ...record.skills.map(entry => ({ path, role: 'author', entry })),
    ...(record.review?.skills ?? []).map(entry => ({
      path,
      role: 'review',
      entry,
    })),
  ];
}

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

const labelOf = ({ path, role, entry }) =>
  `${path}: ${role === 'review' ? 'review of ' : ''}${entry.skill}`;

function entryProblems(section, routing, required) {
  const { role, entry } = section;
  const problems = [];
  if (!routing.skills[entry.skill])
    problems.push(
      `${labelOf(section)} is not a catalogued skill in tools/skills/routing.json.`,
    );
  else if (role === 'author' && !required.has(entry.skill) && !entry.reason)
    problems.push(
      `${labelOf(section)} is not required for this change; give a reason for applying it.`,
    );
  if (!entry.findings.length)
    problems.push(
      `${labelOf(section)} has no findings. When the skill found nothing, record that with "none" and the reason.`,
    );
  return problems;
}

function citationProblems(section, lock) {
  const sections = lock.skills[section.entry.skill];
  if (!sections) return [];
  return section.entry.findings
    .filter(
      ({ cites }) =>
        !sections.headings.includes(cites) && !sections.rules.includes(cites),
    )
    .map(
      ({ finding, cites }) =>
        `${labelOf(section)} finding "${finding}" cites "${cites}", which is not a heading or numbered rule of ${section.entry.skill} in tools/skills/catalog.lock.json.`,
    );
}

function findingProblems(section, commits) {
  const problems = [];
  for (const { finding, commit: cited, patch } of section.entry.findings) {
    if (cited === undefined) continue;
    const citation = `${labelOf(section)} finding "${finding}" cites ${cited}`;
    const bySha = [...commits.keys()].filter(commit =>
      commit.startsWith(cited),
    );
    if (!patch)
      problems.push(
        `${citation} without its patch-id. Run npm run skills:record -- <change-id> <base> to add it.`,
      );
    else if (bySha.length === 1 && commits.get(bySha[0]) !== patch)
      problems.push(`${citation}, whose patch-id is not ${patch}.`);
    else if (bySha.length !== 1 && ![...commits.values()].includes(patch))
      problems.push(
        `${citation}, which matches no commit in this range by SHA or patch-id.`,
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

// A pull request needs an independent review of every record. Elsewhere, a
// review is checked only when a record has one, so an author's own run passes.
function checkRecords(root, routing, change, { pullRequest }) {
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
  const commits = rangeCommits(root, change);
  const read = headReader(root, change.head);
  const checked = required.size > 0 || records.length > 0;
  const { lock, problems: lockProblems } = readLock(read, routing);
  if (checked) problems.push(...lockProblems);
  const sections = records.flatMap(({ path, record }) =>
    sectionsOf(path, record),
  );
  const seen = new Set();
  for (const section of sections) {
    const id = `${section.path} ${section.role} ${section.entry.skill}`;
    if (seen.has(id)) problems.push(`${labelOf(section)} appears twice.`);
    seen.add(id);
    problems.push(
      ...entryProblems(section, routing, required),
      ...findingProblems(section, commits),
      ...(lock ? citationProblems(section, lock) : []),
    );
  }
  if (pullRequest)
    for (const { path, record } of records)
      if (!record.review)
        problems.push(
          `${path} has no review section, and a pull request needs an independent review of every record. The reviewer loads each required skill with the Skill tool, then runs npm run skills:record -- ${record.change} <base> --review.`,
        );
  problems.push(
    ...coverageProblems(
      required,
      sections
        .filter(({ role }) => role === 'author')
        .map(({ entry }) => entry),
    ),
  );
  const key = readPublicKey(read);
  if (checked && lock && !key) problems.push(missingKey());
  if (checked && lock && key)
    problems.push(
      ...receiptProblems(
        sections,
        [...required.keys()],
        { key, lock, routing, change, commits },
        pullRequest || sections.some(({ role }) => role === 'review'),
      ),
    );
  return {
    problems,
    commits: commits.size,
    records: records.map(({ path }) => path),
    required: required.size,
  };
}

function citePatch(root, commits, finding) {
  if (finding.commit === undefined) return;
  if (!finding.patch) {
    let commit;
    try {
      commit = git(root, [
        'rev-parse',
        '--verify',
        `${finding.commit}^{commit}`,
      ]);
    } catch {
      return;
    }
    finding.patch = patchIds(root, ['-1', commit]).get(commit);
  }
  const inRange = [...commits.keys()].some(commit =>
    commit.startsWith(finding.commit),
  );
  const copy = [...commits].find(([, patch]) => patch === finding.patch);
  if (!inRange && copy) finding.commit = copy[0].slice(0, 12);
}

function scaffold(record, required, review) {
  for (const { skill, reasons } of required) {
    let entry = record.skills.find(candidate => candidate.skill === skill);
    if (!entry) {
      entry = { skill, files: [], findings: [], receipts: [] };
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
  if (!review) return;
  record.review ??= { skills: [] };
  for (const { skill } of required) {
    if (!record.review.skills.some(entry => entry.skill === skill))
      record.review.skills.push({ skill, findings: [], receipts: [] });
  }
  record.review.skills.sort((a, b) => (a.skill < b.skill ? -1 : 1));
}

// Pulls receipts for one side of the record. The other side's sessions are
// excluded, so an author's receipt never stands in for a reviewer's.
function pullSection(record, change, commits, pull) {
  const own = record.review ? record.review.skills : [];
  const [entries, others] = pull.review
    ? [own, record.skills]
    : [record.skills, own];
  const excluded = new Set(others.flatMap(entry => entry.receipts).map(actor));
  const context = {
    key: pull.key,
    lock: pull.lock,
    routing: pull.routing,
    change,
    commits,
  };
  const required = new Set(
    requiredSkills(pull.routing, change).required.map(({ skill }) => skill),
  );
  const missing = [];
  for (const entry of entries) {
    if (!pull.routing.skills[entry.skill]) continue;
    const pulled = pullReceipts(entry, pull.candidates, context, excluded);
    if (!pulled && required.has(entry.skill)) missing.push(entry.skill);
  }
  return missing;
}

// `pull` holds { review, candidates, key, lock, routing }, read from the
// working tree and the receipts file. Returns the path and the skills that
// still have no receipt.
function writeRecord(root, change, id, pull) {
  if (!changeId.test(id))
    throw new Error('Name the change in lowercase-with-dashes.');
  const path = join(root, recordsDirectory, `${id}.json`);
  const record = existsSync(path)
    ? recordSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    : { change: id, skills: [] };
  scaffold(record, requiredSkills(pull.routing, change).required, pull.review);
  const commits = rangeCommits(root, change);
  for (const finding of [
    ...record.skills,
    ...(record.review?.skills ?? []),
  ].flatMap(entry => entry.findings))
    citePatch(root, commits, finding);
  const missing = pull.lock ? pullSection(record, change, commits, pull) : [];
  mkdirSync(join(root, recordsDirectory), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return { path, missing };
}

module.exports = { checkRecords, workingReader, writeRecord };
