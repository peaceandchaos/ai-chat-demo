const inspect = require('../github/target-health.cjs');

function fixture() {
  const head = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const state = {
    pr: {
      number: 1,
      state: 'open',
      head: { sha: head },
      base: { ref: 'main' },
    },
    base,
    run: {
      id: 42,
      head_sha: base,
      head_branch: 'main',
      status: 'completed',
      conclusion: 'success',
    },
    jobs: [
      {
        name: 'verify (commit)',
        conclusion: 'success',
        steps: [
          'Install locked dependencies',
          'Verify committed source',
          'Upload results',
        ].map(name => ({ name, conclusion: 'success' })),
      },
      { name: 'quality-gate', conclusion: 'success' },
    ],
    statuses: [],
    queries: [],
    approvals: [],
    changedHead: false,
  };
  const api = {
    pulls: {
      list: async () => [state.pr],
      get: async () => ({
        data: state.changedHead
          ? { ...state.pr, head: { sha: 'c'.repeat(40) } }
          : state.pr,
      }),
    },
    git: { getRef: async () => ({ data: { object: { sha: state.base } } }) },
    actions: {
      listWorkflowRuns: async query => {
        state.queries.push(query);
        return { data: { workflow_runs: state.run ? [state.run] : [] } };
      },
      listJobsForWorkflowRun: async query => {
        state.queries.push(query);
        return state.jobs;
      },
      getWorkflowRun: async () => ({
        data: {
          event: 'workflow_dispatch',
          path: '.github/workflows/target-health.yml',
          actor: { login: 'peaceandchaos' },
          triggering_actor: { login: 'peaceandchaos' },
          head_branch: 'main',
        },
      }),
    },
    checks: {
      create: async approval => {
        state.approvals.push({ ...approval, app: { slug: 'github-actions' } });
      },
      listForRef: async () => state.approvals,
    },
    repos: {
      createCommitStatus: async value => {
        state.statuses.push(value);
      },
    },
  };
  const github = { rest: api, paginate: (endpoint, args) => endpoint(args) };
  const context = {
    repo: { owner: 'peaceandchaos', repo: 'ai-chat-demo' },
    serverUrl: 'https://github.com',
    eventName: 'workflow_run',
    actor: 'peaceandchaos',
    ref: 'refs/heads/main',
    runId: 73,
    payload: { repository: { default_branch: 'main' }, inputs: {} },
  };
  const core = { error: jest.fn(), setFailed: jest.fn() };
  return { state, github, context, core };
}

test('metadata controller checks the exact target and latest attempt before publishing on the candidate', async () => {
  const f = fixture();
  await inspect(f.github, f.context, f.core);
  expect(f.state.queries[0]).toMatchObject({
    branch: 'main',
    event: 'push',
    head_sha: f.state.base,
    workflow_id: 'ci.yml',
    per_page: 1,
  });
  expect(f.state.queries[1]).toMatchObject({ run_id: 42, filter: 'latest' });
  expect(f.state.statuses.map(value => [value.sha, value.state])).toEqual([
    [f.state.pr.head.sha, 'pending'],
    [f.state.pr.head.sha, 'success'],
  ]);
});

test('missing, pending, failed, skipped, and stale verification all hold the candidate', async () => {
  const faults = [
    f => {
      f.state.run = null;
    },
    f => {
      f.state.run.status = 'in_progress';
    },
    f => {
      f.state.run.conclusion = 'failure';
    },
    f => {
      f.state.jobs[0].steps[1].conclusion = 'skipped';
    },
    f => {
      f.state.changedHead = true;
    },
  ];
  for (const fault of faults) {
    const f = fixture();
    fault(f);
    await inspect(f.github, f.context, f.core);
    expect(f.state.statuses.at(-1).state).toBe('failure');
  }
});

test('owner repair binds PR, head, and base; a changed target invalidates it', async () => {
  const f = fixture();
  f.state.run.conclusion = 'failure';
  f.context.eventName = 'workflow_dispatch';
  f.context.payload.inputs = {
    operation: 'approve-repair',
    pr: '1',
    head: f.state.pr.head.sha,
    base: f.state.base,
  };
  await inspect(f.github, f.context, f.core);
  expect(f.state.approvals).toHaveLength(1);
  expect(f.state.statuses.at(-1).state).toBe('success');
  f.context.eventName = 'workflow_run';
  f.state.base = 'd'.repeat(40);
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('failure');
  f.context.eventName = 'workflow_dispatch';
  f.context.actor = 'agent[bot]';
  await expect(inspect(f.github, f.context, f.core)).rejects.toThrow(
    'Only the owner',
  );
  expect(f.state.approvals).toHaveLength(1);
});
