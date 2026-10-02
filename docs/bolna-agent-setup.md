# Bolna voice agent setup

The Intake agent confirms the plan tier by a real phone call through [Bolna](https://www.bolna.ai). This page covers the agent configuration, how the app talks to Bolna, and how to test it.

## What the call does

1. The app places a call to the AE's number from the AE directory (never a number from the email) with `POST /call`, passing `ae_name` and `customer_name` as `user_data`.
2. The agent greets the AE by name, asks *"Is this customer on the Enterprise plan or the Growth plan?"*, reads the answer back, and asks them to confirm. If the answer is unclear it asks once more, then ends the call. It never guesses and never leaves plan details on a voicemail.
3. After the call, Bolna's extraction fills in `plan_tier` (`enterprise`, `growth` or `unclear`) and `confirmed` (`yes` or `no`).
4. Bolna posts status updates to `/api/voice/webhook`. The app ignores everything but final statuses and then **re-fetches the call from Bolna** (`GET /executions/{id}`) instead of trusting the webhook body.
5. The app's own rule makes the decision (`lib/domain/tier-decision.ts`): it accepts a tier only if the extraction says so **and** the AE's own words contain that tier, with no contradiction, hedging or negation. The extraction is advisory.

## Applying the configuration

The exact prompt, welcome message, extractions and call settings live in [scripts/bolna/agent-config.mjs](../scripts/bolna/agent-config.mjs). Apply them with:

```bash
pnpm bolna:setup
```

It needs `BOLNA_API_KEY` and `BOLNA_AGENT_ID` in `.env.local`. To also point the agent's webhook at your deployment, set `APP_URL` (for example `https://your-app.vercel.app`) and `BOLNA_WEBHOOK_SECRET`, plus `VERCEL_BYPASS` if the URL is protected, and run it again. The script:

- backs up the current agent to `.bolna-backups/` (git-ignored) first;
- sets the agent name, welcome message and prompt;
- turns **voicemail detection on**, sets the transcriber language to **English** (so the tier words are transcribed as words) and keeps the call short (hang up after 10 s of silence or 150 s in total);
- creates the two extractions if they do not exist yet, and leaves existing ones alone;
- reads the agent back and prints what is now set, with the webhook secret hidden.

It is safe to run repeatedly.

### Entering it by hand instead

In the Bolna dashboard, open the agent and set:

| Where | Setting |
| --- | --- |
| Agent / Welcome message | `Hello, this is NovaCRM's onboarding assistant. Am I speaking with {{ae_name}}?` |
| Agent prompt | The `SYSTEM_PROMPT` text in `agent-config.mjs` |
| Transcriber | Language: English |
| Call tab | Voicemail Detection: on. Hang up after silence: 10 s. Maximum call time: 150 s |
| Extractions tab | Category `Plan confirmation`; two pre-defined extractions named exactly `plan_tier` and `confirmed`, with the questions and answer options from `agent-config.mjs` |
| Analytics / webhook | `https://<your-app>/api/voice/webhook?token=<BOLNA_WEBHOOK_SECRET>` |

## The webhook

Bolna **cannot sign its requests**, so the endpoint is protected by a secret in the URL plus Bolna's three published source addresses (`13.203.39.153`, `13.126.9.249`, `13.202.133.53`). Behind Vercel Deployment Protection, Bolna cannot send the bypass header either, so the bypass token goes in the URL too (`VERCEL_BYPASS`). This is a known production gap: a signed webhook, or an authenticated callback, would be used with a provider that supports one.

Bolna sends several updates per call. `call-disconnected` fires first, with an empty transcript. `completed` follows seconds later with the transcript and extraction. If a webhook is ever lost, the workflow's timer fires and the app reads the result from Bolna itself, so a missed webhook delays a deal but never loses it.

## Testing

- **Unit tests** (`pnpm test`): the client, status mapping, transcript parsing and extraction reading, run against responses shaped like Bolna's documented payloads, including each AE answer the tier rule must handle.
- **One real call** (rings your phone, uses Bolna credit):

  ```bash
  CALL_ME=yes pnpm test:live tests/live/bolna-call.live.test.ts
  ```

  Answer, say "Enterprise", and confirm when asked. The test prints the transcript, the extraction and the system's decision.

## Trial account limits

- A trial account can only call numbers listed under **Profile → Verified Numbers**. Calling any other number returns an error, which the app treats as a provider problem and escalates rather than retrying.
- Calls use Bolna credit. If the balance runs out, the call ends with `balance-low`, which the app also escalates immediately without counting it as an unanswered AE.
- The tier rule needs the words "Enterprise" and "Growth" in the transcript. If calls transcribe badly (for example in the wrong language), the rule rejects them rather than guessing, and the deal escalates after the retries.
