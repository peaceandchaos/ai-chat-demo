const { spawnSync } = require('node:child_process');
const {
  existsSync,
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
const noReviewerReceipt = (change, skill) =>
  `tools/skills/records/${change}.json: review of ${skill} has no valid receipt from a session and agent pair that made none of this record's author receipts. The reviewer loads it with the Skill tool, then runs npm run skills:record -- ${change} <base> --review.`;
const upperPath = 'tools/skills/records/upper.json';
// Commits an upper record on top of the stack.
const upperOn = (branch, skills, review) =>
  recordOn(
    branch,
    [{ change: 'upper', base: { commit: middle }, skills, review }],
    [],
    later,
  );
const noReview = change =>
  `tools/skills/records/${change}.json has no review section, and a pull request needs an independent review of every record. The reviewer loads each required skill with the Skill tool, then runs npm run skills:record -- ${change} <base> --review.`;

beforeAll(() => {
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
}, 30000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test('passes when the records in the range cover every required skill with receipts and resolve every finding', () => {
  const head = recordOn(
    'clean',
    [
      {
        change: 'upper',
        base: { commit: middle },
        skills: [
          {
            skill: 'always',
            files: ['<change>'],
            findings: [cite('A loose name.', later)],
            receipts: [receipt.upperAlways],
          },
          {
            skill: 'source-care',
            files: ['src/**'],
            findings: [looked('Checked b.ts.', 'Nothing to fix.')],
            receipts: [receipt.upperSource],
          },
          {
            skill: 'extra',
            files: ['src/b.ts'],
            reason: 'The export is new.',
            findings: [looked('Checked callers.', 'None exist.')],
            receipts: [receipt.upperExtra],
          },
        ],
      },
    ],
    ['tools/skills/records/merged.json'],
    later,
  );
  const result = skills(['check', base]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    `Skill records for ${range(head, 4)} cover all 2 required skills (tools/skills/records/lower.json, tools/skills/records/upper.json).\n`,
  );
});

test('checks each record against its own range, not the union of every record', () => {
  const upperPair = (always, source) => [
    authored('always', ['<change>'], ...always),
    authored('source-care', ['src/**'], ...source),
  ];
  const empty = upperOn('upper-empty', upperPair([], []));
  expect(skills(['check', base]).stderr).toBe(
    [
      `Skill records for ${range(empty, 4)} fail:`,
      noAuthorReceipt('upper', 'always'),
      noAuthorReceipt('upper', 'source-care'),
      '',
    ].join('\n'),
  );
  const borrowed = upperOn(
    'upper-borrowed',
    upperPair([receipt.always], [receipt.source]),
  );
  expect(skills(['check', base]).stderr).toBe(
    [
      `Skill records for ${range(borrowed, 4)} fail:`,
      `${upperPath}: always receipt ${receipt.always.toolUseId} was made on a commit outside this change.`,
      noAuthorReceipt('upper', 'always'),
      `${upperPath}: source-care receipt ${receipt.source.toolUseId} was made on a commit outside this change.`,
      noAuthorReceipt('upper', 'source-care'),
      '',
    ].join('\n'),
  );
  const stub = upperOn('upper-stub', [
    authored('always', ['<change>'], receipt.upperAlways),
  ]);
  expect(skills(['check', base]).stderr).toBe(
    [
      `Skill records for ${range(stub, 4)} fail:`,
      `${upperPath}: source-care is required by source for src/b.ts, but this record does not cover it.`,
      '',
    ].join('\n'),
  );
  const lowerPath = 'tools/skills/records/lower.json';
  const reloaded = recordOn(
    'lower-reloaded',
    [
      {
        change: 'lower',
        skills: [
          authored('always', ['<change>'], receipt.upperAlways),
          authored('source-care', ['src/**'], receipt.upperSource),
        ],
      },
      {
        change: 'upper',
        base: { commit: middle },
        skills: upperPair([receipt.upperAlways], [receipt.upperSource]),
      },
    ],
    [],
    later,
  );
  expect(skills(['check', base]).stderr).toBe(
    [
      `Skill records for ${range(reloaded, 4)} fail:`,
      `${lowerPath}: always receipt ${receipt.upperAlways.toolUseId} was made on a commit outside this change.`,
      noAuthorReceipt('lower', 'always'),
      `${lowerPath}: source-care receipt ${receipt.upperSource.toolUseId} was made on a commit outside this change.`,
      noAuthorReceipt('lower', 'source-care'),
      '',
    ].join('\n'),
  );
});

test('fails commits that fall in no changed record and a base outside the history', () => {
  const late = recordOn('late-base', [
    {
      change: 'late',
      base: { commit: work },
      skills: [authored('always', ['<change>'], receipt.always)],
    },
  ]);
  expect(skills(['check', base]).stderr).toBe(
    [
      `Skill records for ${range(late, 2)} fail:`,
      `No changed record's range holds 1 of the range's commits, from ${work.slice(0, 12)} to ${work.slice(0, 12)}. Give a record a base at or below ${work.slice(0, 12)}, or check from a later base.`,
      '',
    ].join('\n'),
  );
  const unknown = '0'.repeat(40);
  const lost = recordOn('lost-base', [
    {
      change: 'lost',
      base: { commit: unknown },
      skills: [authored('always', ['<change>'], receipt.always)],
    },
  ]);
  expect(skills(['check', base]).stderr).toBe(
    [
      `Skill records for ${range(lost, 2)} fail:`,
      `tools/skills/records/lost.json: base ${unknown.slice(0, 12)} is neither HEAD nor an ancestor of HEAD, and no commit in the range has its patch-id.`,
      `No changed record's range holds 2 of the range's commits, from ${work.slice(0, 12)} to ${lost.slice(0, 12)}. Give a record a base at or below ${work.slice(0, 12)}, or check from a later base.`,
      '',
    ].join('\n'),
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
          receipts: [receipt.source],
        },
        {
          skill: 'source-care',
          files: ['src/**'],
          findings: [
            { finding: 'Fixed nowhere.', cites: 'Steps', commit: 'abcdef1' },
          ],
          receipts: [],
        },
        {
          skill: 'ghost',
          files: ['src/**'],
          reason: 'Felt right.',
          findings: [looked()],
          receipts: [],
        },
        { skill: 'extra', files: ['src/**'], findings: [], receipts: [] },
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
      `${path}: always is required by every-change for <change>, but this record does not cover it.`,
      noAuthorReceipt('broken', 'source-care'),
      noAuthorReceipt('broken', 'ghost'),
      noAuthorReceipt('broken', 'extra'),
      '',
    ].join('\n'),
  );
});

