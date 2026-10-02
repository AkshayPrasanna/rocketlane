# Gmail setup (polling)

The app watches the CS inbox by **polling the Gmail API every minute**. There is no Pub/Sub, no billing account and no watch to renew. Setup takes about 15 minutes.

**The two accounts**

| Role | Account | What it does |
| --- | --- | --- |
| CS inbox | the Gmail account you chose as the CS inbox | The inbox the app reads. You sign in to Google Cloud as this account and authorise the app with it. |
| AE sender | your second Gmail account | Sends the test deal emails. Set as `AE_DEMO_EMAIL`. It needs no Google Cloud setup at all. |

**How it works**

```
cron-job.org (every minute) ──▶ POST https://<your-app>/api/gmail/poll   (x-poll-secret header)
                                      │ Gmail API: list unprocessed deal emails, claim each once
                                      ▼
                         start one durable workflow per new email
```

A claim stored in Redis makes processing idempotent, so overlapping polls or retries can never start a second call, project or channel for the same email.

> **Console screens change.** The names below match Google's current docs (Google Auth Platform with Branding, Audience, Data Access and Clients). If a screen looks different, use the search box at the top of the console and type the page name, or send me a screenshot.

---

## Stage 1: Create the project

1. Open <https://console.cloud.google.com> signed in as the **CS inbox account**. Accept the terms if asked.
2. Project picker (top left) → **New project**. Name it `novacrm-onboarding` → **Create**, then select it.

No billing is needed. The Gmail API is free.

## Stage 2: Enable the Gmail API

Open <https://console.cloud.google.com/apis/library/gmail.googleapis.com>, check the project name at the top, and click **Enable**.

**Checkpoint:** the page now shows **Manage**.

## Stage 3: OAuth consent screen

1. Top search box: `Google Auth Platform` → open it → **Get started**.
2. **App information:** name `NovaCRM Onboarding`, support email = the CS inbox address. **Next**.
3. **Audience:** **External**. **Next**.
4. **Contact information:** the same address. **Next** → tick the policy box → **Continue** → **Create**.
5. Left menu → **Data Access** → **Add or remove scopes**. In the box at the bottom ("Manually add scopes") paste both lines, click **Add to table**, then **Update** and **Save**:

   ```
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/gmail.labels
   ```

   `gmail.modify` lets the app read mail, apply the "processed" label and send replies. `gmail.labels` lets it create that label.
