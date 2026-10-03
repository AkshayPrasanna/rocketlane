# NovaCRM onboarding agents

This is my submission for Rocketlane's Forward Deployed Engineer assessment. NovaCRM's CS team onboards every new customer by hand: someone reads the deal email, builds a project, opens a Slack channel and hopes the right template got picked. This repo does that work with a small set of agents, and keeps a person in the loop wherever the data or the AE's answer isn't clear.

Dashboard: https://rocketlane-8wnj.vercel.app (password protected)

## What happens when a deal closes

1. An AE emails the CS inbox with the customer, a contact, their own name and the Salesforce link.
2. A small Apps Script in that inbox passes new deal emails to the app once a minute.
3. The app checks the sender is a known AE, then an LLM reads the email and pulls out the fields. The email never says which plan the customer bought.
4. Plain code checks every field. If something is missing or doesn't appear in the email, the AE gets a note asking for it and nothing else happens.
5. The app phones the AE (through Bolna) and asks whether the customer is on Enterprise or Growth. Code reads the transcript and decides. A hedged answer, a voicemail or no answer means another try, and after the last try it goes to a person. It never guesses.
6. Once the tier is confirmed, a Rocketlane project is created from the matching template: Enterprise is 30 days with a dedicated CSM, Growth is 14 days with a pooled one. The app reads back which template Rocketlane actually used and stops if it's the wrong one.
7. A Slack channel is created and named for the customer and plan, with a topic, a welcome message and the real project dates.
8. The AE gets a confirmation email. If the customer already has a project, or anything fails, the deal lands in an escalation queue instead.

Overdue tasks are handled by an automation inside Rocketlane, not by this code: one day overdue notifies the Project Manager, four days notifies the Project Owner. Rocketlane has no API for automations, so I set it up in the UI. The steps are in [docs/rocketlane-automation-setup.md](docs/rocketlane-automation-setup.md).

## What's real and what isn't

| | |
| --- | --- |
| Gmail | Real, polled by an Apps Script |
| Email parsing | Real LLM (Gemini 2.5 Flash through Vercel AI Gateway) |
| Phone call | Real, through Bolna |
| Rocketlane | Real sandbox, project templates and API |
| Slack | **Simulated.** The channel, topic, welcome message and invite are recorded in the app and shown on the dashboard. |
| Storage | Upstash Redis |
| Hosting | Vercel, with Vercel Workflow so a deal can wait on a phone call for minutes |

## Where to look

| Page | What it shows |
| --- | --- |
| Deals | Every deal and its state, updating live |
| A deal | The steps it went through, with the reason for each decision, and what was created |
| Escalations | Deals the agents stopped on, waiting for a person |
| Slack (simulated) | What would have been posted |
| Export audit log | The full log as JSONL |

## Running it yourself

You need Node 22 (see `.node-version`) and pnpm 10.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

You don't need any accounts to run the tests. Running it for real takes accounts at Upstash, Vercel (for the AI Gateway), Bolna and Rocketlane, plus the Gmail script. `.env.example` explains every variable. Each integration has a `*_MODE` setting that picks the live client or a test double, and everything defaults to the test doubles.

Setup guides, in the order I did them:

- [docs/gmail-setup.md](docs/gmail-setup.md): the inbox script
- [docs/bolna-agent-setup.md](docs/bolna-agent-setup.md): the voice agent (`pnpm bolna:setup` applies it)
- [docs/rocketlane-template-spec.md](docs/rocketlane-template-spec.md): the two templates and the roles
- [docs/rocketlane-automation-setup.md](docs/rocketlane-automation-setup.md): the overdue rules

| Command | What it does |
| --- | --- |
| `pnpm test` | Unit tests, then the workflow tests (about 25 seconds) |
| `pnpm test:live` | Checks against the real services. Read-only unless you opt in, see the notes in each file in `tests/live` |
| `pnpm check` and `pnpm typecheck` | Lint and types |
| `pnpm demo:status` | Prints every deal and its steps, straight from the store |
| `pnpm demo:reset` | Clears deals and the audit log. Dry run unless you add `--yes` |

## Tests

About 500 unit tests and a handful of workflow tests run in CI on every push. They cover the happy path, validation (missing customer, missing or malformed contact email, bad links), template accuracy, a Rocketlane outage, an existing project, an unanswered call, a voicemail, hedged answers, duplicate emails, and an email that tries to talk the system into a plan tier. The Rocketlane and Bolna clients are tested with a fake HTTP layer that returns the response shapes I saw from the real services, and one test replays a real Bolna call. Slack is tested against the simulator.

## How it's put together

[docs/architecture.md](docs/architecture.md) has the diagram, the split between what the LLM does and what code does, the guardrails, and what I'd change before running this for a real customer.

## Things to know

- Clarification isn't a conversation. If a field is missing the AE is asked to resend the whole email.
- The templates run on Rocketlane's working days, so "30 days" lands about six weeks out. The app reads the real dates back from Rocketlane and uses those.
- There is one AE in the directory, taken from environment variables.
- Bolna doesn't sign its webhooks. The app uses a secret in the URL and Bolna's published IP addresses, and then fetches the call result from Bolna directly instead of trusting the webhook body.
