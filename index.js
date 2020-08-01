const github = require("@actions/github");
const core = require("@actions/core");

async function run() {
    const secretToken = core.getInput("secret-token");
    const epicPrefix = core.getInput("epic-prefix");
    const octokit = new github.getOctokit(secretToken);
    const context = github.context;

    // Safety check - only act on issues
    var sourceIssue = context.payload.issue
    if (!sourceIssue)
        return;

    /*
     * The issue may be an Epic that has been created / updated, in which case we
     * reformat the 'Workload' section to include issue titles etc.
     *
     * It may also be a normal issue that is referenced within an Epic - in that
     * case we just update the corresponding entry in the 'Workload' section,
     * marking the task as complete, abandoned etc.
     *
     * Check the issue title to find out which is the case, using 'epicPrefix' to
     * identify the issue as an actual Epic.
     */
    if (sourceIssue.title.startsWith(epicPrefix))
        updateEpicIssue(octokit, context, sourceIssue);
    else
        updateEpicFromTask(octokit, context, sourceIssue);
}

// Update Epic issue
async function updateEpicIssue(octokit, context, issue) {
    console.log("Updating Epic issue '" + issue.title + "'...");
    console.log("  -- Issue number is " + issue.number);
    console.log("  -- Issue body is '" + issue.body + "'");
    // console.log(issue);

    /*
     * Issues forming the workload for this Epic are expected to be in a section
     * of the main issue body called 'Workload', as indicated by a markdown
     * heading ('#', '##', etc.).
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
        var bits = matchExpression.exec(line);
        if (bits) {
            console.log("MATCH:");
            console.log(" -- Full: " + bits[0]);
            console.log(" -- Pre : [" + bits[1] + "]");
            console.log(" -- Check : [" + bits[2] + "]");
            console.log(" -- Number : [" + bits[3] + "]");
        }
    }
}

// Update Task issue within Epic
async function updateEpicFromTask(octokit, context, taskIssue) {
    console.log("Updating task issue '" + taskIssue.title + "'...");
    console.log("  -- Issue number is " + taskIssue.number);
    console.log("  -- Issue body is '" + taskIssue.body + "'");
    console.log(taskIssue);

    /*
     * Normal issues may or may not be associated to an Epic. If they are not,
     * there is nothing more to do. If they are, then we must update the Epic
     * accordingly.
     */
    const timeline = await octokit.issues.listEventsForTimeline({
        ...context.repo,
        issue_number: taskIssue.number
    });
    console.log(timeline);
    // Look for 'cross-referenced' events, and check if those relate to Epics
    for (event of timeline.data) {
        if (event.event != "cross-referenced")
            continue;
        console.log("FOUND A CROSS-REFERENCED TIMELINE EVENT:");
        console.log(event.source);

        // If the cross-referencing event is not an issue, continue
        if (event.source.type != "issue")
            continue;

        // Get referencing issue
        const refIssue = event.source.issue;

        // Is the cross-referencing issue an Epic?
        if (!refIssue.title.startsWith(epicPrefix))
            continue;

        // Update the Epic issue body based on our own data if necessary
        var newBody = updateTaskInEpic(refIssue.body, taskIssue);
        console.log("UPDATED EPIC BODY:");
        console.log(newBody);
        // Get the referencing issue number / from the 'source' data
//         const refIssue = await octokit.issues.get({
//             ...context.repo,
//             issue_number: event.source.number
//         });
    }
}

// Update task within supplied body text from issue data given
async function updateTaskInEpic(epicBody, taskIssue) {
    var inWorkload = false
    var body = epicBody.split(/\r?\n/g);
    var newBody = "";
    var nBodyLines = body.length;
    for (var i = 0; i < nBodyLines; ++i) {
        // Check for heading, potentially indicating the start of the workload section
        if (body[i].startsWith("#")) {
            if (body[i].endsWith("Workload")) {
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
        console.log("TEST LINE: " + body[i]);
        const matchExpression = /(?<pre> *)- \[(?<closed>x| )\] #(?<number>[0-9+]) *(?<title>.*)/g;
        var match = matchExpression.exec(body[i]);
        if (!match)
            continue;
        console.log(match.groups);

        // Does the taskIssue number match the one on this line?
        if (match.groups.number != taskIssue.number)
            continue;

        // Found the taskIssue in the list, so check its status and update as necessary
        var update = false;
        const taskIssueClosed = taskIssue.state === "closed" ? "x" : " ";
        if (match.groups.closed != taskIssueClosed)
            update = true;
        if (match.groups.title != taskIssue.title)
            update = true;

        // Return null if no updates were necessary
        if (!update)
            return null;

        // Reconstitute the line, and break out of the loop
        body[i] = match.groups.pre + "- [" + taskIssueClosed + "] #" + match.groups.number + " " + taskIssue.title + " MARKER";
        break;
    }

    // Reconstitute and return updated body text
    return body.join("\r\n");
}

// Run the action
run()

