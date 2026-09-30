const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function evaluate(audit, dispositions, today) {
  if (
    audit.error ||
    audit.auditReportVersion !== 2 ||
    !audit.vulnerabilities ||
    !audit.metadata?.dependencies
  ) {
    throw new Error('Audit response is missing or invalid.');
  }
  const failures = new Set();
  for (const [name, finding] of Object.entries(audit.vulnerabilities)) {
    if (!['low', 'moderate', 'high', 'critical'].includes(finding.severity)) {
      throw new Error(`Unknown advisory severity for ${name}.`);
    }
    if (['high', 'critical'].includes(finding.severity))
      failures.add(`${name}: ${finding.severity}`);
    for (const advisory of finding.via) {
      if (typeof advisory === 'string') continue;
      if (['high', 'critical'].includes(advisory.severity)) continue;
      const disposition = dispositions[advisory.url];
      if (
        !disposition ||
        disposition.range !== advisory.range ||
        disposition.decision !== 'track' ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(disposition.reviewBy) ||
        disposition.reviewBy < today ||
        !disposition.reason
      ) {
        failures.add(`${name}: needs current review (${advisory.url})`);
      }
    }
  }
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
  for (const failure of failures) console.error(failure);
  console.log(
    `Dependency policy: ${failures.length === 0 ? 'PASS' : 'FAIL'}; high/critical findings have no exceptions.`,
  );
  if (failures.length) process.exitCode = 1;
}

module.exports = { evaluate };
if (require.main === module) main();
