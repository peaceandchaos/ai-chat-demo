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
// on a commit of the range, or on a commit with the same patch-id as the base
// or one in the range, so cherry-picked and rebased copies keep their receipts.
function bound(receipt, change, commits) {
  if (receipt.head === change.base || commits.has(receipt.head)) return true;
  return (
    receipt.headPatch !== null &&
    (receipt.headPatch === change.basePatch ||
      [...commits.values()].includes(receipt.headPatch))
  );
}

// `context` holds { key, lock, routing, change, commits }, where `change` is
// { base, basePatch }. `key` may be null only while pulling, before the owner
// commits a public key.
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

// Every author entry needs a valid receipt for the record's own range. When
// the record has a review section, every review entry needs a valid receipt
// from a session and agent pair that made none of this record's author
// receipts, and every required skill needs a review entry. `contexts` holds
// { author, review }.
function receiptProblems(path, record, required, contexts) {
  const problems = [];
  const validIn = (entry, context, label) =>
    entry.receipts.filter(receipt => {
      const fault = receiptFault(receipt, entry.skill, context);
      if (fault)
        problems.push(
          `${path}: ${label}${entry.skill} receipt ${receipt.toolUseId ?? receipt.sig.slice(0, 12)} ${fault}.`,
        );
      return !fault;
    });
  for (const entry of record.skills)
    if (!validIn(entry, contexts.author, '').length)
      problems.push(
        `${path}: ${entry.skill} has no valid author receipt. Load it with the Skill tool, then run npm run skills:record -- ${record.change} <base>.`,
      );
  if (!record.review) return problems;
  const authors = new Set(
    record.skills.flatMap(entry => entry.receipts).map(actor),
  );
  for (const entry of record.review.skills)
    if (
      !validIn(entry, contexts.review, 'review of ').some(
        receipt => !authors.has(actor(receipt)),
      )
    )
      problems.push(
        `${path}: review of ${entry.skill} has no valid receipt from a session and agent pair that made none of this record's author receipts. The reviewer loads it with the Skill tool, then runs npm run skills:record -- ${record.change} <base> --review.`,
      );
  for (const skill of required)
    if (!record.review.skills.some(entry => entry.skill === skill))
      problems.push(
        `${path}: ${skill} is required, but the review section has no entry for it. The reviewer loads it with the Skill tool, then runs npm run skills:record -- ${record.change} <base> --review.`,
      );
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
