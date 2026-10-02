# Admin panel

Server-rendered Next.js dashboard with real-time visibility into bot activity. Slack OAuth via Better Auth restricts access to workspace members. For the bot and workflow architecture, see [Architecture](architecture.md).

## Route structure

```
app/
  layout.tsx              ← root layout (fonts, theme, providers)
  not-found.tsx           ← global 404
  sign-in/page.tsx        ← Slack OAuth sign-in (no sidebar)
  (dashboard)/
    layout.tsx            ← sidebar layout (SidebarProvider + Sidebar)
    page.tsx              ← overview
    activity/page.tsx     ← activity feed
    activity/[id]/page.tsx← conversation detail
    settings/page.tsx     ← bot config + channels
  api/
    slack/route.ts        ← Slack webhook entry point
    streams/route.ts      ← active streams (polled by SWR)
    streams/[threadKey]/  ← single stream lookup
    test-action/route.ts  ← simulate actions for testing
```

The `(dashboard)` route group wraps authenticated pages in the sidebar layout without affecting the sign-in page.

## Rendering

`cacheComponents` enables Partial Prerendering (PPR). The static shell—headers, sidebar, layout—is prerendered at build time and served instantly, while async Server Components wrapped in `<Suspense>` stream in at request time with skeleton fallbacks.

Client Component hooks like `usePathname` and `useSession` are isolated in their own `<Suspense>`-wrapped components so they don't force the parent into dynamic rendering.

## Data layer

All data fetching lives in `data/queries/`. Every query:

- Enforces auth via `requireSession()`
- Deduplicates within a request via React `cache()`
- Returns exactly the data the page needs to render

Without Upstash Redis, queries fall back to `data/mock/` so the panel works without external services.

## Streaming

The workflow writes a stream entry to Redis when the bot starts processing and clears it when done. Client Components poll via SWR (`refreshInterval: 3000`) against authenticated GET routes (`/api/streams`, `/api/streams/[threadKey]`).

SWR handles deduplication, `keepPreviousData` to prevent flicker, and `revalidateOnFocus` for instant updates when tabbing back. A React context provider shares active thread keys across the activity page so the status card, activity card highlights, and conversation detail indicators all react to the same data.

## Async React patterns

- **`use()`**—when a Server Component would just fetch data and forward it to a single Client Component, the page calls the query without `await` and passes the resulting promise as a prop. The Client Component unwraps it with `use()`, avoiding a wrapper component. Used for the analytics chart and activity filter counts
- **`<ViewTransition>`**—animates Suspense reveals. Default crossfade on the dashboard, `slide-up`/`slide-down` on detail pages with `default="none"` to suppress unwanted update fades. Custom `@keyframes` defined in `globals.css`
- **`useTransition`**—activity filters, search, pagination, and conversation preview toggle wrap state updates in transitions to keep the UI responsive and activate ViewTransition animations
- **`useOptimistic`**—activity filters highlight the selected type instantly while the server re-renders the filtered list

## Search params

The activity page uses URL search params (`?type=`, `?q=`, `?limit=`) as the source of truth for filters, search, and pagination.

## Theming

Color tokens are CSS custom properties in oklch with light/dark variants (`app/globals.css`), registered as Tailwind colors via `@theme inline`. Charts reference the same tokens so they stay in sync across themes.

## Pages

| Page         | URL              | Description                                                           |
| ------------ | ---------------- | --------------------------------------------------------------------- |
| Overview     | `/`              | Stats, weekly trends, activity chart, recent activity, live bot status|
| Activity     | `/activity`      | Filterable timeline with search, pagination, and previews             |
| Conversation | `/activity/[id]` | Full conversation thread with markdown rendering                      |
| Settings     | `/settings`      | Read-only config values and channel overview with action counts       |
