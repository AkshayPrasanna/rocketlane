# Full setup (Slack bot + admin panel)

## 1. Create Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**.

Paste this manifest (replace `your-app.vercel.app` with your deployed URL):

```json
{
  "display_information": {
    "name": "Community Agent",
    "description": "AI-powered community manager",
    "background_color": "#000000"
  },
  "features": {
    "bot_user": {
      "display_name": "Community Agent",
      "always_online": true
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "app_mentions:read",
        "assistant:write",
        "channels:history",
        "channels:join",
        "channels:read",
        "chat:write",
        "emoji:read",
        "groups:history",
        "im:history",
        "reactions:read",
        "search:read.public",
        "search:read.users",
        "users.profile:read",
        "users:read"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "https://your-app.vercel.app/api/slack",
      "bot_events": [
        "app_mention",
        "member_joined_channel",
        "message.channels",
        "message.groups",
        "message.im"
      ]
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

After creating:

1. Go to **App Home** in the left sidebar → enable **Messages Tab** → check **"Allow users to send Slash commands and messages from the messages tab"**
2. Click **Install App** in the left sidebar → **Install to Workspace** → authorize
3. Copy the **Bot User OAuth Token** (`xoxb-...`) from OAuth & Permissions
4. Copy the **Signing Secret** from Basic Information (click Show)

> **Tip:** Create a free test workspace at [slack.com/create](https://slack.com/create) to experiment safely. Add channels matching the template defaults (`#help`, `#bugs`, `#introductions`) and install the bot there.

## 2. Configure environment variables

Add these in your Vercel project settings (or `.env.local` for local dev):