test('rejects tampered, foreign-key, stale, partial, misfiled, and out-of-range receipts, and uncited findings', () => {
  const edited = { ...receipt.always, branch: 'elsewhere' };
  const otherKey = sign('always', { key: 'other-key' });
  const partial = sign(null, {
    tool_name: 'Read',
    tool_input: { file_path: join(skillsRoot, 'always/SKILL.md'), limit: 4 },
    tool_response: { type: 'text', file: { content: skillText('always') } },
  });
  const staleFile = join(skillsRoot, 'source-care/SKILL.md');
  writeFileSync(staleFile, `${skillText('source-care')}3. Added later.\n`);
  const stale = sign('source-care');
  writeFileSync(staleFile, skillText('source-care'));
  const ghost = sign('ghost');
  git(repository, ['checkout', '--quiet', '-B', 'side', work]);
  write('src/side.ts', 'export const side = 1;\n');
  commit('feat: a side change');
  const outside = sign('always');
  const head = recordOn('tampered', [
    {
      change: 'tampered',
      skills: [
        {
          skill: 'always',
          files: ['<change>'],
          findings: [{ ...looked(), cites: 'Nope' }],
          receipts: [edited, otherKey, partial, outside, receipt.source],
        },
        {
          skill: 'ghost',
          files: ['src/**'],
          reason: 'Felt right.',
          findings: [looked()],
          receipts: [ghost],
        },
        {
          skill: 'source-care',
          files: ['src/**'],
          findings: [{ ...looked(), cites: 'Steps 3' }],
          receipts: [stale],
        },
      ],
    },
  ]);
  const result = skills(['check', base]);
  expect(result.status).toBe(1);
  const path = 'tools/skills/records/tampered.json';
  expect(result.stderr).toBe(
    [
      `Skill records for ${range(head, 2)} fail:`,
      `${path}: always finding "Looked." cites "Nope", which is not a heading or numbered rule of always in tools/skills/catalog.lock.json.`,
      `${path}: ghost is not a catalogued skill in tools/skills/routing.json.`,
      `${path}: source-care finding "Looked." cites "Steps 3", which is not a heading or numbered rule of source-care in tools/skills/catalog.lock.json.`,
      `${path}: always receipt ${edited.toolUseId} has a signature that the committed public key does not verify.`,
      `${path}: always receipt ${otherKey.toolUseId} has a signature that the committed public key does not verify.`,
      `${path}: always receipt ${partial.toolUseId} records a partial read.`,
      `${path}: always receipt ${outside.toolUseId} was made on a commit outside this change.`,
      `${path}: always receipt ${receipt.source.toolUseId} is for source-care.`,
      noAuthorReceipt('tampered', 'always'),
      `${path}: ghost receipt ${ghost.toolUseId} names a skill outside the catalog.`,
      noAuthorReceipt('tampered', 'ghost'),
      `${path}: source-care receipt ${stale.toolUseId} hashes a SKILL.md that is not the one in tools/skills/catalog.lock.json.`,
      noAuthorReceipt('tampered', 'source-care'),
      '',
    ].join('\n'),
  );
}, 20000);

