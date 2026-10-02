# Architecture

The app has two halves: a **Slack bot** and an **admin panel**, both in a single Next.js deployment.

A visual overview is available in [architecture-diagram.excalidraw](architecture-diagram.excalidraw) (open with Excalidraw extension or [excalidraw.com](https://excalidraw.com)).

## Slack bot flow

```
Slack message → Chat SDK (receive & route) → Vercel Workflow (durable) → AI SDK (think & generate) → Chat SDK (reply to Slack)
```

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SLACK WORKSPACE                              │
│                                                                      │
│  @bot mention ──┐    reply in thread ──┐    member joins ──┐        │
└─────────────────┼──────────────────────┼───────────────────┼────────┘
                  │                      │                   │
                  ▼                      ▼                   ▼
         ┌─────────────────────────────────────────────────────────┐
         │           app/api/slack/route.ts                         │
         │           Slack webhook entry point                      │
         └───────┬───────────────────────┬───────────────────┬─────┘
                 │                       │                   │
                 ▼                       ▼                   ▼
         ┌──────────────┐     ┌──────────────┐    ┌────────────────┐
         │  Chat SDK     │     │  Chat SDK     │    │  Welcome DM    │
         │  onNewMention │     │  onSubscribed-│    │  lib/welcome.ts│
         │  + subscribe  │     │  Message      │    │  (no workflow) │
         └───────┬──────┘     └───────┬──────┘    └────────────────┘
                 │                    │
                 ▼                    ▼
         ┌─────────────────────────────────┐
         │          lib/chat.ts             │
         │  1. Set "is thinking..." status  │
         │  2. Fetch thread history          │
         │  3. start(workflowAgent)          │
         └───────────────┬─────────────────┘
                         │ fire-and-forget
                         ▼
         ┌──────────────────────────────────────────────────────┐
         │       Vercel Workflow (durable)                       │
         │       workflows/agent-workflow/index.ts               │
         │                                                       │
         │  1. Get thread permalink (non-DM only)               │
         │  2. Save status context to Redis                    │
         │  3. Resolve channel name + start live stream         │
         │  4. Save user message (follow-ups only)               │
         │  5. Run DurableAgent (AI SDK + Claude)                │
         │           ┌────────────────────────────────┐          │
         │           │ System prompt (lib/agent.ts)    │          │
         │           │ Up to 50 tool-use steps         │          │
         │           │                                  │          │
         │           │ Tools:                           │          │
         │           │ ├─ suggest_channel               │          │
         │           │ ├─ unanswered                    │          │
         │           │ ├─ web_search                    │          │
         │           │ ├─ bash / bash_batch *           │          │
         │           │ └─ flag_to_lead                  │          │
         │           └────────────────────────────────┘          │
         │  6. Post response to Slack thread **                  │
         │  7. If response mentions a channel (fallback):          │
         │     → Log "routed" action                             │
         │  8. Else if no tool already logged:                   │
         │     a. Resolve channel name                           │
         │     b. Get permalink (non-DM only)                    │
         │     c. Log "answered" action + conversation           │
         │  9. End live stream + clear status context             │
         └──────────────────────────────────────────────────────┘
                         │
                         ▼
         ┌─────────────────────────────────┐
         │         Upstash Redis            │
         │  • Bot actions (30-day TTL)      │
         │  • Full conversations            │
         │  • Active stream entries          │
         │  • Status context (5-min TTL)    │
         │  • Stats                          │
         └───────────────┬─────────────────┘
                         │ polled every 3s
                         ▼
         ┌─────────────────────────────────┐
         │      Admin panel (Next.js)       │
         │  • Live streaming cards          │
         │  • Activity feed + stats          │
         │  • Conversation detail            │
         │  • Settings + channel overview    │
         │  • Slack OAuth (Better Auth)      │
         └─────────────────────────────────┘

*  bash/bash_batch require SAVOIR_API_URL
** First DM gets a "may be reviewed by the community lead" disclaimer
```

Three layers work together:

- **[Chat SDK](https://chat-sdk.dev)**—the messaging layer. Receives Slack webhook events, manages conversation threads, stores history in Redis, sends replies, shows typing indicators. It's the bot's "mouth and ears." Supports multiple platforms (Slack, Discord) so the same AI logic can be reused with a different adapter.
- **[AI SDK](https://ai-sdk.dev)**—the AI layer. Sends prompts to the model (Claude, GPT, etc.), streams responses, handles tool calls. It's the bot's "brain." Doesn't know anything about Slack—just does LLM calls.
- **[Vercel Workflow](https://vercel.com/docs/workflow)**—the durability layer. Wraps AI SDK calls in durable steps with automatic retries and checkpoints. If a long response fails halfway, it picks up where it left off instead of starting over.

## Tools

Tools (`suggest_channel`, `unanswered`, `bash`, `bash_batch`, `web_search`, `flag_to_lead`) run as durable steps inside the workflow. Each tool updates the Slack typing indicator with a tool-specific status (e.g. "searching the web...", "reading docs...") via Chat SDK's `startTyping()` method—this is the only reliable way to set custom statuses, since Chat SDK manages the Slack Assistants API lifecycle internally and overrides raw `assistant.threads.setStatus` calls. Because Vercel Workflow step functions run in isolated contexts, the Slack thread context is stored in Redis at workflow start and read back inside each step—module-level state doesn't cross the workflow VM / step handler boundary. `web_search` uses Anthropic's native web search tool (`webSearch_20250305`) via a `generateText` sub-call routed through [AI Gateway](https://vercel.com/docs/ai-gateway). Less-used tools use Anthropic's `deferLoading` so only relevant tools are loaded into context. Welcome messages for new members are handled directly in the route—no workflow needed.

## Admin panel

Server-rendered dashboard with live streaming, activity feed, conversation history, and bot configuration. Slack OAuth via Better Auth restricts access to workspace members. Data queries enforce auth via `requireSession()`; stream polling uses authenticated GET API routes (`/api/streams`). Falls back to mock data when Redis is not configured. See [Admin panel](admin-panel.md) for Next.js implementation details.

## Customize

| File                                | Purpose                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `lib/agent.ts`                      | System prompt and personality                                                                     |
| `lib/channels.ts`                   | Channel map—must match your Slack workspace                                                       |
| `lib/welcome.ts`                    | Welcome message sent when members join                                                            |
| `lib/auth.ts`                       | Better Auth config—Slack OAuth for admin panel                                                    |
| `workflows/agent-workflow/tools.ts` | Agent tools (`suggest_channel`, `unanswered`, `bash`, `bash_batch`, `web_search`, `flag_to_lead`) |

> **Workflow constraint:** Files using `'use step'` or `'use workflow'` must live inside the `workflows/` directory for the bundler to process them. `ai` and `@ai-sdk/anthropic` must be dynamically imported inside step functions—static top-level imports break the workflow runtime.
