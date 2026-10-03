# Part 1: Requirements and workflow analysis

NovaCRM customer onboarding. Akshay Prasanna.

## The short version

Every time NovaCRM closes a deal, someone in CS reads an email, builds a project, opens a Slack channel and hopes they picked the right template. That clerical work is where the mistakes come from: templates get mixed up and migration data goes unchecked. I want agents to do the clerical part, a phone call to fill the one gap in the data, and a person to handle anything the system can't settle on its own.

## How it works today

This is how I understood Priya's description.

1. A deal closes and the AE emails the CS inbox with the customer name and the Salesforce opportunity link.
2. Someone in CS creates a project in Asana from the standard template, about 15 tasks across four phases: Kickoff, Data Migration, Configuration and Go-Live.
3. They create a shared Slack channel with the customer and schedule the kickoff call.
4. Each phase has a checklist, and the team updates Asana as they go.
5. A task blocked for more than three days should be escalated.
6. At the end they write a handoff summary and move the customer to the support team.

There are two plans. Enterprise customers get a dedicated CSM and a 30-day onboarding. Growth customers get a pooled CSM and 14 days.

## Where it hurts

- The deal email doesn't say which plan the customer is on. Whoever picks the template is going from memory, and Priya says the templates do get mixed up.
- Data migration tasks get ticked off when the customer's data hasn't actually been checked. That has caused a few ugly escalations.
- The three-day escalation depends on somebody noticing, and mostly nobody does.
- Setting up the project and channel is manual, and it lands at the busiest moment, right after a deal closes.
- The handoff summary is written from scratch every time.

## What I'd build

Two agents and one automation inside Rocketlane.

**Intake and routing agent**

1. Watches the CS inbox for deal emails from AEs.
2. Reads the email with an LLM and pulls out the customer, the contact, the AE and the Salesforce link.
3. Checks every field against the email text. If something is missing it writes back to the AE and stops. It doesn't fill gaps.
4. Phones the AE and asks whether the customer is on Enterprise or Growth. Code reads the transcript and decides, not the model.
5. If nobody answers, or the answer is hedged, it tries again and then hands the deal to a person.
6. Creates the Rocketlane project from the matching template, then checks that Rocketlane really used that template.

**Communication agent.** Creates the Slack channel, named and described for the customer's plan, and posts a welcome message with the dates and the next step.

**Rocketlane automation.** This is a rule inside Rocketlane, not an agent. A task that is one day overdue notifies the Project Manager. At four days, the Project Owner is notified too.

The principle behind all of it: AI reads text and talks on the phone, code makes the decisions, and a person gets whatever the code can't be sure about.

| Problem | How it's handled |
| --- | --- |
| Templates mixed up | The plan comes from the AE's own spoken answer. A fixed table maps plan to template, and the project is checked afterwards. |
| Migration marked done without checking | Each template ends its migration phase with a task called "Customer data verified — evidence attached", which depends on the other migration tasks. |
| Escalations slip | The overdue automation. |
| Manual setup | The two agents. |

## Where people stay involved

Anything the system can't settle goes to an escalation queue, with the reason written down. That covers a plan that is still unclear after the allowed call attempts, a customer who already has a project, an email from someone who isn't a known AE, and Rocketlane being down. A missing field isn't an escalation. The AE gets a note asking for it.

Every step the agents take is logged with a time, what went in, what came out and why.

## What I'm leaving out

The handoff summary, scheduling the kickoff call, and moving off Asana, since the assignment uses Rocketlane. I'm also not trying to detect a "blocked" task, only an overdue one. Each of these would be a good next step.

## Assumptions

1. The AE is identified by the address the email comes from, and I have their phone number on file.
2. Deal emails carry the customer, a contact, the AE and the Salesforce link, in whatever layout the AE likes. The plan is never in them.
3. The Salesforce opportunity is the identity of a deal. A second email for the same opportunity is a duplicate, not a new deal.
4. If a project for that customer already exists in Rocketlane, a person decides what to do. The system doesn't create a second one.
5. "30-day" and "14-day" are the length of the Rocketlane templates, which Rocketlane counts in working days.
6. The brief doesn't say how those days split across the four phases, so I picked proportions. Enterprise is 4, 11, 10 and 5 days. Growth is 2, 5, 4 and 3.
7. Project Manager is a role I create in Rocketlane and fill on each project. Project Owner is Rocketlane's own owner field on the project.
8. Slack is simulated, as the brief allows.
9. The demo has one AE.

## What I asked Rocketlane

- I couldn't start a trial with a personal email address. Karthik created a sandbox for me.
- The templates should be Rocketlane project templates, so I built them there and the agent creates projects from them.
- The Project Manager and Project Owner roles can be created in Rocketlane.
- A simulated Slack channel is fine, as long as I explain what would change in production.

## What I'd ask Priya next

- Is "blocked for more than three days" the same thing as "overdue"? The assignment gives one and four days overdue.
- Who is the Project Manager and who is the Project Owner on a typical project?
- Who signs off that a customer's migrated data is correct, and what counts as evidence?
- Where do the AEs' phone numbers live, and are there hours when nobody should call them?
- If an AE can't be reached for a day, who should pick it up?
- Do customers join the Slack channel through Slack Connect or by email invite?
- What goes in the handoff summary?

## How I'll know it works

- A deal email turns into a project and a Slack channel within minutes of the AE's answer, with nobody touching it.
- No project is ever created without a confirmed plan, and none uses the wrong template. Any exception shows up in the log.
- Every action has a log entry.
- I can see how many deals needed a person, and why. If that number stays high, something upstream needs fixing, either the email format or the AE directory.
