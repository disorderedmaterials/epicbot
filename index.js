const github = require("@actions/github");
const core = require("@actions/core");

async function run() {
    const secretToken = core.getInput("secret-token");
    const epicPrefix = core.getInput("epic-prefix");
    const octokit = new github.getOctokit({
        auth: 'token ${process.env.GITHUB_TOKEN}'
    });
    const context = github.context;

    // Safety check - only act on issues
    var sourceIssue = context.payload.issue
    if (!sourceIssue) {
        return;
    }

    /*
     * The issue may be an Epic that has been created / updated, in which case we reformat the 'Workload' section to
     * include issue titles etc.
     *
     * It may also be a normal issue that is referenced within an Epic - in that case we just update the corresponding
     * entry in the 'Workload' section, marking the task as complete, abandoned etc.
     *
     * Check the issue title to find out which is the case, using 'epicPrefix' to identify the issue as an actual Epic.
     */
    if (sourceIssue.title.startsWith(epicPrefix))
        updateEpic(octokit, context, sourceIssue);
}

// Update Epic issue
async function updateEpic(octokit, context, issue) {
    console.log("Updating Epic issue '" + issue.title + "'...");
    console.log("  -- Issue number is " + issue.number);
    console.log("  -- Issue body is '" + issue.body + "'");
    //console.log(issue);

    /*
     * Issues forming the workload for this Epic are expected to be in a section of the main issue body called 'Workload',
     * as indicated by a markdown heading ('#', '##', etc.).
     */

    // Split the Epic body into individual lines
    var inWorkload = false
    var body = issue.body.split(/\r?\n/g);
    for (line of body) {
        // Check for heading, potentially indicating the start of the workload section
        if (line.startsWith("#")) {
            if (line.endsWith("Workload")) {
                inWorkload = true;
                continue;
            }
            else if (inWorkload)
                break;
        }

        // If we are not in the workload section, no need to do anything else
        if (!inWorkload)
            continue;

        // Does the line start with checkbox MD, indicating a task?
        console.log("TEST LINE: " + line);
        const matchExpression = /( *)- \[(x| )\] #([0-9+]).*/g;
        var bits = line.match(matchExpression);
        if (bits) {
            console.log("MATCH:");
            console.log(bits);
        }
    }
}

// Run the action
run()
