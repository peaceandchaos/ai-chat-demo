const { createPublicKey, verify } = require('node:crypto');
const { z } = require('zod');

const publicKeyPath = 'tools/skills/receipt-public-key.pem';
const hex = length =>
  z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`, 'u'));
const receiptSchema = z.strictObject({
  v: z.literal(1),
  client: z.enum(['claude-code', 'cursor']),
  skill: z.string().min(1),
  source: z.enum(['Skill', 'Read']),
  sha256: hex(64),
  partial: z.boolean(),
  session: z.string().min(1).nullable(),
  agent: z.string().min(1).nullable(),
  agentType: z.string().min(1).nullable(),
  toolUseId: z.string().min(1).nullable(),
  time: z.iso.datetime(),
  cwd: hex(64).nullable(),
  commonDir: hex(64).nullable(),
  branch: z.string().min(1).nullable(),
  head: hex(40).nullable(),
  headPatch: hex(40).nullable(),
  sig: z.string().min(1),
});

function canonical(fields) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  );
}

function readPublicKey(read) {
  const text = read(publicKeyPath);
  return text === null ? null : createPublicKey(text);
}

function missingKey() {
  return `No public key at ${publicKeyPath}. Run node tools/skills/install-receipt-hook.mjs --apply, then commit the public key it prints to that path.`;
}

function signed(receipt, key) {
  const { sig, ...fields } = receipt;
  try {
    return verify(
      null,
      Buffer.from(canonical(fields)),
      key,
      Buffer.from(sig, 'base64'),
    );
  } catch {
    return false;
  }
}

// A receipt belongs to a change when the agent loaded the skill on the base or
// on a commit of the range, or on a commit with the same patch-id as one in
// the range, so cherry-picked and rebased copies keep their receipts.
function bound(receipt, change, commits) {
  if (receipt.head === change.base || commits.has(receipt.head)) return true;
  return (
    receipt.headPatch !== null &&
    [...commits.values()].includes(receipt.headPatch)
  );
}

// `context` holds { key, lock, routing, change, commits }. `key` may
// be null only while pulling, before the owner commits a public key.
function receiptFault(receipt, skill, context) {
  if (receipt.skill !== skill) return `is for ${receipt.skill}`;
  if (context.key && !signed(receipt, context.key))
    return 'has a signature that the committed public key does not verify';
  if (!context.routing.skills[receipt.skill])
    return 'names a skill outside the catalog';
  if (context.lock.skills[receipt.skill]?.sha256 !== receipt.sha256)
    return `hashes a SKILL.md that is not the one in tools/skills/catalog.lock.json`;
  if (receipt.partial) return 'records a partial read';
  if (!bound(receipt, context.change, context.commits))
    return 'was made on a commit outside this change';
  return null;
}

const actor = receipt => `${receipt.session} ${receipt.agent}`;

function receiptProblems(sections, required, context) {
  const problems = [];
  const valid = { author: [], review: [] };
  for (const { path, role, entry } of sections) {
    for (const receipt of entry.receipts) {
      const fault = receiptFault(receipt, entry.skill, context);
      if (fault)
        problems.push(
          `${path}: ${entry.skill} receipt ${receipt.toolUseId ?? receipt.sig.slice(0, 12)} ${fault}.`,
        );
      else valid[role].push(receipt);
    }
  }
  const authors = new Set(valid.author.map(actor));
  const reviewed = sections.some(({ role }) => role === 'review');
  for (const skill of required) {
    if (!valid.author.some(receipt => receipt.skill === skill))
      problems.push(
        `${skill} is required, but no record holds a valid author receipt for it. Load it with the Skill tool, then run npm run skills:record.`,
      );
    if (
      reviewed &&
      !valid.review.some(
        receipt => receipt.skill === skill && !authors.has(actor(receipt)),
      )
    )
      problems.push(
        `${skill} is required, but no record holds a valid receipt for it from a reviewer who is not an author. The reviewer loads it with the Skill tool, then runs npm run skills:record -- --review.`,
      );
  }
  return problems;
}

// Keeps an entry's valid receipts. An entry with none gets the earliest valid
// candidate, so running skills:record again changes nothing.
function pullReceipts(entry, candidates, context, excluded) {
  entry.receipts = entry.receipts.filter(
    receipt => !receiptFault(receipt, entry.skill, context),
  );
  if (entry.receipts.length) return true;
  const found = candidates
    .filter(
      receipt =>
        !excluded.has(actor(receipt)) &&
        !receiptFault(receipt, entry.skill, context),
    )
    .sort((a, b) => (a.time < b.time ? -1 : 1))[0];
  if (found) entry.receipts.push(found);
  return Boolean(found);
}

// The hook appends lines, so a crash can leave a torn last line. Skip it.
function parseReceipts(text, commonDir) {
  const receipts = [];
  for (const line of text.split('\n').filter(Boolean)) {
    let parsed;
    try {
      parsed = receiptSchema.safeParse(JSON.parse(line));
    } catch {
      continue;
    }
    if (parsed.success && parsed.data.commonDir === commonDir)
      receipts.push(parsed.data);
  }
  return receipts;
}

module.exports = {
  actor,
  canonical,
  missingKey,
  parseReceipts,
  publicKeyPath,
  pullReceipts,
  readPublicKey,
  receiptProblems,
  receiptSchema,
};
