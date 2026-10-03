const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { git } = require('../verification/snapshot.cjs');
const { parseRouting } = require('../skills/routing.cjs');

const cli = resolve(__dirname, '../skills/cli.cjs');

const fixtureRouting = {
  roots: {
    main: { env: 'SKILL_ROOT_MAIN' },
    local: { env: 'SKILL_ROOT_LOCAL', default: 'skills' },
  },
  skills: {
    'api-care': 'main',
    'big-review': 'main',
    'doc-style': 'local',
    'every-time': 'main',
    'feature-review': 'main',
    'export-care': 'main',
    'fix-care': 'main',
    'move-care': 'main',
    'network-care': 'main',
    'new-file-care': 'main',
  },
  rules: [
    {
      id: 'every-change',
      scope: 'change',
      why: 'Always.',
      skills: ['every-time'],
    },
    {
      id: 'large-change',
      scope: 'change',
      why: 'Big.',
      minChangedLines: 4,
      excludePaths: ['generated/**'],
      skills: ['big-review'],
    },
    {
      id: 'fix-commits',
      scope: 'change',
      why: 'Fixes.',
      commitSubject: '^fix:',
      skills: ['fix-care'],
    },
    {
      id: 'big-feature',
      scope: 'change',
      why: 'Big features.',
      minChangedLines: 1,
      commitSubject: '^feat:',
      skills: ['feature-review'],
    },
    {
      id: 'source',
      scope: 'file',
      why: 'Source.',
      paths: ['src/**'],
      skills: ['api-care'],
    },
    {
      id: 'docs',
      scope: 'file',
      why: 'Docs.',
      paths: ['**/*.md'],
      skills: ['doc-style'],
    },
    {
      id: 'removed-exports',
      scope: 'file',
      why: 'Exports.',
      removedExports: true,
      skills: ['api-care', 'export-care'],
    },
    {
      id: 'moves',
      scope: 'file',
      why: 'Moves.',
      status: ['deleted', 'renamed'],
      skills: ['move-care'],
    },
    {
      id: 'added',
      scope: 'file',
      why: 'New.',
      status: ['added'],
      excludePaths: ['generated/**'],
      skills: ['new-file-care'],
    },
    {
      id: 'network',
      scope: 'file',
      why: 'Network.',
      addedLines: '\\bfetch\\(',
      skills: ['network-care'],
    },
  ],
};

const fixtureLedger = {
  lessons: [
    {
      id: 'client-retry',
      lesson: 'Retry a failed load once.',
      seen: ['an earlier fix'],
      enforcement: { kind: 'guidance' },
      paths: ['src/client.ts'],
    },
    {
      id: 'head-watch',
      lesson: 'Watch the pushed head.',
      seen: ['one run', 'another run'],
      enforcement: { kind: 'guidance' },
      link: 'https://example.invalid/decision',
    },
    {
      id: 'lib-care',
      lesson: 'Library code needs care.',
      seen: ['a library change'],
      enforcement: { kind: 'guidance' },
      paths: ['lib/**'],
    },
    {
      id: 'typed',
      lesson: 'A type enforces this.',
      seen: ['a type fix'],
      enforcement: { kind: 'check', check: 'types' },
      paths: ['src/**'],
    },
  ],
};

function write(directory, path, text) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), text);
}

function commit(directory, message) {
  git(directory, ['add', '--all']);
  git(directory, ['commit', '--quiet', '-m', message]);
  return git(directory, ['rev-parse', 'HEAD']);
}

let fixture;
let base;
let head;
let env;

beforeAll(() => {
  fixture = realpathSync(mkdtempSync(join(tmpdir(), 'skills-fixture-')));
  const repository = join(fixture, 'repository');
  const roots = join(fixture, 'roots');
  mkdirSync(repository);
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'core.hooksPath', '/dev/null']);
  git(repository, ['config', 'user.name', 'Skills fixture']);
  git(repository, ['config', 'user.email', 'fixture@example.invalid']);
  for (const [skill, root] of Object.entries(fixtureRouting.skills)) {
    const directory = root === 'main' ? roots : join(repository, 'skills');
    write(directory, `${skill}/SKILL.md`, `---\nname: ${skill}\n---\n`);
  }
  write(
    repository,
    'tools/skills/routing.json',
    JSON.stringify(fixtureRouting),
  );
  write(repository, 'tools/skills/ledger.json', JSON.stringify(fixtureLedger));
  write(
    repository,
    'src/api.ts',
    'export function keep() {}\nexport const dropped = 1;\nexport type Gone = string;\n',
  );
  write(repository, 'src/legacy.cjs', 'module.exports = { old: 1 };\n');
  write(repository, 'docs/guide.md', '# Guide\n\nRead this.\n');
  base = commit(repository, 'Base');
  write(repository, 'src/api.ts', 'export function keep() {}\n');
  unlinkSync(join(repository, 'src/legacy.cjs'));
  renameSync(
    join(repository, 'docs/guide.md'),
    join(repository, 'docs/manual.md'),
  );
  write(repository, 'generated/data.txt', 'a\nb\nc\nd\ne\nf\ng\n');
  commit(repository, 'refactor: trim the API');
  write(repository, 'src/client.ts', "export const load = () => fetch('/');\n");
  head = commit(repository, 'fix: load the page');
  env = { ...process.env, SKILL_ROOT_MAIN: roots };
  delete env.SKILL_ROOT_LOCAL;
});

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function skills(args, environment = env) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: join(fixture, 'repository'),
    encoding: 'utf8',
    env: environment,
  });
}

