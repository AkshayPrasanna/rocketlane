# Gmail setup (Apps Script bridge)

A small Google Apps Script runs inside the **CS inbox** account once a minute. It hands new deal emails to the app and sends the replies the app queues. There is no Google Cloud project, no OAuth client and no tokens to expire. Setup takes about 10 minutes.

| Role | Account |
| --- | --- |
| CS inbox | the Gmail account that receives deal emails. **The script is created and runs here.** |
| AE sender | the other Gmail account you send test deal emails from. It needs no setup. Its address is `AE_DEMO_EMAIL`. |

**How it works**

```
AE account ──email──▶ CS inbox ──(Apps Script, every minute)──▶ POST /api/gmail/ingest
                         ▲                                              │ claims the email once,
                         │                                              ▼ starts a durable workflow
                         └──(same script run)── GET /api/gmail/outbox ◀── clarification and
                              sends each reply in the AE's thread          completion replies
```

- The script only reads mail that matches its search (the inbox, last 2 days, subject contains "deal closed", not sent by the CS account, not already labelled `novacrm-processed`).
- It labels a thread `novacrm-processed` only after the app accepted it, so a failure is retried on the next run.
- It only ever replies to the sender of the AE email it is answering.
- Each email is claimed once by its Gmail message ID, so a retry or an overlapping run can never start a second call, project or channel.

## Part 1: the app

1. In `.env.local` (already done if you used the setup I prepared) and in **Vercel → Settings → Environment Variables**, set:

   | Variable | Value |
   | --- | --- |
   | `GMAIL_MODE` | `live` |
   | `GMAIL_BRIDGE_SECRET` | a long random string (16+ characters), for example `openssl rand -hex 24` |
   | `AE_DEMO_EMAIL`, `AE_DEMO_NAME`, `AE_DEMO_PHONE` | the AE sender account, its display name and phone |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `AI_GATEWAY_API_KEY` | from Vercel AI Gateway (needs a card on file) |

2. Redeploy so the new variables take effect.
3. If the deployment URL asks you to log in to Vercel when opened in a private window, Deployment Protection is on. Generate a **Protection Bypass for Automation** secret under *Settings → Deployment Protection* and keep it for step 6 ([Vercel docs](https://vercel.com/docs/deployment-protection)). A custom production domain does not need it.

## Part 2: the script (signed in as the CS inbox account)

1. Open <https://script.google.com> → **New project**. Name it `NovaCRM inbox bridge`.
2. Delete the placeholder code. Paste the whole of [apps-script/inbox-bridge.gs](apps-script/inbox-bridge.gs).
3. Click the **gear icon (Project Settings)** → **Script properties** → **Add script property**, once for each:

   | Property | Value |
   | --- | --- |
   | `APP_URL` | your deployment, for example `https://novacrm-onboarding.vercel.app` |
   | `BRIDGE_SECRET` | exactly the `GMAIL_BRIDGE_SECRET` you set in the app |
   | `VERCEL_BYPASS` | only if step 3 of part 1 applied: the bypass secret |

   Save the properties.
4. Back in the editor, pick **`check`** in the function dropdown and click **Run**. The first time, Google asks for permission:
   **Review permissions** → choose the CS account → *"Google hasn't verified this app"* → **Advanced** → **Go to NovaCRM inbox bridge (unsafe)** → **Allow**. (It is your own script. It asks to read and send Gmail, manage labels, and call an external URL.)

   Open **Execution log**. You should see `OK. Pending replies at the app: 0`. Anything else: see troubleshooting.
5. Pick **`install`** and **Run**. This creates the one-minute trigger. Open the **Triggers** page (clock icon on the left) and confirm `run` appears, time-driven, every minute.

## Part 3: test it

1. From the AE account, send the CS inbox an email with a subject containing `deal closed`, for example:

   > **Subject:** Deal closed: Acme Corp
   >
   > Hi CS team,
   > Great news, a new deal just closed!
   > Customer: Acme Corp
   > Contact name: Jane Doe
   > Contact email: jane.doe@acme.com
   > Opportunity: https://novacrm.lightning.force.com/lightning/r/Opportunity/006Ux000001AbCdIAK/view
   > AE: (your AE name)

2. Within about a minute the thread in the CS inbox gets the label **`novacrm-processed`**. That proves the app accepted it. The **Executions** page of the script shows each run, and Vercel's logs show `POST /api/gmail/ingest 200`.
3. To test the reply path, send one with a field missing (for example no contact email). The AE account receives a threaded reply listing what is missing, within about two minutes.

The exact test emails for the demo videos will be in `docs/demo-script.md`.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `check` fails with HTTP 401 | `BRIDGE_SECRET` in the script differs from `GMAIL_BRIDGE_SECRET` in the app, or the app was not redeployed after you set it. |
| HTTP 503 | The app has no `GMAIL_BRIDGE_SECRET` set. Endpoints refuse every request until it is. |
| HTTP 401 with a Vercel login page in the message | Deployment Protection is blocking the script. Add `VERCEL_BYPASS`, or use a custom domain. |
| `Set APP_URL and BRIDGE_SECRET…` | A script property is missing or misspelt (names are case sensitive). |
| Nothing happens to a test email | The subject must contain `deal closed`; the email must be under 2 days old, in the inbox, not sent by the CS account, and not already labelled `novacrm-processed` (remove the label to re-run it). Edit the `QUERY` script property to change the search. |
| The email is labelled but no deal appears | The app accepted it and the workflow then failed. Check the audit log and the escalation queue on the dashboard, and the Vercel logs. |
| Replies never arrive | The script only sends replies while its trigger runs. Check the Executions page for errors, and that the original AE message still exists. |
| Execution quota warnings | Apps Script allows 90 minutes of trigger runtime per day for consumer accounts. A run with nothing to do takes about a second or two. If you hit the limit, edit `install` to use `everyMinutes(5)`. |

## What this changes in production

This bridge exists because it needs no Google Cloud project and is quick to set up. In production the app would read Gmail through the **Gmail API**, either:

- **push**: `users.watch` publishes mailbox changes to a Cloud Pub/Sub topic, with a push subscription that calls an endpoint verifying Google's signed token (and a daily renewal, because a watch lasts 7 days) ([Gmail push docs](https://developers.google.com/workspace/gmail/api/guides/push)); or
- **polling**: `messages.list` on a schedule.

Only the trigger changes. Everything after `registerMessage` (idempotent claim, sender checks, parsing, validation, the call, project and channel) stays the same, as does the `GmailClient` interface, so the bridge client would be swapped for a Gmail API client.
