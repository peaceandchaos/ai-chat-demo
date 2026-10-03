const {
  existsSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { git } = require('../verification/snapshot.cjs');
const {
  skillText,
  write,
  commit,
  writeRecords,
  recordOn,
  skills,
  sign,
  signInReview,
  range,
  patchOf,
  cite,
  looked,
  authored,
  reviewed,
  noAuthorReceipt,
  setUpRecordFixture,
  removeRecordFixture,
} = require('./record-fixture.cjs');

let scratch;
let repository;
let reviewFolder;
let skillsRoot;
let base;
let work;
let receipt;

beforeAll(() => {
  ({ scratch, repository, reviewFolder, skillsRoot, base, work, receipt } =
    setUpRecordFixture());
}, 30000);

const reviewReceipts = (folder, change) =>
  JSON.parse(
    readFileSync(join(folder, `tools/skills/records/${change}.json`), 'utf8'),
  ).review.skills.map(entry => entry.receipts);
// Commits a record of the work commit with the fixture's author receipts.
const recordWork = change =>
  recordOn(change, [
    {
      change,
      skills: [
        authored('always', ['<change>'], receipt.always),
        authored('source-care', ['src/**'], receipt.source),
      ],
    },
  ]);

afterAll(removeRecordFixture);

test('scaffolds a record, pulls author receipts from this clone and review receipts from the folder the review runs in, and changes nothing when run again', () => {
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
  const asReviewer = {
    state: 'pull',
    session_id: 'session-review',
    agent_id: 'agent-2',
  };
  // The reviewer's earliest loads are in the author's folder.
  sign('always', asReviewer);
  sign('source-care', asReviewer);
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

  for (const entry of scaffold.skills) entry.findings.push(looked('Kept.'));
  writeFileSync(path, JSON.stringify(scaffold));
  const recorded = commit('chore: record the scaffold');

  const reviewer = {
    always: signInReview(recorded, 'always', asReviewer),
    source: signInReview(recorded, 'source-care', asReviewer),
  };
  const run = skills(
    ['record', 'scaffold', base, '--review'],
    pull,
    reviewFolder,
  );
  expect(run.stderr).toBe('');
  const reviewedPath = join(reviewFolder, 'tools/skills/records/scaffold.json');
  const reviewed = JSON.parse(readFileSync(reviewedPath, 'utf8'));
  expect(reviewed.skills).toEqual(scaffold.skills);
  expect(reviewed.review).toEqual({
    skills: [
      { skill: 'always', findings: [], receipts: [reviewer.always] },
      { skill: 'source-care', findings: [], receipts: [reviewer.source] },
    ],
  });
  for (const entry of reviewed.review.skills)
    entry.findings.push(looked('Kept.'));
  writeFileSync(reviewedPath, JSON.stringify(reviewed));
  expect(skills(['record', 'scaffold', base], pull, reviewFolder).status).toBe(
    0,
  );
  const again = readFileSync(reviewedPath, 'utf8');
  expect(JSON.parse(again)).toEqual(reviewed);
  expect(
    skills(['record', 'scaffold', base, '--review'], pull, reviewFolder).status,
  ).toBe(0);
  expect(readFileSync(reviewedPath, 'utf8')).toBe(again);

  git(reviewFolder, [
    'commit',
    '--quiet',
    '--all',
    '-m',
    'chore: review scaffold',
  ]);
  const head = git(reviewFolder, ['rev-parse', 'HEAD']);
  const result = skills(['check', base], {}, reviewFolder);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    `Skill records for ${range(head, 3)} cover all 2 required skills (tools/skills/records/scaffold.json).\n`,
  );
}, 30000);

test('a review run in another folder replaces the review receipts, and a review run in the author folder fails the check', () => {
  const recorded = recordWork('moved');
  const state = { SKILL_RECEIPTS_DIR: join(scratch, 'moved') };
  const asReviewer = { state: 'moved', session_id: 'session-review' };
  const inReview = [
    signInReview(recorded, 'always', asReviewer),
    signInReview(recorded, 'source-care', asReviewer),
  ];
  const first = skills(
    ['record', 'moved', base, '--review'],
    state,
    reviewFolder,
  );
  expect(first.stderr).toBe('');
  expect(reviewReceipts(reviewFolder, 'moved')).toEqual(
    inReview.map(made => [made]),
  );
  git(reviewFolder, [
    'commit',
    '--quiet',
    '--all',
    '-m',
    'chore: review moved',
  ]);
  const reviewedCommit = git(reviewFolder, ['rev-parse', 'HEAD']);

  git(repository, ['checkout', '--quiet', '--detach', reviewedCommit]);
  const inAuthor = [
    sign('always', asReviewer),
    sign('source-care', asReviewer),
  ];
  const second = skills(['record', 'moved', base, '--review'], state);
  expect(second.stderr).toBe('');
  expect(reviewReceipts(repository, 'moved')).toEqual(
    inAuthor.map(made => [made]),
  );

  const path = 'tools/skills/records/moved.json';
  const moved = JSON.parse(readFileSync(join(repository, path), 'utf8'));
  for (const entry of moved.review.skills) entry.findings.push(looked());
  writeFileSync(join(repository, path), JSON.stringify(moved));
  const head = commit('chore: review moved in the author folder');
  const result = skills(['check', base]);
  const rejected = (skill, made) => [
    `${path}: review of ${skill} receipt ${made.toolUseId} was made in the folder of one of this record's author receipts.`,
    `${path}: review of ${skill} has no valid receipt from a session and agent pair that made none of this record's author receipts. The reviewer loads it with the Skill tool, then runs npm run skills:record -- moved <base> --review.`,
  ];
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    [
      `Skill records for ${range(head, 4)} fail:`,
      ...rejected('always', inAuthor[0]),
      ...rejected('source-care', inAuthor[1]),
      '',
    ].join('\n'),
  );
}, 30000);

// Claude Code keeps its working folder as a resolved path, so the hook signs
// the physical folder even when the agent's shell entered it through a link.
test('a review run through a symlink, from a subfolder, pulls receipts signed with the resolved worktree path', () => {
  const recorded = recordWork('linked');
  const asReviewer = { state: 'linked', session_id: 'session-review' };
  // An earlier load in the author's folder, which the review must skip.
  sign('always', asReviewer);
  const loaded = [
    signInReview(recorded, 'always', asReviewer),
    signInReview(recorded, 'source-care', asReviewer),
  ];
  const link = join(scratch, 'review-link');
  symlinkSync(reviewFolder, link);
  const inside = join(link, 'src');
  const result = skills(
    ['record', 'linked', base, '--review'],
    { SKILL_RECEIPTS_DIR: join(scratch, 'linked'), PWD: inside },
    inside,
  );
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    "Wrote tools/skills/records/linked.json. Add each skill's findings, the heading or rule each cites, and their resolutions.\n",
  );
  expect(reviewReceipts(reviewFolder, 'linked')).toEqual(
    loaded.map(made => [made]),
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
