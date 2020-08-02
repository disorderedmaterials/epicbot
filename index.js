const github = require("@actions/github");
const core = require("@actions/core");

async function run() {
    const secretToken = core.getInput("secret-token");
    const epicPrefix = core.getInput("epic-prefix");
    const workloadMarker = core.getInput("workload-marker");
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
     * marking the task as complete, updating its title, etc.
     *
     * Check the issue title to find out which is the case, using 'epicPrefix' to
     * identify the issue as an actual Epic.
     */
    var result = null;
    if (sourceIssue.title.startsWith(epicPrefix)) {
        try {
            result = await updateEpicIssue(octokit, context, workloadMarker, sourceIssue);
        } catch(err) {
            console.log(err);
            return;
        }
    }
    else {
        try {
            result = await updateEpicFromTask(octokit, context, epicPrefix, workloadMarker, sourceIssue);
        } catch(err) {
            console.log(err);
            return;
        }
    }

    console.log(result);
}

// Update Epic issue
async function updateEpicIssue(octokit, context, workloadMarker, epicIssue) {
    console.log("Updating Epic issue '" + epicIssue.title + "'...");
    console.log("  -- Issue number is " + epicIssue.number);
    console.log("  -- Issue body is '" + epicIssue.body + "'");
    // console.log(issue);

    /*
     * Issues forming the workload for this Epic are expected to be in a section
     * of the main issue body called 'Workload', as indicated by a markdown
     * heading ('#', '##', etc.).
     */

    // Split the Epic body into individual lines
    var inWorkload = false
    var body = epicIssue.body.split(/\r?\n/g);
    for (line of body) {
        // Check for heading, potentially indicating the start of the workload section
        if (line.startsWith("#")) {
            if (line.endsWith(workloadMarker)) {
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

    return false;
}

// Update Task issue within Epic
async function updateEpicFromTask(octokit, context, epicPrefix, workloadMarker, taskIssue) {
    console.log("Updating task issue '" + taskIssue.title + "'...");
    console.log("  -- Issue number is " + taskIssue.number);
    console.log("  -- Issue body is '" + taskIssue.body + "'");
//     console.log(taskIssue);

    /*
     * Normal issues may or may not be associated to an Epic. If they are not,
     * there is nothing more to do. If they are, then we must update the Epic
     * accordingly.
     */
    var timeline = null;
    try {
        timeline = await octokit.issues.listEventsForTimeline({
            ...context.repo,
            issue_number: taskIssue.number
        });
    } catch(err) {
        console.log(err);
        return false;
    }
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
        console.log("Task issue #" + taskIssue.number + " is cross-referenced by Epic #" + refIssue.number);

        // Update the Epic issue body based on our own data if necessary
        var data = updateTaskInEpic(refIssue.body, workloadMarker, taskIssue);
        if (!data) {
            console.log("Nothing to update - Epic #" + refIssue.number + " body remains as-is.");
            return false;
        }
        console.log("UPDATED EPIC BODY:");
        console.log(data.body);

        // Commit the updated Epic
        try {
            await octokit.issues.update({
                ...context.repo,
                issue_number: refIssue.number,
                body: data.body
            });
        } catch(err) {
            console.log(err);
            return false;
        }

        // Comment on the Epic?
        if (data.comment) {
            try {
                await octokit.issues.createComment({
                    ...context.repo,
                    issue_number: refIssue.number,
                    body: data.comment
                });
            } catch(err) {
                console.log(err);
            }
        }

        console.log("Updated Epic #" + refIssue.number + " with new information for task #" + taskIssue.number);
    }
}

// Update task within supplied body text from issue data given
function updateTaskInEpic(epicBody, workloadMarker, taskIssue) {
    var inWorkload = false
    var body = epicBody.split(/\r?\n/g);
    var newBody = "";
    var nBodyLines = body.length;
    for (var i = 0; i < nBodyLines; ++i) {
        // Check for heading, potentially indicating the start of the workload section
        if (body[i].startsWith("#")) {
            if (body[i].endsWith(workloadMarker)) {
                inWorkload = true;
                continue;
            }
            else if (inWorkload)
                return null;
        }

        // If we are not in the workload section, no need to do anything else
        if (!inWorkload)
            continue;

        // Does the line start with checkbox markdown indicating a task?
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
        var updateTitle = false;
        var updateState = false;
        const taskIssueClosed = taskIssue.state === "closed" ? "x" : " ";
        if (match.groups.closed != taskIssueClosed)
            updateState = true;
        if (match.groups.title != taskIssue.title)
            updateTitle = true;

        // Return null if no updates were necessary
        if (!updateTitle && !updateState)
            return null;

        // Reconstitute the line, create a suitable comment, and return the new data
        body[i] = match.groups.pre + "- [" + taskIssueClosed + "] #" + taskIssue.number + " " + taskIssue.title;

        var comment = null;
        if (updateState && updateTitle)
            comment = "`EpicBot` refreshed the title for task #" + taskIssue.number + " and marked it as `" + (taskIssueClosed ? "closed" : "open") + "`.";
        else if (updateState)
            comment = "`EpicBot` marked task #" + taskIssue.number + " as `" + (taskIssueClosed ? "closed" : "open") + "`.";
        else if (updateTitle)
            comment = "`EpicBot` refreshed the title for task #" + taskIssue.number + ".";

        // Reconstitute and return updated body text
        return {
            body: body.join("\r\n"),
            comment: comment
        }
    }

    return null;
}

// Run the action
run()

