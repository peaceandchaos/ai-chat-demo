// These are the implemented acceptance checks. Changes require owner review.
const checks = {
  lint: ['run', 'lint'],
  format: ['run', 'format:check'],
  types: ['run', 'typecheck'],
  tests: ['run', 'test:verified'],
  credentials: ['run', 'secrets'],
  security: ['run', 'security'],
  dependencies: ['run', 'audit:check'],
  'server-build': ['run', 'build:server'],
  'ios-js-bundle': ['run', 'build:ios-js'],
  'react-compiler': ['run', 'react-compiler-check'],
};

// Each range check also receives the merge base and the verified commit.
const rangeChecks = {
  'skill-records': ['run', 'skills:check', '--'],
};

module.exports = { checks, rangeChecks };
