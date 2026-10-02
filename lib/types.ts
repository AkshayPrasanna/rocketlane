/** Channel configuration for routing and community management */
export interface ChannelConfig {
  description: string;
  isWelcomeChannel?: boolean;
  name: string;
  topics: string[];
}

/** Slack context for posting responses */
export interface SlackContext {
  botToken: string;
  channelId: string;
  threadTs: string;
}

/** Chat message for conversation history */
export interface ChatMessage {
  content: string;
  role: "user" | "assistant";
}

/** Input for running the agent */
export interface AgentInput {
  history?: ChatMessage[];
  prompt: string;
  slack?: SlackContext;
}

/** Agent run result */
export interface AgentResult {
  error?: string;
  response: string;
  success: boolean;
}

/** Bot action logged to the admin panel */
export interface BotAction {
  channel: string;
  description: string;
  id: string;
  lastUpdated?: number;
  metadata?: Record<string, string>;
  threadKey?: string;
  timestamp: number;
  type: "routed" | "welcomed" | "surfaced" | "answered" | "flagged";
  user?: string;
}

/** A tool call made by the agent during a conversation turn */
export interface ToolCall {
  args?: Record<string, unknown>;
  toolName: string;
}

/** A message in a stored conversation */
export interface ConversationMessage {
  content: string;
  role: "user" | "assistant";
  timestamp?: number;
  toolCalls?: ToolCall[];
}

/** A conversation stored alongside an action */
export interface Conversation {
  actionId: string;
  messages: ConversationMessage[];
}

/** An active agent stream visible in the admin panel */
export interface StreamEntry {
  channel: string;
  prompt: string;
  status: "streaming" | "done";
  text: string;
  threadId: string;
  timestamp: number;
}

/** Full conversation detail returned from the data layer */
export interface ConversationDetail {
  action: BotAction;
  dmRestricted: boolean;
  messages: ConversationMessage[];
  threadKey: string | null;
}

/** Aggregated dashboard statistics */
export interface DashboardStats {
  counts: Record<string, number>;
  thisWeek: Record<string, number>;
}

/** Analytics time-series bucket */
export interface AnalyticsBucket {
  answered: number;
  date: string;
  flagged: number;
  routed: number;
  surfaced: number;
  welcomed: number;
}

/** Analytics data with bucketed trends and type breakdown */
export interface AnalyticsData {
  buckets: AnalyticsBucket[];
  totalActions: number;
  typeCounts: Record<string, number>;
}
