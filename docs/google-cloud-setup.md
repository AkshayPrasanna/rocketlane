# Google Cloud setup for Gmail push

This is the click-by-click path for the Gmail trigger. When you finish you will have six values for `.env.local` and Vercel, and Gmail will push every new email to the app within seconds.

**How the pieces fit**

```
CS inbox (Gmail) ──watch──▶ Pub/Sub topic ──push subscription──▶ https://<your-app>/api/gmail/push
                                 ▲                                    │ verifies Google's signed token
   Gmail publishes here          │                                    ▼
   (gmail-api-push@system…)      │                           history.list → new message IDs → workflow
                                 │
   A daily cron renews the watch (Gmail drops it after 7 days).  /api/gmail/poll is the fallback.
```

Time needed: about 40 minutes the first time. Stages 1 to 6 need nothing from the app. Stages 7 to 9 need the app deployed on Vercel.

> **Console screens change.** The names below match Google's current docs (Google Auth Platform with Branding, Audience, Data Access and Clients). If a screen looks different, use the search box at the top of the console and type the page name, or send me a screenshot.

## Before you start

- **Two Gmail accounts are simplest, but one works.** The *inbox account* is the CS inbox the app watches. The *AE sender* is where you send test deal emails from. They can be the same account (that is what `AE_DEMO_EMAIL` then holds).
- **Use the inbox account to sign in to Google Cloud.** Everything below stays in one project.
- **Have your Vercel production URL ready** (for example `https://novacrm-onboarding.vercel.app`) for stages 7 to 9.

---

## Stage 1: Create the project

1. Open <https://console.cloud.google.com> signed in as the inbox account. Accept the terms if asked.
2. Click the project picker at the top left, then **New project**.
3. Name it `novacrm-onboarding` and click **Create**. Select it in the picker once it is ready.
4. Open **Dashboard** (menu → *Cloud overview* → *Dashboard*) and copy two values into a scratch note:
   - **Project ID**, for example `novacrm-onboarding-123456`
   - **Project number**, for example `987654321012`

**Checkpoint:** the project name at the top of the page is `novacrm-onboarding`.

## Stage 2: Billing

Pub/Sub's free tier needs a billing account on the project. Google's docs say usage is free up to 10 GiB a month; this app will use a few kilobytes. I could not confirm that Pub/Sub refuses to work without billing, but the tutorials all assume it is on.

1. If the console prompts you to enable billing, follow it and add a card (a new account may get a free trial credit).
2. Optional safety net: **Billing → Budgets & alerts → Create budget**, set 1 USD, so you hear about any surprise.

## Stage 3: Enable the two APIs

Open each link, make sure the right project is selected, and click **Enable**:

- Gmail API: <https://console.cloud.google.com/apis/library/gmail.googleapis.com>
- Cloud Pub/Sub API: <https://console.cloud.google.com/apis/library/pubsub.googleapis.com>

**Checkpoint:** both pages now show **Manage** instead of **Enable**.

## Stage 4: OAuth consent screen

The app signs in to the inbox account once to get a refresh token. Google's consent screen controls how that works.

1. In the top search box type `Google Auth Platform` and open it. Click **Get started** if you see it.
2. **App information:** app name `NovaCRM Onboarding`, support email = the inbox account. **Next**.
3. **Audience:** choose **External**. **Next**.
4. **Contact information:** the inbox account email. **Next**, accept the policy, **Continue**, **Create**.
5. Left menu → **Data Access** → **Add or remove scopes**. In the box at the bottom ("Manually add scopes") paste these two, click **Add to table**, then **Update** and **Save**:

   ```
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/gmail.labels
   ```

   `gmail.modify` lets the app read mail, apply labels, send replies and set up the push watch. `gmail.labels` lets it create the "processed" label. Google classes `gmail.modify` as a *restricted* scope, which only affects the warning screen you will see in stage 6.
