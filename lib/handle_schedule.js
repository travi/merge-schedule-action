module.exports = handleSchedule;

const core = require("@actions/core");
const { Octokit } = require("@octokit/action");

/**
 * handle "schedule" event
 */
async function handleSchedule() {
  const octokit = new Octokit();
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

  core.info(`Loading open pull request`);
  const pullRequests = await octokit.paginate(
    "GET /repos/:owner/:repo/pulls",
    {
      owner,
      repo,
      state: "open",
    },
    (response) => {
      return response.data
        .filter((pullRequest) => hasScheduleCommand(pullRequest))
        .filter((pullRequest) => isntFromFork(pullRequest))
        .map((pullRequest) => {
          return {
            number: pullRequest.number,
            html_url: pullRequest.html_url,
            scheduledDate: getScheduleDateString(pullRequest.body),
            ref: pullRequest.head.sha,
          };
        });
    }
  );

  core.info(`${pullRequests.length} scheduled pull requests found`);

  if (pullRequests.length === 0) {
    return;
  }

  const duePullRequests = pullRequests.filter(
    (pullRequest) => new Date(pullRequest.scheduledDate) < new Date()
  );

  core.info(`${duePullRequests.length} due pull requests found`);

  if (duePullRequests.length === 0) {
    return;
  }

  for await (const pullRequest of duePullRequests) {
    await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pullRequest.number,
    });

    // find check runs by the Merge schedule action
    const checkRuns = await octokit.paginate(octokit.checks.listForRef, {
      owner: eventPayload.repository.owner.login,
      repo: eventPayload.repository.name,
      ref: pullRequest.ref,
    });

    const checkRun = checkRuns.pop();
    if (!checkRun) continue;

    await octokit.checks.update({
      check_run_id: checkRun.id,
      owner: eventPayload.repository.owner.login,
      repo: eventPayload.repository.name,
      name: "Merge Schedule",
      head_sha: eventPayload.pull_request.head.sha,
      status: "completed",
      output: {
        title: `Scheduled on ${datestring}`,
        summary: "Merged successfully",
      },
    });

    core.info(`${pullRequest.html_url} merged`);
  }
}

function hasScheduleCommand(pullRequest) {
  return /(^|\n)\/schedule /.test(pullRequest.body);
}

function isntFromFork(pullRequest) {
  return !pullRequest.head.repo.fork;
}

function getScheduleDateString(text) {
  return text.match(/(^|\n)\/schedule (.*)/).pop();
}
