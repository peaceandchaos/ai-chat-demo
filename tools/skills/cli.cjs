const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');
const { git } = require('../verification/snapshot.cjs');
const { readPlan, readRange } = require('./change.cjs');
const { checkRecords, writeRecord } = require('./records.cjs');
const {
  parseRouting,
  requiredSkills,
  resolveSkill,
  routingPath,
} = require('./routing.cjs');

const oxfmt = resolve(__dirname, '../../node_modules/.bin/oxfmt');
const usage = `Usage:
  npm run skills:required -- <base> [<head>]
  npm run skills:required -- --plan <path>|A:<path>|D:<path>|R:<old>:<new> ...
  npm run skills:catalog
  npm run skills:record -- <change-id> <base> [<head>]
  npm run skills:check -- <base> [<head>]`;

function readRouting(root) {
  return parseRouting(readFileSync(join(root, routingPath), 'utf8'));
}

function describe(change) {
  const files = `${change.files.length} files`;
  if (change.kind === 'plan')
    return `Required skills for a planned change of ${files}.`;
  return `Required skills for ${change.base.slice(0, 12)}..${change.head.slice(0, 12)} (merge base to head): ${files}.`;
}

function printRequired(root, routing, change) {
  const { required, skipped } = requiredSkills(routing, change);
  const lines = [describe(change)];
  if (skipped.length)
    lines.push(
      `A plan has no content, so these rules were not evaluated: ${skipped.join(', ')}.`,
    );
  if (!required.length) lines.push('No skills are required.');
  for (const { skill, reasons } of required) {
    lines.push(
      '',
      skill,
      `  read ${resolveSkill(routing, skill, process.env, root)}`,
    );
    for (const { rule, why, matches } of reasons) {
      lines.push(`  ${rule}: ${why}`);
      for (const { subject, detail } of matches)
        lines.push(`    ${subject}${detail ? ` (${detail})` : ''}`);
    }
  }
  console.log(lines.join('\n'));
}

function record(root, [id, base, head = 'HEAD']) {
  if (!/^[a-z0-9-]+$/u.test(id))
    throw new Error('Name the change in lowercase-with-dashes.');
  const path = writeRecord(
    root,
    readRouting(root),
    readRange(root, base, head),
    id,
  );
  const formatted = spawnSync(oxfmt, ['--write', path], { encoding: 'utf8' });
  if (formatted.status !== 0)
    throw new Error(`oxfmt could not format ${path}.`);
  console.log(
    `Wrote ${relative(root, path)}. Add each skill's findings and their resolutions.`,
  );
}

function check(root, [base, head = 'HEAD']) {
  const change = readRange(root, base, head);
  const { problems, records, required } = checkRecords(
    root,
    readRouting(root),
    change,
  );
  const range = `${change.base.slice(0, 12)}..${change.head.slice(0, 12)}`;
  if (problems.length) {
    console.error([`Skill records for ${range} fail:`, ...problems].join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(
    `Skill records for ${range} cover all ${required} required skills (${records.join(', ') || 'no records needed'}).`,
  );
}

function main(args) {
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const [command, ...rest] = args;
  if (command === 'required' && rest[0] === '--plan' && rest.length > 1) {
    printRequired(root, readRouting(root), readPlan(rest.slice(1)));
  } else if (command === 'required' && rest.length && rest.length <= 2) {
    const change = readRange(root, rest[0], rest[1] ?? 'HEAD');
    printRequired(root, readRouting(root), change);
  } else if (command === 'catalog' && !rest.length) {
    const routing = readRouting(root);
    for (const skill of Object.keys(routing.skills).sort())
      console.log(
        `${skill} ${resolveSkill(routing, skill, process.env, root)}`,
      );
  } else if (command === 'record' && rest.length >= 2 && rest.length <= 3) {
    record(root, rest);
  } else if (command === 'check' && rest.length && rest.length <= 2) {
    check(root, rest);
  } else {
    throw new Error(usage);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
