# Demo script

One recording, about fifteen minutes, two parts: everything works, then things go wrong on purpose. If it runs long, the Growth run (section 3) and the escalation queue (section 11) can be trimmed. The accounts:

- **CS inbox:** akshayprasanna11@gmail.com (the app watches this)
- **AE:** akshayprasannav@gmail.com (sends the deal emails, gets the phone call)

Every email has to be sent from the AE address, and the subject has to contain "deal closed", or the inbox script ignores it.

## Before you hit record

- [ ] It's a weekday. Rocketlane skips weekends, and on a Saturday the first tasks get dated in the past.
- [ ] Bolna balance checked. The full run below uses roughly 8 to 10 minutes of talk time.
- [ ] In Vercel, set `CALL_RETRY_DELAY_SECONDS=20` and `MAX_CALL_ATTEMPTS=2`, redeploy, and wait for Ready. The defaults wait 15 minutes between attempts, which is too slow for a video.
- [ ] Health check says ok: `set -a; source .env.local; set +a; curl -s -H "x-bridge-secret: $GMAIL_BRIDGE_SECRET" https://rocketlane-8wnj.vercel.app/api/health`
- [ ] `pnpm demo:reset --yes` so the dashboard starts empty.
- [ ] Rocketlane has no leftover test projects. Keep the "[Sample] Acme" project, the duplicate demo needs it.
- [ ] Apps Script **Executions** shows recent green runs.
- [ ] Phone volume up, and nothing else open that will ring.
- [ ] Tabs ready: dashboard (signed in), Rocketlane projects, the AE's Gmail, the CS Gmail, Rocketlane Automations, a terminal in the repo.

## Part 1: it works

### 1. Open (about 1 minute)

Show the README diagram. Say, in your own words:

- NovaCRM onboards by hand today, and the plan tier isn't in the deal email.
- An LLM reads the email, code checks it, a voice agent confirms the plan with the AE, and only then does a project get made.
- Everything is real except Slack.

### 2. Enterprise deal (about 3 minutes)

Send this from the AE address:

> **Subject:** Deal closed: Brightwave Analytics
>
> Hi CS team,
>
> Great news, a new deal just closed!
>
> Customer: Brightwave Analytics
> Contact name: Meera Iyer
> Contact email: meera.iyer@brightwaveanalytics.com
> Opportunity: https://novacrm.lightning.force.com/lightning/r/Opportunity/006Ux000003Br1g/view
> AE: Akshay
>
> Thanks!

Watch, in this order:

1. The deal appears on the dashboard within a minute. Open it and let the steps fill in.
2. The phone rings. Answer, say "Enterprise" when asked, then "yes" when it reads it back.
3. The deal moves to project created. Open Rocketlane: the project from the Enterprise template, 15 tasks, the final "Customer data verified — evidence attached" task, the Project Manager filled in.
4. Back on the deal: the Slack channel, topic and welcome message (the Slack tab), then the completion email in the AE's inbox.
5. Open the audit trail on the call step and show the transcript and the reason the tier was accepted.

Say: the email doesn't contain the plan, and the model has no field to put one in. The decision came from the AE's own words, checked by code.

### 3. Growth deal, if you have time (about 90 seconds)

Same email with a new customer and a new opportunity.

> Customer: Fernhill Logistics
> Contact: Rohan Das, rohan.das@fernhilllogistics.com
> Opportunity: .../Opportunity/006Ux000004Kd7Q/view

Say "Growth" on the call. Show the 14-day template and the "pooled CSM" wording in Slack. Two plans, two templates, no mix-up.

### 4. The overdue automation (about 1 minute)

In Rocketlane open **Automations** and show the two rules: one day overdue goes to the Project Manager, four days goes to the Project Owner. Then show a task you backdated beforehand and the notification it produced. If the notification hasn't shown up, say so; don't edit around it.

## Part 2: things go wrong

Say before you start: these are real failures against the real systems, not switches.

### 5. A missing field (about 1 minute)

Same email shape, with the contact email line removed.

> Customer: Kestrel Foods
> Opportunity: .../Opportunity/006Ux000005Lm2R/view

Show: no call, no project. The deal shows "Waiting on the AE". Open the AE's inbox for the note that names the missing field and asks for the whole email again. Open the audit step to show it says why.

### 6. The same deal twice (about 1 minute)

Send the Brightwave email again, unchanged apart from the subject (add "(resend)").

Show: it's stopped before anyone is called, and the escalation says that opportunity is already being handled.

### 7. The AE doesn't answer (about 2 minutes)

> Customer: Ironbridge Labs
> Opportunity: .../Opportunity/006Ux000006Pn9S/view

Let it ring out, or decline, on both attempts. Show the retry in the audit trail and the escalation that follows. Say: after the last attempt it hands over to a person rather than assuming a plan.

### 8. An unclear answer (about 2 minutes)

> Customer: Summit Dental Group
> Opportunity: .../Opportunity/006Ux000007Qt4T/view

Answer with "Hmm, probably Growth, I think, but I'm not sure." on both calls. Show that nothing was created, that the transcript is in the audit trail, and that it ended in the queue. The point is that a hedge is not a yes.

### 9. A customer that already has a project (about 90 seconds)

> Customer: Acme
> Opportunity: .../Opportunity/006Ux000008Rv5W/view

Confirm "Enterprise" on the call. Show the "Duplicate project" escalation naming the existing Acme project, and that nothing new was created in Rocketlane. This one comes after the call because the duplicate check happens just before creating the project.

### 10. Rocketlane down, wrong template (about 1 minute)

Don't break the live system for this. Run `pnpm test` in the terminal and point at the output: the tests where Rocketlane returns 500s, where it's rate limited, where it rejects the key, where it builds from the wrong template. Say these are exercised with injected failures, and that the wrong-template check runs on every real project too.

### 11. The escalation queue and the log (about 1 minute)

Open Escalations: three or four rows, each with a reason. Resolve one. Click **Export audit log** and open the file.

## Close (about 1 minute)

Say what would change in production:

- Slack is simulated here. In production it's the Slack API plus a Slack Connect invite for the customer.
- Gmail is polled once a minute by a script. In production it's Gmail push.
- Bolna doesn't sign its webhooks, so I use a secret URL and IP list and fetch the result myself.
- The AE directory would come from the CRM, and the dashboard would sit behind SSO.

## If something goes wrong while recording

- **Nothing shows up after two minutes.** Check the Apps Script Executions, then the health URL above. A missing environment variable shows up there by name.
- **The call doesn't come.** Check the Bolna balance and that your number is a verified one on the trial.
- **A deal is stuck.** `pnpm demo:status` prints where every deal is and what each step said.
- **Start over.** `pnpm demo:reset --yes`, then use new customer names and new opportunity IDs. A reused ID is treated as a duplicate on purpose.

## Not tested yet

- Sending from a third address to show the unknown-sender block. The inbox script skips mail from the CS account itself, so it needs a different address. It's covered in the tests if you'd rather skip it.
- How fast Rocketlane sends the overdue notifications.
