const github = require("@actions/github");
const core = require("@actions/core");

// Get configuration variables
const secretToken = core.getInput("secret-token");
const epicPrefix = core.getInput("epic-prefix");
const workloadMarker = core.getInput("workload-marker");
const closeCompletedEpics = core.getInput("close-completed-epics");

// Constants
const taskExpression = /(?<pre> *)- \[(?<closed>.)\] #(?<number>[0-9]+) *(?<title>.*)/;

// Construct Octokit object and get GitHub context
const octokit = new github.getOctokit(secretToken);
const context = github.context;

// Main function
async function run() {
    // Safety check - only act on issues
    var sourceIssue = context.payload.issue;
    if (!sourceIssue)
        return;

    // Print config
    console.log("Config:")
    console.log("  - epicPrefix = " + epicPrefix);
    console.log("  - workloadMarker = " + workloadMarker);
    console.log("  - closeCompletedEpics = " + closeCompletedEpics);

    // Check config
    if (epicPrefix === "") {
        core.setFailed("Epic prefix cannot be an empty string.");
        return;
    }
    if (workloadMarker === "") {
        core.setFailed("Workload marker cannot be an empty string.");
        return;
    }

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
            result = await updateEpicIssue(sourceIssue);
        } catch(err) {
            core.setFailed(err);
            return;
        }
    }
    else {
        try {
            result = await updateEpicFromTask(sourceIssue);
        } catch(err) {
            core.setFailed(err);
            return;
        }
    }

    console.log(result);
}

// Update Epic issue
async function updateEpicIssue(epicIssue) {
    console.log("Updating Epic issue #" + epicIssue.number + " (" + epicIssue.title + ")...");

    /*
     * Issues forming the workload for this Epic are expected to be in a section
     * of the main issue body called 'Workload', as indicated by a markdown
     * heading ('#', '##', etc.).
     */

    // Split the Epic body into individual lines
    var inWorkload = false
    var body = epicIssue.body.split(/\r?\n/g);
    var nBodyLines = body.length;
    for (var i = 0; i < nBodyLines; ++i) {
        // Check for heading, potentially indicating the start of the workload section
        if (body[i].startsWith("#")) {
            if (body[i].endsWith(workloadMarker)) {
                inWorkload = true;
                continue;
            }
            else if (inWorkload)
                break;
        }

        // If we are not in the workload section, no need to do anything else
        if (!inWorkload)
            continue;

        // Does the line start with checkbox markdown indicating a task?
        let match = taskExpression.exec(body[i]);
        if (match == null)
            continue;
        console.log(match.groups);

        // Retrieve task issue
        var taskIssue = null;
        try {
            taskIssue = await octokit.issues.get({
                ...context.repo,
                issue_number: parseInt(match.groups.number)
            });
        } catch(err) {
            core.setFailed(err);
            return false;
        }

        // Did we find the issue?
        if (taskIssue.number != match.groups.number) {
            core.setFailed("Error - task #" + match.groups.number + " reference in Epic #" + epicIssue.number + " but it doesn't exist.");
            return false;
        }

        // Update the Epic issue body based on the task issue data if it needs it
        var data = updateTask(body[i], taskIssue);
        if (!data) {
            console.log("Nothing to update for task #" + taskIssue.number);
            continue;
        }

        // Store the updated line te
        body[i] = data.line;

        // Comment on the Epic?
        if (data.comment) {
            try {
                await octokit.issues.createComment({
                    ...context.repo,
                    issue_number: epicIssue.number,
                    body: data.comment
                });
            } catch(err) {
                core.setFailed(err);
                return false;
            }
        }

        console.log("Updated Epic #" + epicIssue.number + " with new information for task #" + taskIssue.number);
    }

    return false;
}

