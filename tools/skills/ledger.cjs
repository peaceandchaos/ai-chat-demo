const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { z } = require('zod');
const { git } = require('../verification/snapshot.cjs');

const ledgerPath = 'tools/skills/ledger.json';
const testCase = { file: z.string().min(1), name: z.string().min(1) };
const enforcement = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('guidance') }),
  z.strictObject({ kind: z.literal('type'), ...testCase }),
  z.strictObject({ kind: z.literal('test'), ...testCase }),
  z.strictObject({ kind: z.literal('lint'), rule: z.string().min(1) }),
  z.strictObject({ kind: z.literal('check'), check: z.string().min(1) }),
]);
const ledgerSchema = z.strictObject({
  lessons: z.array(
    z.strictObject({
      id: z.string().regex(/^[a-z0-9-]+$/u),
      lesson: z.string().min(1),
      seen: z.array(z.string().min(1)).min(1),
      enforcement,
      paths: z.array(z.string().min(1)).min(1).optional(),
      link: z.string().min(1).optional(),
    }),
  ),
});

function readLedger(root) {
  return ledgerSchema.parse(
    JSON.parse(readFileSync(join(root, ledgerPath), 'utf8')),
  );
}

function enforcementProblem(root, { enforcement: rule }) {
  if (rule.kind === 'guidance') return null;
  if (rule.kind === 'check') {
    const { checks, rangeChecks } = require(
      join(root, 'tools/verification/checks.cjs'),
    );
    return rule.check in checks || rule.check in rangeChecks
      ? null
      : `names check ${rule.check}, which tools/verification/checks.cjs does not run`;
  }
  if (rule.kind === 'lint') {
    const config = JSON.parse(
      readFileSync(join(root, '.oxlintrc.json'), 'utf8'),
    );
    const setting = [config.rules[rule.rule]].flat()[0];
    return setting !== undefined && setting !== 'off' && setting !== 0
      ? null
      : `names lint rule ${rule.rule}, which .oxlintrc.json does not enable`;
  }
  const path = join(root, rule.file);
  return existsSync(path) &&
    readFileSync(path, 'utf8').includes(`'${rule.name}'`)
    ? null
    : `names test '${rule.name}', which ${rule.file} does not contain`;
}

function linkProblem(root, link) {
  if (link === undefined || /^https:\/\/\S+$/u.test(link)) return null;
  return git(root, ['ls-files', '--', link])
    ? null
    : `links ${link}, which is neither an https URL nor a tracked file`;
}

function ledgerProblems(root, ledger) {
  const problems = [];
  const ids = new Set();
  for (const entry of ledger.lessons) {
    if (ids.has(entry.id)) problems.push(`${entry.id} appears twice.`);
    ids.add(entry.id);
    for (const problem of [
      enforcementProblem(root, entry),
      linkProblem(root, entry.link),
    ])
      if (problem) problems.push(`${entry.id} ${problem}.`);
    if (
      entry.enforcement.kind === 'guidance' &&
      entry.seen.length >= 2 &&
      !entry.link
    )
      problems.push(
        `${entry.id} is guidance only and was seen ${entry.seen.length} times. Enforce it with a type, test, lint rule, or check, or link the issue or decision that keeps it as guidance.`,
      );
  }
  return problems;
}

module.exports = { ledgerPath, readLedger, ledgerProblems };
