# Rocketlane template spec

What to create in Rocketlane **before** switching `ROCKETLANE_MODE=live`. The app never builds
tasks itself. It creates a project **from a Rocketlane Project Template** and Rocketlane
generates the phases and tasks. So the template, not the code, is what makes a project
"Enterprise" or "Growth".

Rocketlane confirmed that templates must be Rocketlane Project Templates and that the roles can
be created in the account.

| | Enterprise | Growth |
| --- | --- | --- |
| Template name (exact) | `NovaCRM Enterprise Onboarding (30d)` | `NovaCRM Growth Onboarding (14d)` |
| Length | 30 days | 14 days |
| CSM role (placeholder) | `Dedicated CSM` | `Pooled CSM` |
| Phases | Kickoff, Data Migration, Configuration, Go-Live | same four |
| Tasks | 15 | 15 (same names, compressed dates) |

The names must match exactly. After creating a project the app reads back the template name
Rocketlane reports and escalates to a human if it is not the one it asked for.

## 1. Create the roles first

Admin or super user → profile icon → **Settings** → **Roles and Placeholders** → **New role+**.
For each row: set the type to **team member**, enter the name, tick **Use as placeholder**,
**Save**.

| Role name | Used by |
| --- | --- |
| `Project Manager` | both templates; also the first recipient of overdue alerts |
| `Dedicated CSM` | Enterprise template only |
| `Pooled CSM` | Growth template only |

`Project Owner` is not a role: it is Rocketlane's built-in project owner field, which the app
sets from `ROCKETLANE_OWNER_EMAIL` on every project.

## 2. Create the templates

Nothing here exists yet. The phases and tasks are not built in, and the tasks inside Rocketlane's
sample projects are unrelated. You create all of them, inside each template.

Where to look (from Rocketlane's help article on project templates; I have not seen your
screen):

1. Left navigation → **Templates** → **New project template**. Make sure it is a *project*
   template, not a *task* template.
2. Name it exactly as in the table above. The template editor opens with three sections:
   **Project**, **Spaces** and **Allocations**.
3. Phases and tasks live only in the **Project** section → **List view**. They are not under
   Spaces or Allocations.
4. **Add New phase** with a name, **start-on** and **duration**, then **Add new task** under it
   with its own start-on, duration and assignee. In Rocketlane, start-on `1d` is the first day
   of the project.
5. Save each section before moving to the next.

If you are inside a project's plan page rather than a template, you are in the wrong place:
that edits one customer's project, not the template.

Use the same 15 tasks in both templates. Only the dates and the CSM role differ. The assignee is
the role placeholder: `PM` = `Project Manager`, `CSM` = `Dedicated CSM` in the Enterprise
template and `Pooled CSM` in the Growth template.

### Phases

| Phase | Enterprise (start-on / duration) | Growth (start-on / duration) |
| --- | --- | --- |
| Kickoff | 1d / 4d (days 1-4) | 1d / 2d (days 1-2) |
| Data Migration | 5d / 11d (days 5-15) | 3d / 5d (days 3-7) |
| Configuration | 16d / 10d (days 16-25) | 8d / 4d (days 8-11) |
| Go-Live | 26d / 5d (days 26-30) | 12d / 3d (days 12-14) |

### Tasks

| # | Phase | Task | Assignee | Enterprise | Growth |
| --- | --- | --- | --- | --- | --- |
| 1 | Kickoff | Send welcome email and confirm stakeholders | CSM | 1d / 1d | 1d / 1d |
| 2 | Kickoff | Hold kickoff call | CSM | 2d / 1d | 2d / 1d |
| 3 | Kickoff | Agree success plan and timeline | PM | 3d / 2d | 2d / 1d |
| 4 | Data Migration | Collect customer data export and field mapping | CSM | 5d / 3d | 3d / 1d |
| 5 | Data Migration | Review data quality and remove duplicates | CSM | 8d / 3d | 4d / 1d |
| 6 | Data Migration | Run test import in sandbox | CSM | 11d / 2d | 5d / 1d |
| 7 | Data Migration | Run full production import | CSM | 13d / 2d | 6d / 1d |
| 8 | Data Migration | **Customer data verified — evidence attached** | CSM | 15d / 1d | 7d / 1d |
| 9 | Configuration | Configure users, roles and permissions | CSM | 16d / 3d | 8d / 1d |
| 10 | Configuration | Configure pipelines, fields and workflows | CSM | 19d / 4d | 8d / 2d |
| 11 | Configuration | Set up email and calendar integrations | CSM | 22d / 2d | 9d / 1d |
| 12 | Configuration | Admin training and user acceptance testing | PM | 24d / 2d | 10d / 2d |
| 13 | Go-Live | Go-live readiness review | PM | 26d / 2d | 12d / 1d |
| 14 | Go-Live | Go-live and hypercare | CSM | 28d / 2d | 13d / 1d |
| 15 | Go-Live | Handoff summary and transfer to support | CSM | 30d / 1d | 14d / 1d |

### The data-verification task (#8)

Priya's complaint was data-migration tasks marked done when the customer's data was never
checked. Task 8 is the control for that:

- Name it exactly `Customer data verified — evidence attached`.
- In its description write: "Do not mark done until the customer has confirmed their record
  counts and a spot-check, and the evidence (screenshot or signed-off count sheet) is attached
  to this task."
- Under **Dependencies**, make it depend on tasks 4, 5, 6 and 7, so it cannot start first.
- Make it the last task in the phase, and **Mark as milestone** (three-dot menu) so it shows on
  the project timeline.

Rocketlane's help pages do not describe a way to hard-block completion until a file is
attached, so this is a visible checkpoint, not an enforced one. I have not verified an
enforcement option in your account. If you see one (a required checklist item or required
attachment on the task), turn it on.

## 3. Hand back the template IDs

Open each template and copy the number from the browser address bar. I could not find
documentation saying where Rocketlane shows the ID in the app, so this is the expected place
and not a confirmed one. Send me the two numbers. I will create one throwaway project through
the API from each and check that Rocketlane's response names the template you intended. That
check proves the ID is the right template, whatever the UI shows.

```
ROCKETLANE_TEMPLATE_ID_ENTERPRISE=<number>
ROCKETLANE_TEMPLATE_ID_GROWTH=<number>
```

## 4. Dates

The app sends a start date (today in `ONBOARDING_TIMEZONE`) and a due date of start + 30 days
(Enterprise) or start + 14 days (Growth). The last task in each template ends one day inside
that due date, so the due date acts as a one-day buffer.

The phase windows above are my assumption: the brief only gives the 30-day and 14-day totals.
They live in [config/onboarding-plans.ts](../config/onboarding-plans.ts); change both places
together.
