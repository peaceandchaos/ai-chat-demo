// A PostToolUse hook that signs one receipt for each skill an agent loads.
// install-receipt-hook.mjs copies it to ~/.claude/hooks/skill-receipt-hook.mjs.
// It imports only Node builtins so that it runs outside the repository.
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const state =
  process.env.SKILL_RECEIPTS_DIR ?? join(homedir(), '.claude/skill-receipts');
const keyPath =
  process.env.SKILL_RECEIPTS_KEY ?? join(state, 'private-key.pem');
const rootsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'skill-receipt-roots.json',
);

const sha256 = text => createHash('sha256').update(text).digest('hex');

function git(cwd, args, input) {
  try {
    return execFileSync('git', args, {
      cwd,
      input,
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// The same diff that tools/skills/records.cjs feeds to git patch-id.
function headPatch(cwd) {
  const patch = git(cwd, [
    'log',
    '--patch',
    '--no-color',
    '--no-ext-diff',
    '--find-renames',
    '--format=commit %H',
    '-1',
    'HEAD',
  ]);
  if (!patch) return null;
  return (
    git(cwd, ['patch-id', '--stable'], `${patch}\n`)?.split(' ')[0] || null
  );
}

const noRepository = {
  top: null,
  commonDir: null,
  branch: null,
  head: null,
  headPatch: null,
};

function repository(cwd) {
  const lines = cwd
    ? git(cwd, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
        '--show-toplevel',
        'HEAD',
        '--symbolic-full-name',
        'HEAD',
      ])?.split('\n')
    : null;
  if (!lines) return noRepository;
  const [commonDir, top, head, ref] = lines;
  const commit = /^[0-9a-f]{40}$/u.test(head ?? '') ? head : null;
  return {
    top,
    commonDir: sha256(commonDir),
    branch: ref?.startsWith('refs/heads/') ? ref.slice(11) : null,
    head: commit,
    headPatch: commit ? headPatch(cwd) : null,
  };
}

function parsed(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Claude Code sends tool_response; Cursor sends tool_output and its own ids.
function readEvent(payload) {
  const cursor = payload.cursor_version !== undefined;
  return {
    client: cursor ? 'cursor' : 'claude-code',
    tool: payload.tool_name,
    input: parsed(payload.tool_input) ?? {},
    response: parsed(cursor ? payload.tool_output : payload.tool_response),
    session: payload.session_id ?? payload.conversation_id ?? null,
    agent: payload.agent_id ?? null,
    agentType: payload.agent_type ?? null,
    toolUseId: payload.tool_use_id ?? payload.generation_id ?? null,
    cwd: payload.cwd ?? payload.workspace_roots?.[0] ?? null,
  };
}

function skillFile(roots, reference, top) {
  const [plugin, name] = reference.includes(':')
    ? reference.split(':', 2)
    : [null, reference];
  const directories = plugin
    ? [roots.plugins[plugin]]
    : [
        roots.user,
        ...(top ? roots.repo.map(path => join(top, path)) : []),
        ...Object.values(roots.plugins),
      ];
  for (const directory of directories.filter(Boolean)) {
    const file = join(directory, name, 'SKILL.md');
    if (existsSync(file)) return { name, file, partial: false };
  }
  throw new Error(`No SKILL.md for ${reference}.`);
}

function readFull(event) {
  const file = event.input.file_path;
  const content =
    typeof event.response === 'string'
      ? event.response
      : event.response?.file?.content;
  return {
    name: basename(dirname(file)),
    file,
    partial:
      event.input.offset !== undefined ||
      event.input.limit !== undefined ||
      content !== readFileSync(file, 'utf8'),
  };
}

function canonical(fields) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  );
}

function receiptFor(payload) {
  const event = readEvent(payload);
  const loading =
    event.tool === 'Skill' && typeof event.input.skill === 'string';
  const reading =
    event.tool === 'Read' &&
    typeof event.input.file_path === 'string' &&
    basename(event.input.file_path) === 'SKILL.md';
  if (!loading && !reading) return null;
  const repo = repository(event.cwd);
  const skill = loading
    ? skillFile(
        JSON.parse(readFileSync(rootsPath, 'utf8')),
        event.input.skill,
        repo.top,
      )
    : readFull(event);
  const fields = {
    v: 1,
    client: event.client,
    skill: skill.name,
    source: event.tool,
    sha256: sha256(readFileSync(skill.file, 'utf8')),
    partial: skill.partial,
    session: event.session,
    agent: event.agent,
    agentType: event.agentType,
    toolUseId: event.toolUseId,
    time: new Date().toISOString(),
    cwd: event.cwd ? sha256(event.cwd) : null,
    commonDir: repo.commonDir,
    branch: repo.branch,
    head: repo.head,
    headPatch: repo.headPatch,
  };
  const key = createPrivateKey(readFileSync(keyPath, 'utf8'));
  const sig = sign(null, Buffer.from(canonical(fields)), key).toString(
    'base64',
  );
  return { ...fields, sig };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const receipt = receiptFor(JSON.parse(input));
  if (!receipt) return;
  mkdirSync(state, { recursive: true });
  appendFileSync(join(state, 'receipts.jsonl'), `${JSON.stringify(receipt)}\n`);
}

try {
  await main();
} catch (error) {
  try {
    mkdirSync(state, { recursive: true });
    appendFileSync(
      join(state, 'errors.log'),
      `${new Date().toISOString()} ${error?.stack ?? error}\n`,
    );
  } catch {
    // Nowhere left to report; the tool call must still succeed.
  }
}
process.exitCode = 0;