| Variable                   | Required  | Description                                                                                                                                        |
| -------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SLACK_BOT_TOKEN`          | For Slack | Bot token from your Slack app (`xoxb-...`)                                                                                                         |
| `SLACK_SIGNING_SECRET`     | For Slack | Signing secret from Slack app settings                                                                                                             |
| `REDIS_URL`                | For Slack | Redis for conversation state (`redis://...`)                                                                                                        |
| `ANTHROPIC_API_KEY`        | Local dev | Direct Anthropic API key for local development. On Vercel, [AI Gateway](https://vercel.com/docs/ai-gateway) auto-authenticates via OIDC            |
| `COMMUNITY_NAME`           | No        | Name shown in bot responses (default: "Your Community")                                                                                            |
| `AI_MODEL`                 | No        | AI model (default: `anthropic/claude-sonnet-4-20250514`). Uses [AI Gateway](https://vercel.com/docs/ai-gateway) for routing                        |
| `UPSTASH_REDIS_REST_URL`   | No        | Upstash Redis REST URL (or use `KV_REST_API_URL` from Vercel Marketplace)                                                                          |
| `UPSTASH_REDIS_REST_TOKEN` | No        | Upstash Redis REST token (or use `KV_REST_API_TOKEN` from Vercel Marketplace)                                                                      |
| `SLACK_WORKSPACE_URL`      | No        | Slack workspace URL—adds an "Open Slack" link to the admin panel                                                                                   |
| `SAVOIR_API_URL`           | No        | [Knowledge Agent Template](https://github.com/vercel-labs/knowledge-agent-template) API URL for sandboxed bash execution                           |
| `SAVOIR_API_KEY`           | No        | Savoir API key (if the instance requires auth)                                                                                                     |
| `SEARCH_DOMAINS`           | No        | Comma-separated domains for web search (e.g. `docs.example.com,partner.com`). When set, searches are scoped to these domains           |
| `COMMUNITY_LEAD_SLACK_ID`  | No        | Slack user ID—bot can escalate tricky issues via DM                                                                                                |
| `BETTER_AUTH_SECRET`       | Yes       | Secret for admin panel auth sessions (min 32 chars). Generate with `openssl rand -base64 32`                                                       |
| `SLACK_CLIENT_ID`          | Yes       | Slack app Client ID (Basic Information→App Credentials)                                                                                            |
| `SLACK_CLIENT_SECRET`      | Yes       | Slack app Client Secret (same location)                                                                                                            |
| `SLACK_TEAM_ID`            | Yes       | Slack workspace ID (`T...`)—restricts admin sign-in to workspace members                                                                           |
| `TURSO_DATABASE_URL`       | For prod  | Turso database URL (`libsql://...`). Defaults to `file:local.db` for local dev                                                                     |
| `TURSO_AUTH_TOKEN`         | For prod  | Turso auth token (from Vercel Turso integration or [turso.tech](https://turso.tech))                                                               |

## 3. Set up Vercel storage

The app uses two databases. Set both up from the Vercel **Storage** tab—env vars are added to your project automatically.

**Turso (auth sessions):**

1. Go to your Vercel project → **Storage** tab → **Create Database** → **[Turso](https://turso.tech/)**
2. Auto-populates `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`
3. Create the auth tables—run `npx auth@latest migrate` locally, or use the Turso dashboard SQL console. See the [Better Auth migration docs](https://www.better-auth.com/docs/concepts/database#running-migrations) for details.
4. For local dev, no setup needed—defaults to `file:local.db`

**Upstash Redis (bot action logging):**

1. Go to **Storage** tab → **Create Database** → **Upstash Redis**
2. Auto-populates env vars. The app only needs **two of them**:

| Vercel Marketplace variable   | Equivalent `UPSTASH_*` name | Used?                                                    |
| ----------------------------- | --------------------------- | -------------------------------------------------------- |
| `KV_REST_API_URL`             | `UPSTASH_REDIS_REST_URL`    | **Yes**—set one or the other                             |
| `KV_REST_API_TOKEN`           | `UPSTASH_REDIS_REST_TOKEN`  | **Yes**—set one or the other                             |
| `KV_REST_API_READ_ONLY_TOKEN` | —                           | No (app needs write access)                              |
| `KV_URL`                      | —                           | No                                                       |
| `REDIS_URL`                   | —                           | No (this is for conversation state, not the admin panel) |

Without Upstash Redis, the admin panel shows mock data—everything else still works.

Pull env vars locally after setup: `vercel link && vercel env pull .env.local`

## 4. Set up Slack OAuth for admin panel

The admin panel uses Slack OAuth—only members of your workspace can sign in. This reuses the same Slack app you created in step 1.

1. Go to your Slack app → **Basic Information** → **App Credentials**
2. Copy the **Client ID** and **Client Secret**
3. Go to **OAuth & Permissions** → **Redirect URLs** → add `https://<your-production-domain>/api/auth/callback/slack`
4. Find your **Workspace ID** (starts with `T`)—visible in the browser URL when using Slack: `app.slack.com/client/T.../...`
5. Add these env vars to your Vercel project (make sure to include the **Production** environment):
   - `SLACK_CLIENT_ID`—Client ID from step 2
   - `SLACK_CLIENT_SECRET`—Client Secret from step 2
   - `SLACK_TEAM_ID`—Workspace ID from step 4
   - `BETTER_AUTH_SECRET`—generate with `openssl rand -base64 32`
   - `BETTER_AUTH_URL`—your production domain URL (e.g. `https://your-app.vercel.app`)

> **Important:** Use your **production domain**—not a branch deployment URL (e.g. `git-main` variants). Branch URLs are preview deployments and may interfere with OAuth callbacks. Check **Settings → Domains** for the correct URL.
>
> **Local dev:** Add `http://localhost:3000/api/auth/callback/slack` as a second redirect URL in the Slack app. Set `BETTER_AUTH_URL=http://localhost:3000` in `.env.local`.

## 5. Configure channels

Edit `lib/channels.ts` to match your Slack workspace. These map to **existing channels**—the bot does not create them.

```ts
export const channels: Record<string, ChannelConfig> = {
  help: {
    name: 'help',
    description: 'Get help with questions and issues',
    topics: ['questions', 'support', 'troubleshooting'],
  },
  introductions: {
    name: 'introductions',
    description: 'New members introduce themselves',
    topics: ['introductions', 'new members'],
    isWelcomeChannel: true,
  },
  // Add your channels here...
};
```

Then **invite the bot** to each channel so it can read messages and post replies:

```
/invite @Community Agent
```

Run this in every channel listed in your config. The bot can't scan for unanswered questions or post welcome messages in channels it hasn't been invited to.

## 6. Deploy

```bash
vercel
```

After deploying, go to your Slack app → **Event Subscriptions** → set the Request URL to `https://<your-production-domain>/api/slack` and verify it shows a green checkmark.

### Deployment Protection bypass

Vercel Deployment Protection blocks unauthenticated requests—including Slack webhooks and OAuth callbacks. If you have [Deployment Protection](https://vercel.com/docs/security/deployment-protection) enabled, you need to create a bypass secret so Slack can reach your API.

1. Go to your Vercel project → **Settings** → **Deployment Protection**
2. Under **Protection Bypass for Automation**, click **Generate Secret** (add a note like "Slack webhooks")
3. Copy the generated secret
4. Update your Slack app URLs to include the bypass as a query parameter:

   **Event Subscriptions → Request URL:**

   ```
   https://<your-production-domain>/api/slack?x-vercel-protection-bypass=<secret>
   ```

   **OAuth & Permissions → Redirect URL:**

   ```
   https://<your-production-domain>/api/auth/callback/slack?x-vercel-protection-bypass=<secret>
   ```

Slack can't send custom headers, so the query parameter method is required. The secret is included on every request Slack sends to your app.

> **Tip:** If you only enable Deployment Protection on **Preview** deployments (not Production), you can skip this step—Slack webhooks pointing at your production domain will work without a bypass.

## Testing the bot

| What to try      | How                                                                                                 | Example response                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct question  | `@Community Agent how do I deploy this to Vercel?`                                                  | "You can deploy by clicking the Deploy with Vercel button..." (logged as **answered** with a conversation thread)                            |
| Channel routing  | `@Community Agent I found a security vulnerability in the API, the auth tokens are being logged in` | "I recommend reporting this in the #bugs channel..." (logged as **routed**)                                                                  |
| Channel routing  | `@Community Agent how do I set up Vercel Workflow?`                                                 | "Your question would fit best in the #help channel..." (logged as **routed**)                                                                |
| Flag to lead     | `@Community Agent someone is being rude in #help, can you get a human to look at it?`               | "I've flagged the issue to a community lead." (bot DMs the lead, logged as **flagged**)                                                      |
| Web search       | `@Community Agent what's the latest on Next.js 16 caching?`                                         | "Next.js 16 introduces significant updates..." (searches via Anthropic's native web search, scoped to `SEARCH_DOMAINS`, logged as **answered**) |
| Knowledge base   | `@Community Agent what files are in the knowledge base?`                                            | "We have the following files..." (uses `bash` tool via Savoir—requires `SAVOIR_API_URL`, logged as **answered**)                           |
| Unanswered scan  | `@Community Agent are there any unanswered questions in #help?`                                     | "There are no unanswered questions in the #help channel in the last 24 hours!" (logged as **surfaced** if questions are found)               |
| Thread follow-up | Reply in the thread: `thanks, where can I report a bug?`                                            | "You can report bugs in the #bugs channel." (maintains conversation context, updates the existing action)                                    |
| Trigger welcome  | Join `#introductions`                                                                               | Bot posts a welcome DM with a channel guide (logged as **welcomed**)                                                                         |
| DM the bot       | Send a direct message                                                                               | Bot responds as a community manager (logged as **answered** with channel `DM`)                                                               |

Each action is logged to the admin panel—check the dashboard to see stats and activity update in real time.
