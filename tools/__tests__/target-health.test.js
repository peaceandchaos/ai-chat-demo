const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
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
      run_attempt: 1,
      event: 'push',
      head_sha: base,
      head_branch: 'main',
      status: 'completed',
      conclusion: 'success',
    },
    jobs: [
      {
        name: 'verify (commit)',
        conclusion: 'success',
        steps: ['Verify committed source', 'Upload results'].map(name => ({
          name,
          conclusion: 'success',
        })),
      },
      { name: 'quality-gate', conclusion: 'success' },
    ],
    statuses: [],
    queries: [],
    runLookups: 0,
    onRunLookup: null,
    approvals: [],
    approvalRunAttempt: 1,
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
        state.runLookups += 1;
        state.onRunLookup?.(state.runLookups);
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
          run_attempt: state.approvalRunAttempt,
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
  expect(f.state.approvals[0].external_id).toBe(
    `1:${f.state.pr.head.sha}:${f.state.base}:42:1`,
  );
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

test('owner repair requires an exact completed target push run that failed verification', async () => {
  const faults = [
    f => {
      f.state.run = null;
    },
    f => {
      f.state.run.status = 'in_progress';
    },
    f => {
      f.state.run.conclusion = 'cancelled';
    },
    f => {
      f.state.run.conclusion = 'success';
    },
    f => {
      f.state.run.head_sha = 'c'.repeat(40);
      f.state.run.conclusion = 'failure';
    },
    f => {
      f.state.run.event = 'pull_request';
      f.state.run.conclusion = 'failure';
    },
  ];
  for (const fault of faults) {
    const f = fixture();
    fault(f);
    f.context.eventName = 'workflow_dispatch';
    f.context.payload.inputs = {
      operation: 'approve-repair',
      pr: '1',
      head: f.state.pr.head.sha,
      base: f.state.base,
    };
    await expect(inspect(f.github, f.context, f.core)).rejects.toThrow(
      'no exact completed push run that failed verification',
    );
    expect(f.state.approvals).toHaveLength(0);
  }
});

test('an approved repair expires when the target run or attempt changes', async () => {
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
  expect(f.state.statuses.at(-1).state).toBe('success');

  f.context.eventName = 'workflow_run';
  f.state.run.run_attempt = 2;
  f.state.run.status = 'in_progress';
  f.state.run.conclusion = null;
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('failure');

  f.state.run.status = 'completed';
  f.state.run.conclusion = 'failure';
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('failure');

  f.state.run.run_attempt = 1;
  f.state.run.conclusion = 'cancelled';
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('failure');
  f.state.run.run_attempt = 2;
  f.state.run.conclusion = 'failure';

  f.context.eventName = 'workflow_dispatch';
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('success');
  expect(f.state.approvals.at(-1).external_id).toBe(
    `1:${f.state.pr.head.sha}:${f.state.base}:42:2`,
  );

  f.context.eventName = 'workflow_run';
  f.state.run.id = 43;
  f.state.run.run_attempt = 1;
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('failure');
});

test('a target rerun during inspection prevents repaired success', async () => {
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
  expect(f.state.statuses.at(-1).state).toBe('success');

  f.context.eventName = 'workflow_run';
  f.state.runLookups = 0;
  f.state.onRunLookup = count => {
    if (count !== 2) return;
    f.state.run.run_attempt = 2;
    f.state.run.status = 'in_progress';
    f.state.run.conclusion = null;
  };
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('failure');
});

function repairDispatch(f) {
  f.context.eventName = 'workflow_dispatch';
  f.context.payload.inputs = {
    operation: 'approve-repair',
    pr: '1',
    head: f.state.pr.head.sha,
    base: f.state.base,
  };
}

test('owner repair covers every completed target run that fails verification', async () => {
  const faults = [
    f => {
      f.state.run.conclusion = 'timed_out';
    },
    f => {
      f.state.run.conclusion = 'startup_failure';
    },
    f => {
      f.state.jobs[0].steps[0].name = 'Renamed verification step';
    },
  ];
  for (const fault of faults) {
    const f = fixture();
    fault(f);
    await inspect(f.github, f.context, f.core);
    expect(f.state.statuses.at(-1).state).toBe('failure');
    repairDispatch(f);
    await inspect(f.github, f.context, f.core);
    expect(f.state.approvals.map(value => value.external_id)).toEqual([
      `1:${f.state.pr.head.sha}:${f.state.base}:42:1`,
    ]);
    expect(f.state.statuses.at(-1).state).toBe('success');
  }
});

test('a rerun of an approval dispatch cannot approve or count as approval', async () => {
  const f = fixture();
  f.state.run.conclusion = 'failure';
  repairDispatch(f);
  f.state.approvalRunAttempt = 2;
  await expect(inspect(f.github, f.context, f.core)).rejects.toThrow(
    'fresh owner dispatch',
  );
  expect(f.state.approvals).toHaveLength(0);

  f.state.approvalRunAttempt = 1;
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('success');

  f.state.approvalRunAttempt = 2;
  f.context.eventName = 'workflow_run';
  await inspect(f.github, f.context, f.core);
  expect(f.state.statuses.at(-1).state).toBe('failure');
});

test('the controller reads job and step names that the CI workflow defines', () => {
  const { workflow, verifyJob, gateJob, verifySteps } = inspect.ciContract;
  const ci = readFileSync(
    resolve(__dirname, '../../.github/workflows', workflow),
    'utf8',
  );
  const template = 'verify (${{ matrix.revision }})';
  expect(ci).toContain(`name: ${template}`);
  expect(ci).toContain(`'["commit"]'`);
  expect(verifyJob).toBe(template.replace('${{ matrix.revision }}', 'commit'));
  expect(ci).toMatch(
    new RegExp(`^  ${gateJob}:\\n    name: ${gateJob}$`, 'mu'),
  );
  for (const step of verifySteps)
    expect(ci).toMatch(new RegExp(`^      - name: ${step}$`, 'mu'));
});
