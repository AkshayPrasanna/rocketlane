# Rocketlane overdue-task automation

The brief asks for this to live **inside Rocketlane**, not in our code. Rocketlane's public API
has no endpoint for automations, so the rules are created by hand in the UI. This is the one
step in the system that is manual.

| When a task becomes overdue by | Notify |
| --- | --- |
| 1 day | Project Manager |
| 4 days | Project Owner |

Do this after the roles and templates in
[rocketlane-template-spec.md](./rocketlane-template-spec.md): the rule for the Project Manager
needs that role to exist.

## What Rocketlane's own docs say

From the Rocketlane help center on automations:

- An automation has three parts: **Trigger**, **Condition**, **Action**.
- Task triggers can be set up "at the template level for projects that use specific templates,
  or globally for all tasks across projects".
- Their worked example reads: trigger "when any task is overdue", condition "exceeds 3 days",
  action "notify project owner".

The help pages I could read do not give the click path or the exact dropdown labels for the
recipient. The steps below use the wording from that example. **Treat the labels as
approximate** and match them to what you see on screen.

## Steps

1. Open **Automations** (look in the left navigation, or under **Settings**). For the whole
   account, choose the global scope. If you only see automations inside a template, make the
   same two rules in both templates.
2. **New automation**. Name it `Overdue 1 day → Project Manager`.
3. **Trigger**: the task trigger for an overdue task ("Task becomes overdue" / "when any task
   is overdue").
4. **Condition**: overdue duration exceeds **1 day**.
5. **Action**: notify the **Project Manager** role. If the action only lists people and
   "Project owner", look for a role or placeholder option. If there is none, tell me and we
   will use the fallback below.
6. Save and switch it **on**.
7. Repeat for `Overdue 4 days → Project Owner`: same trigger, condition **4 days**, action
   notify **Project owner**.

A task that stays overdue passes both thresholds, so on day 4 the Project Manager has already
been told once and the Project Owner is told for the first time.

## Check that it works

1. Open any project that was created from a template.
2. Set one task's due date to 2 days ago, then another to 5 days ago.
3. Confirm the Project Manager gets a notification for the first task (1 day), and the Project
   Owner for the second (4 days).

I have not run this, and I do not know how often Rocketlane evaluates the overdue condition,
so a notification may not arrive instantly. For the video, show the two saved rules, and show
the notification if it arrives. If it is delayed, say so on camera rather than editing it out.

## Who receives it

- **Project Owner** is Rocketlane's built-in owner field. The app sets it to
  `ROCKETLANE_OWNER_EMAIL` on every project.
- **Project Manager** is the role from the template spec. After creating a project the app
  assigns that placeholder to `ROCKETLANE_PM_EMAIL`, so the rule has a real person to notify.
  Use a different user from the owner so the two alerts are visibly different.

## If the UI differs

If Rocketlane has no way to notify a role, the fallback is to add the Project Manager as a team
member on every project and notify "Assignee" or "Team members" at 1 day. Send me a screenshot
of the Action dropdown and I will adjust this guide to what is really there.