test('a review section needs receipts from a session and agent pair that wrote no author receipt', () => {
  const entry = (skill, files, author) => ({
    skill,
    files,
    findings: [looked()],
    receipts: [author],
  });
  const reviewed = (change, reviewer) => ({
    change,
    skills: [
      entry('always', ['<change>'], receipt.always),
      entry('source-care', ['src/**'], receipt.source),
    ],
    review: {
      skills: [
        { skill: 'always', findings: [looked()], receipts: [reviewer.always] },
        {
          skill: 'source-care',
          findings: [looked()],
          receipts: [reviewer.source],
        },
      ],
    },
  });
  const selfReviewed = recordOn('self-reviewed', [
    reviewed('self-reviewed', {
      always: receipt.always,
      source: receipt.reviewSource,
    }),
  ]);
  expect(skills(['check', base]).stderr).toBe(
    [
      `Skill records for ${range(selfReviewed, 2)} fail:`,
      noReviewerReceipt('self-reviewed', 'always'),
      '',
    ].join('\n'),
  );
  for (const [branch, reviewer] of [
    [
      'reviewed',
      { always: receipt.reviewAlways, source: receipt.reviewSource },
    ],
    [
      'subagent-reviewed',
      { always: receipt.subagentAlways, source: receipt.subagentSource },
    ],
  ]) {
    recordOn(branch, [reviewed(branch, reviewer)]);
    const result = skills(['check', base]);
    expect([branch, result.stderr, result.status]).toEqual([branch, '', 0]);
  }
});

test('a pull request run needs every record reviewed by a pair that made none of its author receipts', () => {
  const pullRequest = { GITHUB_EVENT_NAME: 'pull_request' };
  const authors = [
    authored('always', ['<change>'], receipt.upperAlways),
    authored('source-care', ['src/**'], receipt.upperSource),
  ];
  const unreviewed = upperOn('pr-unreviewed', authors);
  const local = skills(['check', base]);
  expect([local.stderr, local.status]).toEqual(['', 0]);
  const failed = skills(['check', base], pullRequest);
  expect(failed.status).toBe(1);
  expect(failed.stderr).toBe(
    [
      `Skill records for ${range(unreviewed, 4)} fail:`,
      noReview('upper'),
      '',
    ].join('\n'),
  );

  const half = upperOn('pr-half-reviewed', authors, {
    skills: [reviewed('always', receipt.upperReviewAlways)],
  });
  expect(skills(['check', base], pullRequest).stderr).toBe(
    [
      `Skill records for ${range(half, 4)} fail:`,
      `${upperPath}: source-care is required, but the review section has no entry for it. The reviewer loads it with the Skill tool, then runs npm run skills:record -- upper <base> --review.`,
      '',
    ].join('\n'),
  );

  // The lower record's review holds a valid reviewer receipt for every skill,
  // and that must not stand in for the upper record's own review.
  const selfReviewed = upperOn('pr-self-reviewed', authors, {
    skills: [
      reviewed('always', receipt.upperAlways),
      reviewed('source-care', receipt.upperReviewSource),
    ],
  });
  expect(skills(['check', base], pullRequest).stderr).toBe(
    [
      `Skill records for ${range(selfReviewed, 4)} fail:`,
      noReviewerReceipt('upper', 'always'),
      '',
    ].join('\n'),
  );

  const both = upperOn('pr-reviewed', authors, {
    skills: [
      reviewed('always', receipt.upperReviewAlways),
      reviewed('source-care', receipt.upperReviewSource),
    ],
  });
  const passed = skills(['check', base], pullRequest);
  expect(passed.stderr).toBe('');
  expect(passed.stdout).toBe(
    `Skill records for ${range(both, 4)} cover all 2 required skills with independent review (tools/skills/records/lower.json, tools/skills/records/upper.json).\n`,
  );
});

