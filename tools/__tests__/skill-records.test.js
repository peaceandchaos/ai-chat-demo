const { spawnSync } = require('node:child_process');
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { git } = require('../verification/snapshot.cjs');

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

let repository;
let base;
let work;

function write(path, text) {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(join(repository, path), text);
}

function commit(message) {
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', message]);
  return git(repository, ['rev-parse', 'HEAD']);
}

function recordOn(branch, records, remove = []) {
  git(repository, ['checkout', '--quiet', '-B', branch, work]);
  git(repository, ['clean', '--force', '-d', '--quiet']);
  for (const path of remove) rmSync(join(repository, path));
  for (const record of records)
    write(`tools/skills/records/${record.change}.json`, JSON.stringify(record));
  return commit(`chore: record ${branch}`);
}

function skills(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repository,
    encoding: 'utf8',
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
  commit: commit.slice(0, 12),
  patch: patchOf(commit),
});

beforeAll(() => {
  repository = realpathSync(mkdtempSync(join(tmpdir(), 'records-fixture-')));
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'core.hooksPath', '/dev/null']);
  git(repository, ['config', 'user.name', 'Records fixture']);
  git(repository, ['config', 'user.email', 'fixture@example.invalid']);
  write('tools/skills/routing.json', JSON.stringify(routing));
  write('README.md', '# Fixture\n');
  // A merged record covers everything, but it is not part of any later range.
  write(
    'tools/skills/records/merged.json',
    JSON.stringify({
      change: 'merged',
      skills: ['always', 'source-care'].map(skill => ({
        skill,
        files: ['**', '<change>'],
        findings: [{ finding: 'Looked.', none: 'Fine.' }],
      })),
    }),
  );
  base = commit('Base');
  write('src/a.ts', 'export const a = 1;\n');
  work = commit('feat: add a');
});

afterAll(() => rmSync(repository, { recursive: true, force: true }));

test('passes when the records in the range cover every required skill and resolve every finding', () => {
  const head = recordOn(
    'clean',
    [
      {
        change: 'lower',
        skills: [
          {
            skill: 'always',
            files: ['<change>'],
            findings: [cite('A loose name.', work)],
          },
        ],
      },
      {
        change: 'upper',
        skills: [
          {
            skill: 'source-care',
            files: ['src/**'],
            findings: [{ finding: 'Checked a.ts.', none: 'Nothing to fix.' }],
          },
          {
            skill: 'extra',
            files: ['src/a.ts'],
            reason: 'The export is new.',
            findings: [{ finding: 'Checked callers.', none: 'None exist.' }],
          },
        ],
      },
    ],
    ['tools/skills/records/merged.json'],
  );
  const result = skills(['check', base]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    `Skill records for ${range(head, 2)} cover all 2 required skills (tools/skills/records/lower.json, tools/skills/records/upper.json).\n`,
  );
});

test('reports each missing skill, outside commit, unknown skill, and unexplained entry', () => {
  const head = recordOn('broken', [
    {
      change: 'broken',
      skills: [
        {
          skill: 'source-care',
          files: ['docs/**'],
          findings: [
            cite('Fixed before.', base),
            { ...cite('Mislabelled.', work), patch: '0'.repeat(40) },
          ],
        },
        {
          skill: 'source-care',
          files: ['src/**'],
          findings: [{ finding: 'Fixed nowhere.', commit: 'abcdef1' }],
        },
        {
          skill: 'ghost',
          files: ['src/**'],
          reason: 'Felt right.',
          findings: [{ finding: 'Looked.', none: 'Fine.' }],
        },
        { skill: 'extra', files: ['src/**'], findings: [] },
      ],
    },
  ]);
  const result = skills(['check', base]);
  expect(result.stdout).toBe('');
  expect(result.status).toBe(1);
  const path = 'tools/skills/records/broken.json';
  expect(result.stderr).toBe(
    [
      `Skill records for ${range(head, 2)} fail:`,
      `${path}: source-care finding "Fixed before." cites ${base.slice(0, 12)}, which matches no commit in this range by SHA or patch-id.`,
      `${path}: source-care finding "Mislabelled." cites ${work.slice(0, 12)}, whose patch-id is not ${'0'.repeat(40)}.`,
      `${path}: source-care appears twice.`,
      `${path}: source-care finding "Fixed nowhere." cites abcdef1 without its patch-id. Run npm run skills:record -- <change-id> <base> to add it.`,
      `${path}: ghost is not a catalogued skill in tools/skills/routing.json.`,
      `${path}: extra is not required for this change; give a reason for applying it.`,
      `${path}: extra has no findings. When the skill found nothing, record that with "none" and the reason.`,
      'always is required by every-change for <change>, but no skill record covers it.',
      '',
    ].join('\n'),
  );
});