const read = (root, skill) =>
  `  read ${join(fixture, root, skill, 'SKILL.md')}`;

test('prints each required skill once with the rules and files that require it', () => {
  const result = skills(['required', base]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    [
      `Required skills for ${base.slice(0, 12)}..${head.slice(0, 12)} (merge base to head): 5 files.`,
      '',
      'api-care',
      read('roots', 'api-care'),
      '  removed-exports: Exports.',
      '    src/api.ts (Gone, dropped)',
      '    src/legacy.cjs (old)',
      '  source: Source.',
      '    src/api.ts',
      '    src/client.ts',
      '    src/legacy.cjs',
      '',
      'big-review',
      read('roots', 'big-review'),
      '  large-change: Big.',
      '    <change> (4 changed lines)',
      '',
      'doc-style',
      read('repository/skills', 'doc-style'),
      '  docs: Docs.',
      '    docs/manual.md',
      '',
      'every-time',
      read('roots', 'every-time'),
      '  every-change: Always.',
      '    <change>',
      '',
      'export-care',
      read('roots', 'export-care'),
      '  removed-exports: Exports.',
      '    src/api.ts (Gone, dropped)',
      '    src/legacy.cjs (old)',
      '',
      'fix-care',
      read('roots', 'fix-care'),
      '  fix-commits: Fixes.',
      '    <change> (fix: load the page)',
      '',
      'move-care',
      read('roots', 'move-care'),
      '  moves: Moves.',
      '    docs/manual.md',
      '    src/legacy.cjs',
      '',
      'network-care',
      read('roots', 'network-care'),
      '  network: Network.',
      '    src/client.ts',
      '',
      'new-file-care',
      read('roots', 'new-file-care'),
      '  added: New.',
      '    src/client.ts',
      '',
      'Lessons from tools/skills/ledger.json:',
      '  client-retry (seen once): Retry a failed load once.',
      '    src/client.ts',
      '  head-watch (seen 2 times): Watch the pushed head.',
      '    <change>',
      '',
      'Enforced, so not listed: typed.',
      '',
    ].join('\n'),
  );
  expect(skills(['required', base, head]).stdout).toBe(result.stdout);
});

test('evaluates a planned file list by path and status only', () => {
  const result = skills([
    'required',
    '--plan',
    'src/api.ts',
    'A:notes/todo.md',
    'R:docs/a.md:docs/b.md',
    'R:src/old.ts:lib/old.ts',
  ]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    [
      'Required skills for a planned change of 4 files.',
      'A plan has no content, so these rules were not evaluated: big-feature, fix-commits, large-change, network, removed-exports.',
      '',
      'api-care',
      read('roots', 'api-care'),
      '  source: Source.',
      '    lib/old.ts',
      '    src/api.ts',
      '',
      'doc-style',
      read('repository/skills', 'doc-style'),
      '  docs: Docs.',
      '    docs/b.md',
      '    notes/todo.md',
      '',
      'every-time',
      read('roots', 'every-time'),
      '  every-change: Always.',
      '    <change>',
      '',
      'move-care',
      read('roots', 'move-care'),
      '  moves: Moves.',
      '    docs/b.md',
      '    lib/old.ts',
      '',
      'new-file-care',
      read('roots', 'new-file-care'),
      '  added: New.',
      '    notes/todo.md',
      '',
      'Lessons from tools/skills/ledger.json:',
      '  head-watch (seen 2 times): Watch the pushed head.',
      '    <change>',
      '  lib-care (seen once): Library code needs care.',
      '    lib/old.ts',
      '',
      'Enforced, so not listed: typed.',
      '',
    ].join('\n'),
  );
});