test('fails closed without a committed public key or lock, and still checks citations', () => {
  const record = change => ({
    change,
    skills: [
      {
        skill: 'always',
        files: ['<change>'],
        findings: [{ ...looked(), cites: 'Nope' }],
        receipts: [receipt.always],
      },
      {
        skill: 'source-care',
        files: ['src/**'],
        findings: [looked()],
        receipts: [receipt.source],
      },
    ],
  });
  const unkeyed = recordOn(
    'unkeyed',
    [record('unkeyed')],
    ['tools/skills/receipt-public-key.pem'],
  );
  const result = skills(['check', base]);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    [
      `Skill records for ${range(unkeyed, 2)} fail:`,
      'tools/skills/records/unkeyed.json: always finding "Looked." cites "Nope", which is not a heading or numbered rule of always in tools/skills/catalog.lock.json.',
      'No public key at tools/skills/receipt-public-key.pem. Run node tools/skills/install-receipt-hook.mjs --apply, then commit the public key it prints to that path.',
      '',
    ].join('\n'),
  );
  const unlocked = recordOn(
    'unlocked',
    [record('unlocked')],
    ['tools/skills/catalog.lock.json'],
  );
  const missing = skills(['check', base]);
  expect(missing.status).toBe(1);
  expect(missing.stderr).toBe(
    [
      `Skill records for ${range(unlocked, 2)} fail:`,
      'No tools/skills/catalog.lock.json. Run npm run skills:catalog -- --lock and commit it.',
      '',
    ].join('\n'),
  );
});

