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

function bound(receipt, change, commits) {
  if (receipt.head === change.base || commits.has(receipt.head)) return true;
  return (
    receipt.headPatch !== null &&
    (receipt.headPatch === change.basePatch ||
      [...commits.values()].includes(receipt.headPatch))
  );
}

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
const reviewer = receipt =>
  `${actor(receipt)} in ${String(receipt.cwd).slice(0, 12)}`;

function receiptProblems(path, record, required, contexts) {
  const problems = [];
  const validIn = (entry, context, label, authorFolders = new Set()) =>
    entry.receipts.filter(receipt => {
      const fault =
        receiptFault(receipt, entry.skill, context) ??
        (authorFolders.has(receipt.cwd)
          ? "was made in the folder of one of this record's author receipts"
          : null);
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
  const authorReceipts = record.skills.flatMap(entry => entry.receipts);
  const authors = new Set(authorReceipts.map(actor));
  const authorFolders = new Set(authorReceipts.map(receipt => receipt.cwd));
  const reviewers = new Set(
    record.review.skills.flatMap(entry => entry.receipts).map(reviewer),
  );
  if (reviewers.size > 1)
    problems.push(
      `${path}: one session and agent pair in one folder reviews a record, but its review receipts come from ${reviewers.size}: ${[...reviewers].join(', ')}.`,
    );
  for (const entry of record.review.skills)
    if (
      !validIn(entry, contexts.review, 'review of ', authorFolders).some(
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
// candidate, so running skills:record again changes nothing. A `context.folder`
// hash limits both the kept receipts and the candidates to that folder, so a
// run in another folder replaces the receipts.
function pullReceipts(entry, candidates, context, excluded) {
  const usable = receipt =>
    (context.folder === null || receipt.cwd === context.folder) &&
    !receiptFault(receipt, entry.skill, context);
  entry.receipts = entry.receipts.filter(usable);
  if (entry.receipts.length) return true;
  const found = candidates
    .filter(receipt => !excluded.has(actor(receipt)) && usable(receipt))
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
