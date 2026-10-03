const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const serious = ['high', 'critical'];
const unpatchedDays = 14;

function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function latestRelease(name) {
  const result = spawnSync('npm', ['view', name, 'version', '--json'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.error || result.signal || result.status !== 0)
    throw new Error(`npm view ${name} did not complete.`);
  return JSON.parse(result.stdout);
}

function assertAudit(audit) {
  if (
    audit.error ||
    audit.auditReportVersion !== 2 ||
    !audit.vulnerabilities ||
    !audit.metadata?.dependencies
  ) {
    throw new Error('Audit response is missing or invalid.');
  }
  for (const [name, finding] of Object.entries(audit.vulnerabilities)) {
    if (!['low', 'moderate', 'high', 'critical'].includes(finding.severity)) {
      throw new Error(`Unknown advisory severity for ${name}.`);
    }
  }
}

function seriousAdvisories(vulnerabilities) {
  const advisories = new Map();
  for (const finding of Object.values(vulnerabilities))
    for (const advisory of finding.via)
      if (typeof advisory !== 'string' && serious.includes(advisory.severity))
        advisories.set(advisory.url, advisory);
  return advisories;
}

function unpatchedProblem(advisory, disposition, today, latestOf) {
  if (disposition?.decision !== 'track-unpatched')
    return 'has no track-unpatched disposition';
  if (advisory.severity !== 'high')
    return `is ${advisory.severity}, and only a high advisory can be tracked unpatched`;
  if (
    disposition.package !== advisory.name ||
    disposition.range !== advisory.range ||
    disposition.severity !== advisory.severity
  )
    return 'has a track-unpatched disposition for another package, range or severity';
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(disposition.reviewBy) ||
    disposition.reviewBy < today ||
    disposition.reviewBy > addDays(today, unpatchedDays)
  )
    return `needs a reviewBy date from today to ${unpatchedDays} days ahead`;
  if (!disposition.reason) return 'needs a reason';
  const latest = latestOf(advisory.name);
  if (latest !== disposition.latest)
    return `may be fixed, because ${advisory.name} ${latest} is released`;
  return null;
}

// A name the audit doesn't list yields undefined, which nothing excuses, so
// the package stays blocked.
function reached(vulnerabilities, name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const finding = vulnerabilities[name];
  if (!finding) return [undefined];
  return finding.via.flatMap(entry =>
    typeof entry === 'string'
      ? reached(vulnerabilities, entry, seen)
      : serious.includes(entry.severity)
        ? [entry.url]
        : [],
  );
}

function covered(vulnerabilities, name, excused) {
  const urls = reached(vulnerabilities, name);
  return urls.length > 0 && urls.every(url => excused.has(url));
}

function needsReview(advisory, disposition, today) {
  return (
    !disposition ||
    disposition.range !== advisory.range ||
    disposition.decision !== 'track' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(disposition.reviewBy) ||
    disposition.reviewBy < today ||
    !disposition.reason
  );
}

function evaluate(audit, dispositions, today, latestOf = latestRelease) {
  assertAudit(audit);
  const failures = new Set();
  const advisories = seriousAdvisories(audit.vulnerabilities);
  const excused = new Set();
  for (const [url, advisory] of advisories) {
    const problem = unpatchedProblem(
      advisory,
      dispositions[url],
      today,
      latestOf,
    );
    if (problem) failures.add(`${advisory.name}: ${url} ${problem}`);
    else excused.add(url);
  }
  for (const [name, finding] of Object.entries(audit.vulnerabilities)) {
    if (
      serious.includes(finding.severity) &&
      !covered(audit.vulnerabilities, name, excused)
    )
      failures.add(`${name}: ${finding.severity}`);
    for (const advisory of finding.via) {
      if (typeof advisory === 'string') continue;
      if (serious.includes(advisory.severity)) continue;
      if (needsReview(advisory, dispositions[advisory.url], today))
        failures.add(`${name}: needs current review (${advisory.url})`);
    }
  }
  for (const [url, disposition] of Object.entries(dispositions))
    if (disposition.decision === 'track-unpatched' && !advisories.has(url))
      failures.add(
        `${url}: track-unpatched disposition matches no high advisory`,
      );
  return [...failures];
}

function main() {
  const result = spawnSync('npm', ['audit', '--json', '--package-lock-only'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error || result.signal || ![0, 1].includes(result.status))
    throw new Error('npm audit did not complete.');
  const audit = JSON.parse(result.stdout);
  const dispositions = JSON.parse(
    readFileSync(
      join(__dirname, 'verification/dependency-dispositions.json'),
      'utf8',
    ),
  );
  const failures = evaluate(
    audit,
    dispositions,
    new Date().toISOString().slice(0, 10),
  );
  const tracked = Object.values(dispositions).filter(
    disposition => disposition.decision === 'track-unpatched',
  ).length;
  for (const failure of failures) console.error(failure);
  console.log(
    `Dependency policy: ${failures.length === 0 ? 'PASS' : 'FAIL'}; high and critical findings block, except ${tracked} tracked unpatched high ${tracked === 1 ? 'advisory' : 'advisories'}.`,
  );
  if (failures.length) process.exitCode = 1;
}

module.exports = { evaluate };
if (require.main === module) main();
