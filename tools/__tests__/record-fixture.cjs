// The git fixture that the skill-record tests share. Each test file that
// requires it gets its own copy, because Jest isolates modules per file.
const { spawnSync } = require('node:child_process');
const {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { git } = require('../verification/snapshot.cjs');
const {
  installHook,
  makeKey,
  signReceipt,
  skillPayload,
} = require('./receipt-fixture.cjs');

const cli = resolve(__dirname, '../skills/cli.cjs');

const routing = {
  roots: { main: { env: 'SKILL_ROOT_MAIN' } },
  skills: { always: 'main', 'source-care': 'main', extra: 'main' },
  rules: [
    { id: 'every-change', scope: 'change', why: 'Always.', skills: ['always'] },
    {
      id: 'source',
      scope: 'file',
      why: 'Source.',
      paths: ['src/**'],
      skills: ['source-care'],
    },
  ],
};
const skillText = name =>
  `---\nname: ${name}\n---\n\n# ${name}\n\n## Steps\n\n1. Look.\n2. Fix.\n`;

let scratch;
let repository;
let skillsRoot;
let hook;
let base;
let work;
let middle;
let later;
let receipt;

function write(path, text) {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(join(repository, path), text);
}

function commit(message) {
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', message]);
  return git(repository, ['rev-parse', 'HEAD']);
}

function writeRecords(records) {
  for (const record of records)
    write(
      `tools/skills/records/${record.change}.json`,
      JSON.stringify({ base: { commit: base }, ...record }),
    );
}

// Commits records on `from`. A record without a base starts at the fixture's
// base commit.
function recordOn(branch, records, remove = [], from = work) {
  git(repository, ['checkout', '--quiet', '-B', branch, from]);
  git(repository, ['clean', '--force', '-d', '--quiet']);
  for (const path of remove) rmSync(join(repository, path));
  writeRecords(records);
  return commit(`chore: record ${branch}`);
}

function skills(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      SKILL_ROOT_MAIN: skillsRoot,
      SKILL_RECEIPTS_DIR: join(scratch, 'no-receipts'),
      GITHUB_EVENT_NAME: undefined,
      ...env,
    },
  });
}

// Signs a receipt through the real hook, in `cwd` at its current HEAD.
function sign(skill, options = {}) {
  const { cwd = repository, key = 'key', state = 'state', ...extra } = options;
  return signReceipt(hook, skillPayload(skill, cwd, extra), {
    SKILL_RECEIPTS_DIR: join(scratch, state),
    SKILL_RECEIPTS_KEY: join(scratch, `${key}.pem`),
  });
}

const range = (head, commits) =>
  `${base.slice(0, 12)}..${head.slice(0, 12)} (${commits} commits)`;

function patchOf(commit) {
  const shown = git(repository, ['show', commit]);
  return spawnSync('git', ['patch-id', '--stable'], {
    cwd: repository,
    input: `${shown}\n`,
    encoding: 'utf8',
  }).stdout.split(' ')[0];
}

const cite = (finding, commit) => ({
  finding,
  cites: 'Steps 1',
  commit: commit.slice(0, 12),
  patch: patchOf(commit),
});
const looked = (finding = 'Looked.', none = 'Fine.') => ({
  finding,
  cites: 'Steps',
  none,
});
const authored = (skill, files, ...receipts) => ({
  skill,
  files,
  findings: [looked()],
  receipts,
});
const reviewed = (skill, ...receipts) => ({
  skill,
  findings: [looked()],
  receipts,
});
const noAuthorReceipt = (change, skill) =>
  `tools/skills/records/${change}.json: ${skill} has no valid author receipt. Load it with the Skill tool, then run npm run skills:record -- ${change} <base>.`;

function setUpRecordFixture() {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'records-fixture-')));
  repository = join(scratch, 'repository');
  skillsRoot = join(scratch, 'skills');
  for (const name of ['always', 'source-care', 'extra', 'ghost']) {
    mkdirSync(join(skillsRoot, name), { recursive: true });
    writeFileSync(join(skillsRoot, name, 'SKILL.md'), skillText(name));
  }
  hook = installHook(join(scratch, 'hooks'), {
    plugins: {},
    user: skillsRoot,
    repo: [],
  });
  const publicKey = makeKey(join(scratch, 'key.pem'));
  makeKey(join(scratch, 'other-key.pem'));
  mkdirSync(repository);
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'core.hooksPath', '/dev/null']);
  git(repository, ['config', 'user.name', 'Records fixture']);
  git(repository, ['config', 'user.email', 'fixture@example.invalid']);
  write('tools/skills/routing.json', JSON.stringify(routing));
  write('tools/skills/receipt-public-key.pem', publicKey);
  write('README.md', '# Fixture\n');
  const locked = skills(['catalog', '--lock']);
  if (locked.status !== 0) throw new Error(locked.stderr);
  // A merged record covers everything, but it is not part of any later range.
  write(
    'tools/skills/records/merged.json',
    JSON.stringify({
      change: 'merged',
      skills: ['always', 'source-care'].map(skill => ({
        skill,
        files: ['**', '<change>'],
        findings: [looked()],
        receipts: [],
      })),
    }),
  );
  base = commit('Base');
  receipt = { atBase: sign('always') };
  write('src/a.ts', 'export const a = 1;\n');
  work = commit('feat: add a');
  receipt.always = sign('always');
  receipt.source = sign('source-care');
  receipt.reviewAlways = sign('always', { session_id: 'session-review' });
  receipt.reviewSource = sign('source-care', { session_id: 'session-review' });
  receipt.subagentAlways = sign('always', { agent_id: 'agent-review' });
  receipt.subagentSource = sign('source-care', { agent_id: 'agent-review' });
  // A stack: the lower record covers base..middle, and each test adds an
  // upper record whose base is middle and whose range adds src/b.ts.
  git(repository, ['checkout', '--quiet', '-B', 'stack', work]);
  writeRecords([
    {
      change: 'lower',
      skills: [
        authored('always', ['<change>'], receipt.always),
        authored('source-care', ['src/**'], receipt.source),
      ],
      review: {
        skills: [
          reviewed('always', receipt.reviewAlways),
          reviewed('source-care', receipt.reviewSource),
        ],
      },
    },
  ]);
  middle = commit('chore: record lower');
  write('src/b.ts', 'export const b = 2;\n');
  later = commit('feat: add b');
  receipt.upperAlways = sign('always');
  receipt.upperSource = sign('source-care');
  receipt.upperExtra = sign('extra');
  receipt.upperReviewAlways = sign('always', { session_id: 'session-review' });
  receipt.upperReviewSource = sign('source-care', {
    session_id: 'session-review',
  });
  return {
    scratch,
    repository,
    skillsRoot,
    hook,
    base,
    work,
    middle,
    later,
    receipt,
  };
}

function removeRecordFixture() {
  rmSync(scratch, { recursive: true, force: true });
}

module.exports = {
  cli,
  skillText,
  write,
  commit,
  writeRecords,
  recordOn,
  skills,
  sign,
  range,
  patchOf,
  cite,
  looked,
  authored,
  reviewed,
  noAuthorReceipt,
  setUpRecordFixture,
  removeRecordFixture,
};
