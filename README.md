# EpicBot

Bot for managing 'epic' issues, and associated workload issues. Superseded by GitHub's "Task Lists" - https://docs.github.com/en/issues/tracking-your-work-with-issues/about-task-lists.

## Overview

Born from a desire to have effective sprint planning entirely within GitHub for one of our projects (https://github.com/projectdissolve/dissolve) `EpicBot` was created to help create an automated relationship between low-level user stories (i.e. GitHub issues) and higher-level "Epics", which do not exist per-se in GitHub. `EpicBot` manages specific GitHub issues that masquerade as Epics (identifiable by a prefix on their title text) and reference a workload of user stories within them.

## Project Structure

Our project is organised entirely within GitHub as follows:

- `Version Milestones` : Define major / version markers for the software in GitHub milestones. Epics, or individual issues, are assigned to milestones as appropriate.
- `Epics` : Standard GitHub issues that masquerade as "Epics", collecting together related groups of issues (user stories).
- `User Stories` : Standard GitHub issues that detail specific problems or work to do on the code.
- `Sprints` : Short periods of effort defined as GitHub projects, referencing selected user stories to address during that period (*not* Epics).

As you can see, only standard GitHub resources are used. Collecting together user stories as Epics helps to create a mid-level overview of necessary work, but this necessitates referencing other issues as the workload. `EpicBot` helps to create the missing automation link between our Epics and standard GitHub issues.

## Epics

As mentioned, an Epic in our language is just a standard GitHub issue that contains a list of other issues which form the workload for that Epic. An Epic's title is prefixed by some identifying text that marks it as an Epic, and allows `EpicBot` to recognise it as such.

### Epic Body

The body of an Epic issue can contain the usual Markdown content, describing the general focus of the work, and describing whatever elser needs describing. `EpicBot` searches for and works on any checklist items that it finds in a named section set by the user. Markdown headings are assumed to delimit sections.

Consider the following example Epic body text:

```
### Focus
Improve user guides, access to them, and additional training material.

### Tasks
*Critical*
- [ ] #8
- [ ] #10 

*Medium Priority*
- [ ] #9 

### Notes
- [ ] Check web server!
```

By default, `EpicBot` recognises an issue to be an Epic if its title begins with `Epic / `. If we use the above body text in a new issue named, for example, `Epic / Improve user accessibility`, `EpicBot` will recognise it and assume responsibility for updating the issue accordingly, resulting in:

![](example-epic.png)

`EpicBot` has ignored the first and last sections, and focussed only on the `Tasks` section. Within that, any lines containing checkbox Markdown (`- [ ]`) followed by an issue reference (e.g. `#10`) were parsed by `EpicBot` and updated accordingly. Note that the titles of those issues have been appended to the respective lines. Also note that other formatting and text within the `Tasks` section is untouched by `EpicBot`. For transparency, `EpicBot` comments on the issue with the changes that it makes at all times.

## How Does EpicBot Work?

`EpicBot` must be used in a workflow (see below) and examines incoming / updated issues. The behaviour of `EpicBot` depends in whether the triggering issue is recognised as an Epic.

### If the Triggering Issue is an Epic

If the issue is recognised as being an Epic (i.e. its title starts with the user-defined `epic-prefix` value - see *Configuration* below) then the body of the Epic is parsed for lines containing checkbox Markdown and issue references. Those issues are then retrieved so that the title can be appended to the line in the Epic, and the status of the issue can be set according to the checkbox state in the Epic.  In this case, then, the Epic issue acts as the source of truth for the state of the issue - ticking off an issue in the Epic will close that issue.

### If the Triggering Issue is a Normal Issue

If the issue is not an Epic, and is simply a normal issue, `EpicBot` retrieves the events timeline for the issue to see if it is referenced by any Epics (when the issue is entered in to the `Tasks` list in the Epic, a timeline event is added to the issue which links it to the Epic issue that referenced it). Again, the issue title in the referencing Epic is checked for consistency and updated if necessary, as is the related checkbox state. In this case, the issue acts as the source of truth for the checkbox state - closing a normal issue that is referenced by an Epic will check that issue off in the task list.

### Closing Epics

If, after updating the Epic following changes in either the Epic itself or a referenced issue, if all tasks within the Epic are completed the Epic is automatically closed. This behaviour can be controlled with the `close-completed-epics` option.

## Usage

You can use `EpicBot` in a standard GitHub Actions workflow. Since it needs to work on issues it needs to consume the `opened`, `closed`, `reopened`, and `edited` issue triggers. As `EpicBot` actively changes content in issues, it requires the relevant permissions - the standard `GITHUB_TOKEN` secret is sufficient, and which must be provided as the `secret-token` option.

### Example Workflow File

```
name: EpicBot

on:
  issues:
    types: [opened, closed, reopened, edited]

jobs:
  manage_epics:
    runs-on: ubuntu-latest
    name: Manage Epics
    steps:
      - name: Manage Epics
        uses: projectdissolve/epicbot@v1
        with:
          epic-prefix: "Epic /"
          workload-marker: "Tasks"
          close-completed-epics: true
          secret-token: "${{ secrets.GITHUB_TOKEN }}"
```

### Configuration

| Option | Type | Default | Description |
|:------:|:----:|:-------:| ----------- |
| close-completed-epics | bool | true | Automatically close Epic issues when all tasks are completed |
| epic-prefix | string | "Epic /" | String used as a prefix in the title of any Epic issue, allowing `EpicBot` to recognise it |
| secret-token | string | none | Permissions token |
| tasks-marker | string | "Tasks" | Heading text that identifies the section containing a checkbox list of issues |