test('rejects a finding without exactly one resolution and a record named for another change', () => {
  recordOn('unresolved', [
    {
      change: 'unresolved',
      skills: [
        {
          skill: 'always',
          files: ['<change>'],
          findings: [
            { finding: 'Open.' },
            { finding: 'Both.', commit: work.slice(0, 12), none: 'Also.' },
          ],
        },
      ],
    },
  ]);
  const misnamed = {
    change: 'other',
    skills: [
      {
        skill: 'always',
        files: ['<change>'],
        findings: [{ finding: 'Looked.', none: 'Fine.' }],
      },
    ],
  };
  write('tools/skills/records/renamed.json', JSON.stringify(misnamed));
  const head = commit('chore: add a misnamed record');
  const result = skills(['check', base]);
  expect(result.status).toBe(1);
  const resolution =
    'needs exactly one resolution: "commit" with the fixing commit, or "none" with the reason';
  expect(result.stderr).toBe(
    [
      `Skill records for ${range(head, 3)} fail:`,
      'tools/skills/records/renamed.json: change must be renamed.',
      `tools/skills/records/unresolved.json: skills.0.findings.0 ${resolution}`,
      `tools/skills/records/unresolved.json: skills.0.findings.1 ${resolution}`,
      'always is required by every-change for <change>, but no skill record covers it.',
      'source-care is required by source for src/a.ts, but no skill record covers it.',
      '',
    ].join('\n'),
  );
});

test('fails a range that changes no record', () => {
  git(repository, ['checkout', '--quiet', '-B', 'unrecorded', work]);
  const result = skills(['check', base]);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    [
      `Skill records for ${base.slice(0, 12)}..${work.slice(0, 12)} (1 commit) fail:`,
      'No skill record changed in this range. Run npm run skills:record -- <change-id> <base>.',
      'always is required by every-change for <change>, but no skill record covers it.',
      'source-care is required by source for src/a.ts, but no skill record covers it.',
      '',
    ].join('\n'),
  );
});

test('scaffolds a record once and keeps its findings when run again', () => {
  git(repository, ['checkout', '--quiet', '-B', 'scaffold', work]);
  const first = skills(['record', 'scaffold', base]);
  expect(first.stderr).toBe('');
  expect(first.stdout).toBe(
    "Wrote tools/skills/records/scaffold.json. Add each skill's findings and their resolutions.\n",
  );
  const path = join(repository, 'tools/skills/records/scaffold.json');
  const scaffold = JSON.parse(readFileSync(path, 'utf8'));
  expect(scaffold).toEqual({
    change: 'scaffold',
    skills: [
      { skill: 'always', files: ['<change>'], findings: [] },
      { skill: 'source-care', files: ['src/a.ts'], findings: [] },
    ],
  });
  scaffold.skills[0].findings.push({ finding: 'Kept.', none: 'Fine.' });
  writeFileSync(path, JSON.stringify(scaffold));
  expect(skills(['record', 'scaffold', base]).status).toBe(0);
  const again = readFileSync(path, 'utf8');
  expect(JSON.parse(again)).toEqual(scaffold);
  expect(skills(['record', 'scaffold', base]).status).toBe(0);
  expect(readFileSync(path, 'utf8')).toBe(again);
});

test('accepts a citation whose commit was cherry-picked onto a new base, and the scaffold cites the copy', () => {
  const head = recordOn('original', [
    {
      change: 'original',
      skills: [
        {
          skill: 'always',
          files: ['<change>'],
          findings: [{ finding: 'Named a fix.', commit: work.slice(0, 12) }],
        },
        {
          skill: 'source-care',
          files: ['src/**'],
          findings: [{ finding: 'Checked a.ts.', none: 'Fine.' }],
        },
      ],
    },
  ]);
  expect(skills(['record', 'original', base]).status).toBe(0);
  const path = join(repository, 'tools/skills/records/original.json');
  const filled = JSON.parse(readFileSync(path, 'utf8'));
  expect(filled.skills[0].findings[0]).toEqual(cite('Named a fix.', work));
  commit('chore: add the patch-id');
  git(repository, ['checkout', '--quiet', '-B', 'picked', base]);
  write('README.md', '# Fixture moved on\n');
  const moved = commit('docs: move the base');
  git(repository, ['cherry-pick', `${base}..original`]);
  const picked = git(repository, ['rev-parse', 'HEAD']);
  const copy = git(repository, ['rev-parse', 'HEAD~2']);
  expect(copy).not.toBe(work);
  const result = skills(['check', moved]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    `Skill records for ${moved.slice(0, 12)}..${picked.slice(0, 12)} (3 commits) cover all 2 required skills (tools/skills/records/original.json).\n`,
  );
  expect(head).not.toBe(picked);
  expect(skills(['record', 'original', moved]).status).toBe(0);
  expect(JSON.parse(readFileSync(path, 'utf8')).skills[0].findings[0]).toEqual(
    cite('Named a fix.', copy),
  );
});