6. Left menu → **Audience** → **Publish app** → **Confirm**. The status must read **In production**.

   **Do not leave it on Testing.** In Testing, Google expires the refresh token after 7 days ([Google docs](https://developers.google.com/identity/protocols/oauth2)), so the demo would break mid-week. Publishing without verification is fine for one personal user; you will just see an "unverified app" warning once.

**Checkpoint:** Audience page shows *Publishing status: In production* and *User type: External*.

## Stage 5: Create the OAuth client

1. Left menu → **Clients** → **Create client**.
2. Application type **Web application**, name `onboarding-agent`.
3. Under **Authorized redirect URIs** click **Add URI** and enter exactly:

   ```
   https://developers.google.com/oauthplayground
   ```
4. **Create.** Copy the **Client ID** and **Client secret** now (the secret is shown in full only at creation; you can reveal it again later from the client's page).

Put them in `.env.local`:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

## Stage 6: Get the refresh token (OAuth Playground)

1. Open <https://developers.google.com/oauthplayground>.
2. Click the **gear icon** (top right). Tick **Use your own OAuth credentials**, paste the Client ID and secret. Leave *Access type* on **Offline**. Close the panel.
3. In **Step 1**, ignore the scope list. Paste both scopes into the **"Input your own scopes"** box at the bottom, separated by a space:

   ```
   https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.labels
   ```
   Click **Authorize APIs**.
4. Choose the **inbox account**. You will see *"Google hasn't verified this app"*. Click **Advanced** → **Go to NovaCRM Onboarding (unsafe)** → **Continue** and tick every permission box → **Continue**. (It is your own app, so this is expected.)
5. **Step 2:** click **Exchange authorization code for tokens**. Copy the **Refresh token**.

```
GOOGLE_REFRESH_TOKEN=1//0g...
```

This token gives full access to that inbox, so keep it only in `.env.local` and Vercel's environment variables. You can revoke it any time at <https://myaccount.google.com/permissions>.

**Checkpoint (test the credentials):** run this in the project folder. It should print the inbox address.

```bash
set -a; source .env.local; set +a
ACCESS=$(curl -s https://oauth2.googleapis.com/token \
  -d client_id="$GOOGLE_CLIENT_ID" -d client_secret="$GOOGLE_CLIENT_SECRET" \
  -d refresh_token="$GOOGLE_REFRESH_TOKEN" -d grant_type=refresh_token \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
curl -s -H "Authorization: Bearer $ACCESS" https://gmail.googleapis.com/gmail/v1/users/me/profile
```

Expected: `{"emailAddress":"...","messagesTotal":...,"historyId":"..."}`. If you get `invalid_grant`, redo stage 6 (see troubleshooting).

---

## Stage 7: Pub/Sub topic and Gmail's permission to publish

1. Search `Pub/Sub` → **Topics** → **Create topic**.
2. Topic ID `gmail-push`. **Untick "Add a default subscription"** (we create our own in stage 9). **Create.**
3. Copy the full name from the topic page, in the form `projects/<PROJECT_ID>/topics/gmail-push`:

   ```
   GMAIL_PUBSUB_TOPIC=projects/<PROJECT_ID>/topics/gmail-push
   ```
4. Still on the topic page, open the **Permissions** tab (or the **Info panel** at the right) → **Add principal**.
   - New principal: `gmail-api-push@system.gserviceaccount.com`
   - Role: **Pub/Sub Publisher**
   - **Save.**

   This is the account Gmail uses to publish to your topic ([Gmail push docs](https://developers.google.com/workspace/gmail/api/guides/push)). If your Google account belongs to a company organisation that blocks outside principals ("domain restricted sharing"), the docs describe an exception for this one account.

**Checkpoint:** the topic's Permissions list shows `gmail-api-push@system.gserviceaccount.com` with *Pub/Sub Publisher*.

## Stage 8: A service account so Pub/Sub can sign its requests

The app must only accept pushes that really come from your subscription. Pub/Sub proves this by attaching a Google-signed token for a service account you choose.

1. Search `Service Accounts` (under *IAM & Admin*) → **Create service account**.
2. Name `gmail-push-invoker`. Skip the optional role and access steps. **Done.**
3. Copy its email:

   ```
   GMAIL_PUSH_SERVICE_ACCOUNT=gmail-push-invoker@<PROJECT_ID>.iam.gserviceaccount.com
   GMAIL_PUSH_AUDIENCE=novacrm-gmail-push
   ```
   (The audience is just a label you pick. Google's docs do not state a default, so we set one explicitly and the app checks it.)
4. Let Pub/Sub create tokens for it. Search `IAM` → **Grant access**:
   - New principal: `service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com` (use the project number from stage 1)
   - Role: **Service Account Token Creator**
   - **Save.**

   ([Pub/Sub authentication docs](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)). If the console does not accept the principal, tick *Include Google-provided role grants* in the IAM list to confirm the Pub/Sub service agent exists, or tell me and I'll give you the one-line `gcloud` command.

## Stage 9: The push subscription (after the app is deployed)

Do this once `https://<your-app>/api/gmail/push` exists (I'll tell you when Milestone 5 ships it). Creating it earlier only produces retry noise.

1. **Pub/Sub → Subscriptions → Create subscription.**
2. Subscription ID `gmail-push-sub`. Topic: `gmail-push`.
3. **Delivery type: Push.**
4. **Endpoint URL:**
   - With a custom production domain: `https://<your-domain>/api/gmail/push`
   - Without one: `https://<your-app>.vercel.app/api/gmail/push?x-vercel-protection-bypass=<SECRET>`. Vercel's Standard Protection blocks auto-generated URLs for callers that cannot log in, and Pub/Sub cannot add headers, so the bypass secret goes in the URL ([Vercel docs](https://vercel.com/docs/deployment-protection)). Generate it in *Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation*.
5. Tick **Enable authentication**. Service account: `gmail-push-invoker`. **Audience:** `novacrm-gmail-push`.
6. **Expiration period: Never expire.** (The default deletes an idle subscription after 31 days.)
7. **Retry policy: Retry after exponential backoff delay.** Leave the acknowledgement deadline at its default.
8. **Create.**

## Stage 10: Start the watch (app does this)

Nothing to click in the console. After Milestone 5 deploys I will give you one authenticated URL to open. It calls Gmail's `users.watch` with your topic and the `INBOX` label, stores the starting `historyId`, and a daily cron renews it (Gmail requires a renewal at least every 7 days; the Vercel Hobby daily cron is enough).

## Stage 11: End-to-end test

1. Send a deal email from the AE sender to the inbox account.
2. In **Pub/Sub → Subscriptions → gmail-push-sub → Metrics**, "Unacked messages" should stay at 0 (a growing number means the endpoint is returning errors).
3. In **Vercel → Logs**, you should see `POST /api/gmail/push 200` within a few seconds, then the deal appear on the dashboard.

---

## Values to hand over

| Variable | Comes from |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Stage 5 |
| `GOOGLE_REFRESH_TOKEN` | Stage 6 |
| `GMAIL_PUBSUB_TOPIC` | Stage 7 |
| `GMAIL_PUSH_SERVICE_ACCOUNT`, `GMAIL_PUSH_AUDIENCE` | Stage 8 |

Put them in `.env.local` and in Vercel's environment variables. Never in `.env.example`.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Playground says `redirect_uri_mismatch` | The redirect URI in stage 5 must be exactly `https://developers.google.com/oauthplayground` with no trailing slash. |
| `Error 403: access_denied` when authorising | The app is still in **Testing** and your account is not a test user. Publish it (stage 4, step 6). |
| No refresh token appears in Step 2 | Google only issues one on the first consent. Revoke the app at <https://myaccount.google.com/permissions> and repeat stage 6 with *Access type: Offline*. |
| `invalid_grant` from the curl check | Token revoked, wrong client ID/secret, or the app was in Testing for more than 7 days. Redo stage 6. |
| `watch` fails with a topic or permission error | The topic must be in the **same project** as the OAuth client, and `gmail-api-push@system.gserviceaccount.com` must have *Pub/Sub Publisher* on it (stage 7). |
| Push requests return 401 | Audience or service account in the subscription does not match `GMAIL_PUSH_AUDIENCE` / `GMAIL_PUSH_SERVICE_ACCOUNT`, or Vercel is blocking the URL (add the bypass secret). |
| Unacked messages keep growing | The endpoint is not returning 200. Pub/Sub retries with backoff. Check Vercel logs. |
| Notifications stop after about a week | The watch expired. The daily cron renews it; check that it ran. |

## What I verified, and what I did not

Verified against Google's current docs: the `watch` request and its allowed scopes; the 7-day watch expiry; the one-notification-per-second limit per watched user; the push-auth token claims and the Token Creator role; the 7-day refresh-token expiry in Testing. Not verified: exact console menu wording (Google changes it often), and whether Pub/Sub strictly requires billing. Both are called out above.
