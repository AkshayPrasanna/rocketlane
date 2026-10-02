# Community Agent Template

Open source AI-powered Slack community management bot with a built-in Next.js admin panel. Uses Chat SDK, AI SDK, and Vercel Workflow.

**Template.** Fork it, customize it, and deploy your own AI community manager with Vercel.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fcommunity-agent-template&env=COMMUNITY_NAME,BETTER_AUTH_SECRET,SLACK_CLIENT_ID,SLACK_CLIENT_SECRET,SLACK_TEAM_ID&envDescription=COMMUNITY_NAME%3A%20Name%20in%20bot%20responses%20%7C%20BETTER_AUTH_SECRET%3A%20Run%20%60openssl%20rand%20-base64%2032%60%20%7C%20SLACK_CLIENT_ID%20%26%20SLACK_CLIENT_SECRET%3A%20From%20Slack%20app%20Basic%20Information%20%7C%20SLACK_TEAM_ID%3A%20Workspace%20ID.%20Add%20AI%20keys%20after%20deploy.&envLink=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fcommunity-agent-template%23configure-environment-variables&project-name=community-agent&repository-name=community-agent&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22turso%22%7D%5D)

## Features

- **Community manager AI**—routes questions, welcomes members, surfaces unanswered threads, and flags issues to a lead. Powered by [AI SDK](https://ai-sdk.dev)
- **Channel-aware routing**—configurable channel map so the bot knows your workspace layout and where to send people
- **Durable workflows**—every LLM call and tool execution is a checkpoint with automatic retries via [Vercel Workflow](https://vercel.com/docs/workflow)
- **Web search**—Anthropic's native web search tool, scoped to your community's domains via `SEARCH_DOMAINS`. Runs through [AI Gateway](https://vercel.com/docs/ai-gateway)
- **Sandbox execution**—optional `bash`/`bash_batch` tools for running commands in a sandboxed environment via the [Knowledge Agent Template](https://github.com/vercel-labs/knowledge-agent-template) API
- **Native Slack UI**—typing indicators, threaded replies, and DMs. Powered by [Chat SDK](https://chat-sdk.dev)
- **Admin panel**—live dashboard with real-time streaming indicators, ViewTransition animations, activity feed, type filters, text search, inline conversation previews, activity trends, and settings page with channel overview
- **Auth**—Slack OAuth via [Better Auth](https://www.better-auth.com) restricts the admin panel to workspace members

## Quick start

Try the admin panel without setting up Slack:

1. Import the repo on [vercel.com/new](https://vercel.com/new)
2. Add `ADMIN_DEMO_MODE=true`, `ALLOW_ADMIN_DEMO_MODE=true`, and a `COMMUNITY_NAME` env var (e.g. `DevHub`)
3. Deploy—the dashboard works immediately with mock data

Demo mode requires both `ADMIN_DEMO_MODE=true` and `ALLOW_ADMIN_DEMO_MODE=true`. Together they bypass admin auth and use mock activity so people can open the deployed template before Slack is connected. Before connecting a real Slack workspace, remove both variables from Vercel Project Settings → Environment Variables (and from `.env.local`, if you set them locally).

For the full Slack bot setup, see [docs/setup.md](docs/setup.md).

## Customization

| What to change  | File                                                                         | Details                                   |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| Bot personality | [`lib/agent.ts`](lib/agent.ts)                                               | System prompt and instructions           |
| Channel map     | [`lib/channels.ts`](lib/channels.ts)                                         | Must match your Slack workspace          |
| Welcome message | [`lib/welcome.ts`](lib/welcome.ts)                                           | Sent when new members join               |
| Agent tools     | [`workflows/agent-workflow/tools.ts`](workflows/agent-workflow/tools.ts)     | Add, remove, or modify tools             |
| Auth config     | [`lib/auth.ts`](lib/auth.ts)                                                 | Slack OAuth for the admin panel          |
| Action type UI  | [`config/type-config.ts`](config/type-config.ts)                             | Icons, labels, and colors per action type |

### Knowledge base

This template is designed to work alongside the [Knowledge Agent Template](https://github.com/vercel-labs/knowledge-agent-template). Set `SAVOIR_API_URL` to connect to a deployed Savoir backend, giving the bot `bash` and `bash_batch` tools to search and read your community docs remotely. Without it, the bot still works using web search, channel routing, and the system prompt.

## Docs

- [Full setup guide](docs/setup.md)—Slack app, env vars, storage, OAuth, channels, deploy
- [Architecture](docs/architecture.md)—how the bot works, key files, workflow constraints
- [Admin panel](docs/admin-panel.md)—dashboard pages, live streaming, filters, Next.js patterns
- [Testing](docs/testing.md)—test without Slack, simulate actions, mock data

## Built with

- [Next.js 16](https://nextjs.org)—App Router with cacheComponents
- [Chat SDK](https://chat-sdk.dev)—Slack adapter and bot framework
- [AI SDK 6](https://ai-sdk.dev)—AI model integration with AI Gateway support
- [Vercel Workflow](https://vercel.com/docs/workflow)—durable workflow execution
- [Better Auth](https://www.better-auth.com)—Slack OAuth for the admin panel
- [shadcn/ui](https://ui.shadcn.com)—component library
- [Upstash Redis](https://upstash.com)—bot action logging, stats, and conversation storage

## License

MIT