// Update Task issue within Epic
async function updateEpicFromTask(taskIssue) {
    console.log("Searching issue #" + taskIssue.number + " (" + taskIssue.title + ") for Epic cross-references...");

    /*
     * Normal issues may or may not be associated to an Epic. If they are not,
     * there is nothing more to do. If they are, then we must update the Epic
     * accordingly.
     *
     * The task may be present in more than one Epic, so consider all referenced
     * issues.
     */
    var timeline = null;
    try {
        timeline = await octokit.issues.listEventsForTimeline({
            ...context.repo,
            issue_number: taskIssue.number
        });
    } catch(err) {
        core.setFailed(err);
        return false;
    }

    // Look for 'cross-referenced' events, and check if those relate to Epics
    for (event of timeline.data) {
        if (event.event != "cross-referenced")
            continue;

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
        var data = updateTaskInEpic(refIssue.body, taskIssue);
        if (!data) {
            console.log("Nothing to update - Epic #" + refIssue.number + " body remains as-is.");
            return false;
        }

        // Commit the updated Epic
        try {
            await octokit.issues.update({
                ...context.repo,
                issue_number: refIssue.number,
                body: data.body
            });
        } catch(err) {
            core.setFailed(err);
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
                core.setFailed(err);
                return false;
            }
        }

        console.log("Updated Epic #" + refIssue.number + " with new information for task #" + taskIssue.number);

        // Close the Epic if all tasks are completed?
        if (closeCompletedEpics) {
            console.log("Checking for completed Epic...");
            if (allEpicTasksCompleted(data.body) === true) {
                try {
                    await octokit.issues.update({
                        ...context.repo,
                        issue_number: refIssue.number,
                        state: "closed"
                    });
                } catch(err) {
                    core.setFailed(err);
                    return false;
                }
            }
        }
    }

    return true;
}

// Update task within supplied body text from issue data given
function updateTaskInEpic(epicBody, taskIssue) {
    var inWorkload = false
    var body = epicBody.split(/\r?\n/g);
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
        var match = taskExpression.exec(body[i]);
        if (!match)
            continue;

        // Does the taskIssue number match the one on this line?
        if (match.groups.number != taskIssue.number)
            continue;

        // Found the taskIssue in the list, so update as necessary
        var data = updateTask(body[i], taskIssue);
        if (!data)
            return null;

        // Reconstitute and return updated body text
        body[i] = data.line;
        return {
            body: body.join("\r\n"),
            comment: data.comment
        }
    }

    return null;
}

// Update task data, returning new line and comment if changes were made, or null if it was up to date
function updateTask(taskLine, taskIssue) {
    // Ensure that we're working with a task line
    var match = taskExpression.exec(taskLine);
    if (!match) {
        console.log("...updateTask() - Not a task line? (\""+taskLine+"\")");
        return null;
    }

    // Does the taskIssue number match the one on this line?
    if (match.groups.number != taskIssue.number) {
        console.log("...updateTask() - Issue numbers don't match (" + match.groups.number + " vs. " + taskIssue.number + ")");
        return null;
    }

    // Check task status and title and update as necessary
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
    var newLine = match.groups.pre + "- [" + taskIssueClosed + "] #" + taskIssue.number + " " + taskIssue.title;

    var comment = null;
    if (updateState && updateTitle)
        comment = "`EpicBot` refreshed the title for task #" + taskIssue.number + " and marked it as `" + (taskIssueClosed === "x" ? "closed" : "open") + "`.";
    else if (updateState)
        comment = "`EpicBot` marked task #" + taskIssue.number + " as `" + (taskIssueClosed === "x" ? "closed" : "open") + "`.";
    else if (updateTitle)
        comment = "`EpicBot` refreshed the title for task #" + taskIssue.number + ".";

    return {
        line: newLine,
        comment: comment
    }
}

// Return whether all tasks in the supplied Epic are complete
function allEpicTasksCompleted(epicBody) {
    var inWorkload = false
    var body = epicBody.split(/\r?\n/g);
    for (line of body) {
        // Check for heading, potentially indicating the start of the workload section
        if (line.startsWith("#")) {
            if (line.endsWith(workloadMarker)) {
                inWorkload = true;
                continue;
            }
            else if (inWorkload)
                return true;
        }

        // If we are not in the workload section, continue
        if (!inWorkload)
            continue;

        // Does the line start with checkbox markdown indicating a task?
        let match = taskExpression.exec(line);
        if (match == null)
            continue;

        // If the task is not complete, return false immediately
        if (match.groups.closed != "x")
            return false;
    }

    return true;
}

// Run the action
run()
