# Testing without Slack

The `/api/test-action` endpoint lets you simulate bot actions (requires Upstash Redis env vars and an authenticated session). Sign in to the admin panel first, then use the endpoint from the browser console or a tool that forwards your session cookie.

```bash
curl -X POST http://localhost:3000/api/test-action -b "better-auth.session_token=YOUR_SESSION_TOKEN"
```

Each call logs a random action (answered, routed, welcomed, surfaced, or flagged) and returns the logged entry as JSON. Answered actions include a test conversation thread—click the **Conversation** button on the activity page to view it.

## Testing the live stream indicator

The `PUT` method creates a temporary stream entry so you can verify the real-time indicators without a Slack connection:

```bash
curl -X PUT http://localhost:3000/api/test-action -b "better-auth.session_token=YOUR_SESSION_TOKEN"
```

Open the Activity page (`/activity`)—within a few seconds, a green "Live" card should appear at the top of the activity list showing "Bot is responding..." with a spinner. The stream entry auto-expires after 120 seconds (Redis TTL).

## Clearing test data

To clear all stored actions and streams (useful after initial testing or when upgrading):

```bash
curl -X DELETE http://localhost:3000/api/test-action -b "better-auth.session_token=YOUR_SESSION_TOKEN"
```

## Running without Redis

Comment out the Upstash env vars and the admin panel falls back to mock data, including mock conversations for three sample actions. This lets you work on the UI without any external services.