test('rejects a finding without exactly one status and a record named for another change', () => {
  recordOn('unresolved', [
    {
      change: 'unresolved',
      skills: [
        {
          skill: 'always',
          files: ['<change>'],
          findings: [
            { finding: 'Open.', cites: 'Steps' },
            {
              finding: 'Both.',
              cites: 'Steps',
              commit: work.slice(0, 12),
              none: 'Also.',
            },
          ],
          receipts: [],
        },
      ],
    },
  ]);
  const misnamed = {
    change: 'other',
    base: { commit: base },
    skills: [
      {
        skill: 'always',
        files: ['<change>'],
        findings: [looked()],
        receipts: [],
      },
    ],
  };
  write('tools/skills/records/renamed.json', JSON.stringify(misnamed));
  const head = commit('chore: add a misnamed record');
  const result = skills(['check', base]);
  expect(result.status).toBe(1);
  const resolution =
    'needs exactly one status: "commit" with the fixing commit, "none" with the reason none was needed, or "open" with what is left to do';
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

test('an open finding keeps its record whole and fails only a pull request run', () => {
  const open = { finding: 'Not fixed.', cites: 'Steps', open: 'Needs a fix.' };
  const head = recordOn('open-finding', [
    {
      change: 'open-finding',
      skills: [
        {
          skill: 'always',
          files: ['<change>'],
          findings: [open],
          receipts: [receipt.always],
        },
        {
          skill: 'source-care',
          files: ['src/**'],
          findings: [looked()],
          receipts: [receipt.source],
        },
      ],
      review: {
        skills: [
          {
            skill: 'always',
            findings: [looked()],
            receipts: [receipt.reviewAlways],
          },
          {
            skill: 'source-care',
            findings: [looked()],
            receipts: [receipt.reviewSource],
          },
        ],
      },
    },
  ]);
  const local = skills(['check', base]);
  expect([local.stderr, local.status]).toEqual(['', 0]);
  const pullRequest = skills(['check', base], {
    GITHUB_EVENT_NAME: 'pull_request',
  });
  expect(pullRequest.status).toBe(1);
  expect(pullRequest.stderr).toBe(
    [
      `Skill records for ${range(head, 2)} fail:`,
      'tools/skills/records/open-finding.json: always finding "Not fixed." is open: Needs a fix. A pull request needs every finding fixed or closed with "none".',
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

test('scaffolds a record, pulls author and reviewer receipts from this clone, and changes nothing when run again', () => {
  git(repository, ['checkout', '--quiet', '-B', 'scaffold', work]);
  git(repository, ['clean', '--force', '-d', '--quiet']);
  const clone = join(scratch, 'clone');
  git(scratch, ['clone', '--quiet', '--branch', 'scaffold', repository, clone]);
  const elsewhere = sign('always', { cwd: clone, state: 'pull' });
  const partial = sign(null, {
    state: 'pull',
    tool_name: 'Read',
    tool_input: { file_path: join(skillsRoot, 'always/SKILL.md'), offset: 2 },
    tool_response: { type: 'text', file: { content: skillText('always') } },
  });
  const author = {
    always: sign('always', { state: 'pull' }),
    source: sign('source-care', { state: 'pull' }),
  };
  const reviewer = {
    always: sign('always', { state: 'pull', session_id: 'session-review' }),
    source: sign('source-care', {
      state: 'pull',
      session_id: 'session-review',
      agent_id: 'agent-2',
    }),
  };
  expect(elsewhere.head).toBe(work);
  expect(partial.partial).toBe(true);
  const pull = { SKILL_RECEIPTS_DIR: join(scratch, 'pull') };

  const first = skills(['record', 'scaffold', base], pull);
  expect(first.stderr).toBe('');
  expect(first.stdout).toBe(
    "Wrote tools/skills/records/scaffold.json. Add each skill's findings, the heading or rule each cites, and their resolutions.\n",
  );
  const path = join(repository, 'tools/skills/records/scaffold.json');
  const scaffold = JSON.parse(readFileSync(path, 'utf8'));
  expect(scaffold).toEqual({
    change: 'scaffold',
    base: { commit: base, patch: patchOf(base) },
    skills: [
      {
        skill: 'always',
        files: ['<change>'],
        findings: [],
        receipts: [author.always],
      },
      {
        skill: 'source-care',
        files: ['src/a.ts'],
        findings: [],
        receipts: [author.source],
      },
    ],
  });

  const review = skills(['record', 'scaffold', base, '--review'], pull);
  expect(review.stderr).toBe('');
  const reviewed = JSON.parse(readFileSync(path, 'utf8'));
  expect(reviewed.skills).toEqual(scaffold.skills);
  expect(reviewed.review).toEqual({
    skills: [
      { skill: 'always', findings: [], receipts: [reviewer.always] },
      { skill: 'source-care', findings: [], receipts: [reviewer.source] },
    ],
  });
  for (const entry of [...reviewed.skills, ...reviewed.review.skills])
    entry.findings.push(looked('Kept.'));
  writeFileSync(path, JSON.stringify(reviewed));
  expect(skills(['record', 'scaffold', base], pull).status).toBe(0);
  const again = readFileSync(path, 'utf8');
  expect(JSON.parse(again)).toEqual(reviewed);
  expect(skills(['record', 'scaffold', base, '--review'], pull).status).toBe(0);
  expect(readFileSync(path, 'utf8')).toBe(again);

  const head = commit('chore: record the scaffold');
  const result = skills(['check', base]);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    `Skill records for ${range(head, 2)} cover all 2 required skills (tools/skills/records/scaffold.json).\n`,
  );
}, 30000);

test('names the skills that still have no receipt', () => {
  git(repository, ['checkout', '--quiet', '-B', 'unreceipted', work]);
  git(repository, ['clean', '--force', '-d', '--quiet']);
  const result = skills(['record', 'unreceipted', base]);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    [
      "Wrote tools/skills/records/unreceipted.json. Add each skill's findings, the heading or rule each cites, and their resolutions.",
      `${join(scratch, 'no-receipts/receipts.jsonl')} has no receipt from this change for always, source-care. Load each with the Skill tool, then run this again.`,
      '',
    ].join('\n'),
  );
});

test('a review run changes only the review section, and needs the record and its base', () => {
  git(repository, ['checkout', '--quiet', '-B', 'review-only', work]);
  git(repository, ['clean', '--force', '-d', '--quiet']);
  const path = join(repository, 'tools/skills/records/review-only.json');
  writeRecords([
    {
      change: 'review-only',
      skills: [
        {
          skill: 'always',
          files: ['README.md'],
          findings: [
            { finding: 'Named a fix.', cites: 'Steps 1', commit: work },
          ],
          receipts: [],
        },
      ],
    },
  ]);
  const before = readFileSync(path, 'utf8');
  const review = skills(['record', 'review-only', base, '--review']);
  expect(review.stderr).toBe('');
  expect(review.status).toBe(0);
  const { review: section, ...author } = JSON.parse(readFileSync(path, 'utf8'));
  expect(author).toEqual(JSON.parse(before));
  expect(section).toEqual({
    skills: ['always', 'source-care'].map(skill => ({
      skill,
      findings: [],
      receipts: [],
    })),
  });

  const reviewed = readFileSync(path, 'utf8');
  const moved = skills(['record', 'review-only', work, '--review']);
  expect(moved.stderr).toBe(
    `tools/skills/records/review-only.json has base ${base.slice(0, 12)}, but this run's base is ${work.slice(0, 12)}. Run the review with the record's base.\n`,
  );
  expect(moved.status).toBe(1);
  expect(readFileSync(path, 'utf8')).toBe(reviewed);

  const absent = skills(['record', 'unwritten', base, '--review']);
  expect(absent.stderr).toBe(
    'tools/skills/records/unwritten.json does not exist. The author runs npm run skills:record -- unwritten <base> first.\n',
  );
  expect(absent.status).toBe(1);
  expect(
    existsSync(join(repository, 'tools/skills/records/unwritten.json')),
  ).toBe(false);
});

test('accepts a citation and a receipt whose commit was cherry-picked onto a new base, and the scaffold cites the copy', () => {
  const head = recordOn('original', [
    {
      change: 'original',
      skills: [
        {
          skill: 'always',
          files: ['<change>'],
          findings: [
            {
              finding: 'Named a fix.',
              cites: 'Steps 1',
              commit: work.slice(0, 12),
            },
          ],
          receipts: [receipt.always],
        },
        {
          skill: 'source-care',
          files: ['src/**'],
          findings: [looked('Checked a.ts.')],
          receipts: [receipt.source],
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
  const repicked = JSON.parse(readFileSync(path, 'utf8'));
  expect(repicked.skills[0].findings[0]).toEqual(cite('Named a fix.', copy));
  expect(repicked.skills[0].receipts).toEqual([receipt.always]);
});

test('rejects a receipt made on the old base after the change moves to a new base', () => {
  git(repository, ['checkout', '--quiet', '--force', '-B', 'rebased', base]);
  git(repository, ['clean', '--force', '-d', '--quiet']);
  write('README.md', '# Fixture moved again\n');
  const moved = commit('docs: move the base again');
  write('src/a.ts', 'export const a = 1;\n');
  commit('feat: add a again');
  write(
    'tools/skills/records/rebased.json',
    JSON.stringify({
      change: 'rebased',
      base: { commit: moved },
      skills: [
        {
          skill: 'always',
          files: ['<change>'],
          findings: [looked()],
          receipts: [receipt.atBase],
        },
        {
          skill: 'source-care',
          files: ['src/**'],
          findings: [looked()],
          receipts: [receipt.source],
        },
      ],
    }),
  );
  const head = commit('chore: record rebased');
  const result = skills(['check', moved]);
  expect(result.stderr).toBe(
    [
      `Skill records for ${moved.slice(0, 12)}..${head.slice(0, 12)} (2 commits) fail:`,
      `tools/skills/records/rebased.json: always receipt ${receipt.atBase.toolUseId} was made on a commit outside this change.`,
      noAuthorReceipt('rebased', 'always'),
      '',
    ].join('\n'),
  );
});