test('fails clearly when a skill root is missing or a skill file is wrong', () => {
  const unset = { ...env };
  delete unset.SKILL_ROOT_MAIN;
  const missing = skills(['required', base], unset);
  expect(missing.status).toBe(1);
  expect(missing.stdout).toBe('');
  expect(missing.stderr).toBe(
    'Skill root main is not configured. Set SKILL_ROOT_MAIN to the directory that holds <skill>/SKILL.md.\n',
  );
  const absent = join(fixture, 'absent');
  expect(skills(['catalog'], { ...env, SKILL_ROOT_MAIN: absent }).stderr).toBe(
    `Skill root main does not exist at ${absent}. Set SKILL_ROOT_MAIN to the directory that holds <skill>/SKILL.md.\n`,
  );
  const file = join(fixture, 'roots/fix-care/SKILL.md');
  writeFileSync(file, '---\nname: other\n---\n');
  try {
    const renamed = skills(['catalog']);
    expect(renamed.status).toBe(1);
    expect(renamed.stderr).toBe(`${file} does not declare name: fix-care.\n`);
    writeFileSync(file, '---\ndescription: x\n---\nname: fix-care\n');
    const bodyName = skills(['catalog']);
    expect(bodyName.stderr).toBe(`${file} does not declare name: fix-care.\n`);
    expect(bodyName.status).toBe(1);
  } finally {
    writeFileSync(file, '---\nname: fix-care\n---\n');
  }
});

test('locks each skill hash with its headings and numbered rules outside code fences', () => {
  const file = join(fixture, 'roots/fix-care/SKILL.md');
  const text = [
    '---',
    'name: fix-care',
    '---',
    '# Fix care',
    '1. Read first.',
    '## Steps',
    '1. Reproduce.',
    '2. Fix.',
    '```sh',
    '# not a heading',
    '3. not a rule',
    '```',
    '## Limits',
    '',
  ].join('\n');
  const lock = join(fixture, 'repository/tools/skills/catalog.lock.json');
  writeFileSync(file, text);
  try {
    const result = skills(['catalog', '--lock']);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      'Wrote tools/skills/catalog.lock.json. Review a change to it like a check change.\n',
    );
    const locked = JSON.parse(readFileSync(lock, 'utf8')).skills;
    expect(Object.keys(locked)).toEqual(
      Object.keys(fixtureRouting.skills).sort(),
    );
    expect(locked['fix-care']).toEqual({
      sha256: createHash('sha256').update(text).digest('hex'),
      headings: ['Fix care', 'Steps', 'Limits'],
      rules: ['Fix care 1', 'Steps 1', 'Steps 2'],
    });
  } finally {
    writeFileSync(file, '---\nname: fix-care\n---\n');
    rmSync(lock, { force: true });
  }
});

test('the committed lock lists every catalogued skill', () => {
  const routing = parseRouting(
    readFileSync(resolve(__dirname, '../skills/routing.json'), 'utf8'),
  );
  const lock = JSON.parse(
    readFileSync(resolve(__dirname, '../skills/catalog.lock.json'), 'utf8'),
  );
  expect(Object.keys(lock.skills)).toEqual(Object.keys(routing.skills).sort());
});

test('rejects routing that names a skill outside the catalog', () => {
  const broken = {
    ...fixtureRouting,
    rules: [{ ...fixtureRouting.rules[0], skills: ['every-time', 'ghost'] }],
  };
  expect(() => parseRouting(JSON.stringify(broken))).toThrow(
    'Rule every-change names unknown skill ghost.',
  );
});

test('the committed routing names only catalogued skills and roots', () => {
  const text = readFileSync(
    resolve(__dirname, '../skills/routing.json'),
    'utf8',
  );
  expect(parseRouting(text).rules.length).toBeGreaterThan(0);
});

test.each([
  ['whose path has a space', 'spaced', 'src/my client.ts', ''],
  ['whose path git quotes', 'quoted', 'src/my "client".ts', ''],
  [
    'whose quoted path has escapes',
    'escaped',
    'src/back\\slash\tand \u001f é.ts',
    '',
  ],
  [
    'after an added line that looks like a diff header',
    'header-lookalike',
    'src/client.ts',
    '++ b/elsewhere.ts\n',
  ],
])('matches added lines in a file %s', (_, name, path, before) => {
  const repository = join(fixture, name);
  mkdirSync(repository);
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'core.hooksPath', '/dev/null']);
  git(repository, ['config', 'user.name', 'Skills fixture']);
  git(repository, ['config', 'user.email', 'fixture@example.invalid']);
  const network = fixtureRouting.rules.find(rule => rule.id === 'network');
  write(
    repository,
    'tools/skills/routing.json',
    JSON.stringify({ ...fixtureRouting, rules: [network] }),
  );
  write(
    repository,
    'tools/skills/ledger.json',
    JSON.stringify({ lessons: [] }),
  );
  const start = commit(repository, 'Base');
  write(repository, path, `${before}export const load = () => fetch('/');\n`);
  commit(repository, 'feat: load the page');
  const result = spawnSync(process.execPath, [cli, 'required', start], {
    cwd: repository,
    encoding: 'utf8',
    env,
  });
  expect(result.stderr).toBe('');
  expect(result.stdout.split('\n').slice(2)).toEqual([
    'network-care',
    read('roots', 'network-care'),
    '  network: Network.',
    `    ${path}`,
    '',
  ]);
});
