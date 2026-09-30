// This controller reads GitHub metadata only. It never executes candidate code.
const controllerPath = '.github/workflows/target-health.yml';
const ownerLogin = 'peaceandchaos';

function requiredJobsPassed(jobs) {
  const verification = jobs.find(job => job.name === 'verify (commit)');
  const gate = jobs.find(job => job.name === 'quality-gate');
  if (verification?.conclusion !== 'success' || gate?.conclusion !== 'success')
    return false;
  return ['Verify committed source', 'Upload results'].every(name =>
    verification.steps.some(
      step => step.name === name && step.conclusion === 'success',
    ),
  );
}

async function targetState(github, repo, branch) {
  const target = await github.rest.git.getRef({
    ...repo,
    ref: `heads/${branch}`,
  });
  const sha = target.data.object.sha;
  const response = await github.rest.actions.listWorkflowRuns({
    ...repo,
    workflow_id: 'ci.yml',
    branch,
    event: 'push',
    head_sha: sha,
    per_page: 1,
  });
  const run = response.data.workflow_runs[0];
  if (
    !run ||
    run.head_sha !== sha ||
    run.head_branch !== branch ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    return { sha, passed: false };
  const jobs = await github.paginate(
    github.rest.actions.listJobsForWorkflowRun,
    { ...repo, run_id: run.id, filter: 'latest', per_page: 100 },
  );
  return { sha, passed: requiredJobsPassed(jobs) };
}

async function approveRepair(github, context) {
  const inputs = context.payload.inputs;
  if (
    context.actor !== ownerLogin ||
    context.ref !== `refs/heads/${context.payload.repository.default_branch}`
  )
    throw new Error(
      'Only the owner may authorize a repair from the default branch.',
    );
  if (
    !/^[1-9]\d*$/u.test(inputs.pr) ||
    !/^[a-f0-9]{40}$/u.test(inputs.head) ||
    !/^[a-f0-9]{40}$/u.test(inputs.base)
  )
    throw new Error('Provide the exact PR, head SHA, and target SHA.');
  const pr = (
    await github.rest.pulls.get({
      ...context.repo,
      pull_number: Number(inputs.pr),
    })
  ).data;
  const target = await github.rest.git.getRef({
    ...context.repo,
    ref: `heads/${pr.base.ref}`,
  });
  if (
    pr.state !== 'open' ||
    pr.head.sha !== inputs.head ||
    target.data.object.sha !== inputs.base
  )
    throw new Error('Repair identities changed; nothing was approved.');
  await github.rest.checks.create({
    ...context.repo,
    name: 'owner-repair-approval',
    head_sha: inputs.head,
    external_id: `${pr.number}:${inputs.head}:${inputs.base}`,
    status: 'completed',
    conclusion: 'success',
    details_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
    output: {
      title: 'Owner authorized target-health repair exception',
      summary:
        'This binds one PR, candidate SHA, and target SHA. All candidate checks and reviews remain required.',
    },
  });
}

async function repairAllowed(github, context, pr, baseSha) {
  const approvals = await github.paginate(github.rest.checks.listForRef, {
    ...context.repo,
    ref: pr.head.sha,
    check_name: 'owner-repair-approval',
    filter: 'all',
    per_page: 100,
  });
  const prefix = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/`;
  for (const approval of approvals) {
    if (
      approval.app?.slug !== 'github-actions' ||
      approval.conclusion !== 'success' ||
      approval.external_id !== `${pr.number}:${pr.head.sha}:${baseSha}` ||
      !approval.details_url?.startsWith(prefix)
    )
      continue;
    const runId = approval.details_url.slice(prefix.length);
    if (!/^[1-9]\d*$/u.test(runId)) continue;
    const run = (
      await github.rest.actions.getWorkflowRun({
        ...context.repo,
        run_id: Number(runId),
      })
    ).data;
    if (
      run.event === 'workflow_dispatch' &&
      run.path.split('@')[0] === controllerPath &&
      run.actor.login === ownerLogin &&
      run.triggering_actor.login === ownerLogin &&
      run.head_branch === context.payload.repository.default_branch
    )
      return true;
  }
  return false;
}

async function status(github, repo, sha, state, description) {
  await github.rest.repos.createCommitStatus({
    ...repo,
    sha,
    context: 'target-health',
    state,
    description,
  });
}

async function groupHealthy(github, context, pulls) {
  const targets = new Map();
  for (const pr of pulls) {
    if (pr.base.ref.startsWith('submission/')) return false;
    if (!targets.has(pr.base.ref))
      targets.set(
        pr.base.ref,
        await targetState(github, context.repo, pr.base.ref),
      );
    const target = targets.get(pr.base.ref);
    if (
      !target.passed &&
      !(await repairAllowed(github, context, pr, target.sha))
    )
      return false;
  }
  // Results are SHA-scoped. Check every PR sharing a head, then recheck identities.
  for (const pr of pulls) {
    const current = (
      await github.rest.pulls.get({ ...context.repo, pull_number: pr.number })
    ).data;
    const target = await github.rest.git.getRef({
      ...context.repo,
      ref: `heads/${pr.base.ref}`,
    });
    if (
      current.state !== 'open' ||
      current.head.sha !== pr.head.sha ||
      current.base.ref !== pr.base.ref ||
      target.data.object.sha !== targets.get(pr.base.ref).sha
    )
      return false;
  }
  return true;
}

async function inspect(github, context, core) {
  if (
    context.eventName === 'workflow_dispatch' &&
    context.payload.inputs.operation === 'approve-repair'
  )
    await approveRepair(github, context);
  const pulls = await github.paginate(github.rest.pulls.list, {
    ...context.repo,
    state: 'open',
    per_page: 100,
  });
  const groups = new Map();
  for (const pr of pulls) {
    if (!groups.has(pr.head.sha)) groups.set(pr.head.sha, []);
    groups.get(pr.head.sha).push(pr);
  }
  for (const sha of groups.keys())
    await status(
      github,
      context.repo,
      sha,
      'pending',
      'Checking the current integration target.',
    );
  for (const [sha, group] of groups) {
    try {
      const healthy = await groupHealthy(github, context, group);
      await status(
        github,
        context.repo,
        sha,
        healthy ? 'success' : 'failure',
        healthy
          ? 'All current targets are healthy or have an owner-approved repair.'
          : 'A target is unverified, unhealthy, or changed during inspection.',
      );
    } catch (error) {
      core.error(error.message);
      await status(
        github,
        context.repo,
        sha,
        'error',
        'Target verification was unavailable.',
      );
      core.setFailed('At least one target could not be verified.');
    }
  }
}

module.exports = inspect;
module.exports.requiredJobsPassed = requiredJobsPassed;