6. Left menu → **Audience** → **Publish app** → **Confirm**. The status must read **In production**.

   **Do not leave it on Testing.** In Testing, Google expires the refresh token after 7 days ([Google docs](https://developers.google.com/identity/protocols/oauth2)), which would break the demo. Publishing without verification is fine for one personal account. You will see an "unverified app" warning once.

**Checkpoint:** the Audience page shows *Publishing status: In production*.

## Stage 4: Create the OAuth client

1. Left menu → **Clients** → **Create client**.
2. Application type **Web application**, name `onboarding-agent`.
3. **Authorized redirect URIs** → **Add URI**, exactly:

   ```
   https://developers.google.com/oauthplayground
   ```
4. **Create.** Copy the **Client ID** and **Client secret** into `.env.local`:

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```

## Stage 5: Get the refresh token (OAuth Playground)

1. Open <https://developers.google.com/oauthplayground>.
2. Click the **gear icon** (top right). Tick **Use your own OAuth credentials**, paste the Client ID and secret. Leave *Access type* on **Offline**. Close the panel.
3. In **Step 1**, paste both scopes into the **"Input your own scopes"** box at the bottom, separated by a space, then click **Authorize APIs**:

   ```
   https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.labels
   ```
4. Choose the **CS inbox account**. When you see *"Google hasn't verified this app"*, click **Advanced** → **Go to NovaCRM Onboarding (unsafe)** → tick every permission box → **Continue**. (It is your own app, so this is expected.)
5. **Step 2:** click **Exchange authorization code for tokens**. Copy the **Refresh token** into `.env.local`:

   ```
   GOOGLE_REFRESH_TOKEN=1//0g...
   ```

This token gives full access to that inbox. Keep it only in `.env.local` and Vercel's environment variables. You can revoke it any time at <https://myaccount.google.com/permissions>.

## Stage 6: Test the credentials

Run this in the project folder. It should print the CS inbox address.

```bash
set -a; source .env.local; set +a
ACCESS=$(curl -s https://oauth2.googleapis.com/token \
  -d client_id="$GOOGLE_CLIENT_ID" -d client_secret="$GOOGLE_CLIENT_SECRET" \
  -d refresh_token="$GOOGLE_REFRESH_TOKEN" -d grant_type=refresh_token \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
curl -s -H "Authorization: Bearer $ACCESS" https://gmail.googleapis.com/gmail/v1/users/me/profile
```

Expected: `{"emailAddress":"<the CS inbox address>", ...}`. If you get `invalid_grant`, redo stage 5 (see troubleshooting).

## Stage 7: The once-a-minute pinger (after the app is deployed)

Vercel Hobby cron runs only once a day, so a free external service calls the poll endpoint every minute. Do this once the app is deployed and I have told you the poll endpoint is live.

1. Pick a long random secret and put it in `.env.local` **and** in Vercel's environment variables: `POLL_SECRET=<random string>` (for example the output of `openssl rand -hex 24`).
2. Sign up at <https://cron-job.org> (free) → **Create cronjob**.
3. **URL:** `https://<your-app>/api/gmail/poll`. **Schedule:** every 1 minute.
4. Under **Advanced**, set the request method to **POST** and add the header `x-poll-secret` with your secret value. If the app uses an auto-generated `*.vercel.app` URL, also add the header `x-vercel-protection-bypass` with the Protection Bypass secret from *Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation* ([Vercel docs](https://vercel.com/docs/deployment-protection)).
5. Save and enable. The job history in cron-job.org should show `200` responses.

A once-a-day Vercel cron also calls the same endpoint as a backup. A GitHub Actions schedule is not recommended: its minimum interval is 5 minutes and runs are often delayed.

## Stage 8: End-to-end test

1. From the **AE sender account**, send a deal email to the **CS inbox account** (exact test emails will be in `docs/demo-script.md`).
2. Within about a minute the deal appears on the dashboard and the voice call starts.

---

## Values to hand over

| Variable | Comes from |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Stage 4 |
| `GOOGLE_REFRESH_TOKEN` | Stage 5 |
| `POLL_SECRET` | Stage 7 (you invent it) |

Put them in `.env.local` and in Vercel's environment variables. Never in `.env.example`.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Playground says `redirect_uri_mismatch` | The redirect URI in stage 4 must be exactly `https://developers.google.com/oauthplayground`, no trailing slash. |
| `Error 403: access_denied` when authorising | The app is still in **Testing** and the account is not a test user. Publish it (stage 3, step 6). |
| No refresh token appears in Step 2 | Google only issues one on first consent. Revoke the app at <https://myaccount.google.com/permissions> and repeat stage 5 with *Access type: Offline*. |
| `invalid_grant` from the curl check | Token revoked, wrong client ID or secret, or the app sat in Testing for over 7 days. Redo stage 5. |
| Poll endpoint returns 401 | `POLL_SECRET` differs between the pinger header and the app, or Vercel is blocking the URL (add the bypass header). |
| Emails arrive but nothing starts | The email does not match `GMAIL_POLL_QUERY` (default: the inbox, last 2 days, subject containing "deal closed"), or it was already processed. |

---

## Appendix: upgrading to Pub/Sub push (not needed for the demo)

Polling costs up to a minute of latency and one cheap API call per poll. In production you would replace it with Gmail push notifications:

1. Enable the Cloud Pub/Sub API and a billing account (the free tier covers this app).
2. Create a topic and grant `gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on it ([Gmail push docs](https://developers.google.com/workspace/gmail/api/guides/push)).
3. Create a push subscription to an endpoint that verifies Google's signed token: issuer `https://accounts.google.com`, your chosen audience, and the subscription's service account. The Pub/Sub service agent needs the *Service Account Token Creator* role on that account ([Pub/Sub docs](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)).
4. Call `users.watch` (labelIds `INBOX`, your topic) and renew it at least every 7 days with a daily cron. Notifications carry only a `historyId`, which you pass to `history.list` to find the new messages.

Both paths feed the same idempotent `registerMessage` code, so switching changes only the trigger.
