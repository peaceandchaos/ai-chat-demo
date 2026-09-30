// Enforcement probe E8. It fails only in push runs of disposable exercise/ targets,
// so a target can become unhealthy without any defect reaching main.
test('enforcement probe E8 fails only in exercise target push runs', () => {
  const exerciseTargetPush =
    process.env.GITHUB_EVENT_NAME === 'push' &&
    (process.env.GITHUB_REF ?? '').startsWith('refs/heads/exercise/');
  expect(exerciseTargetPush).toBe(false);
});
