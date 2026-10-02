"use client";

import { ChevronDown, ChevronUp, MessageCircle } from "lucide-react";
import { createContext, useContext, useState, useTransition } from "react";
import { fetchConversationPreview } from "@/data/actions/conversation";
import type { ConversationMessage } from "@/lib/types";
import { cleanSlackText, cn, stripMarkdown } from "@/lib/utils";

interface PreviewState {
  isOpen: boolean;
  isPending: boolean;
  messages: ConversationMessage[] | null;
  toggle: () => void;
}

const PreviewContext = createContext<PreviewState | null>(null);

export function ConversationPreviewProvider({
  actionId,
  children,
}: {
  actionId: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null);
  const [isPending, startFetchTransition] = useTransition();
  const [, startToggleTransition] = useTransition();

  function toggle() {
    if (isOpen || messages) {
      startToggleTransition(() => {
        setIsOpen(!isOpen);
      });
    } else {
      startFetchTransition(async () => {
        const result = await fetchConversationPreview(actionId);
        startFetchTransition(() => {
          setMessages(result);
          setIsOpen(true);
        });
      });
    }
  }

  return (
    <PreviewContext value={{ isOpen, messages, isPending, toggle }}>
      {children}
    </PreviewContext>
  );
}

export function ConversationPreviewToggle() {
  const ctx = useContext(PreviewContext);
  if (!ctx) {
    return null;
  }
  const { isOpen, isPending, toggle } = ctx;

  return (
    <button
      aria-label={
        isOpen ? "Hide conversation preview" : "Show conversation preview"
      }
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium text-foreground text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={toggle}
      type="button"
    >
      <MessageCircle className="h-3 w-3" />
      {(() => {
        if (isPending) {
          return "Loading...";
        }
        return isOpen ? "Hide" : "Preview";
      })()}
      {!isPending &&
        (isOpen ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        ))}
    </button>
  );
}

export function ConversationPreviewContent() {
  const ctx = useContext(PreviewContext);
  if (!(ctx?.isOpen && ctx.messages)) {
    return null;
  }
  const { messages } = ctx;

  if (messages.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">No conversation recorded.</p>
    );
  }

  return (
    <div className="divide-y rounded-md border bg-muted/30">
      {messages.slice(0, 4).map((msg, i) => {
        const cleaned = stripMarkdown(cleanSlackText(msg.content));
        const truncated =
          cleaned.length > 200 ? `${cleaned.slice(0, 200)}...` : cleaned;
        return (
          <div
            className="flex gap-2 px-3 py-2 text-xs"
            key={`preview-${msg.role}-${msg.timestamp ?? i}`}
          >
            <span
              className={cn(
                "shrink-0 font-medium",
                msg.role === "assistant" ? "text-info" : "text-foreground"
              )}
            >
              {msg.role === "assistant" ? "Bot" : "User"}
            </span>
            <span className="text-muted-foreground">{truncated}</span>
          </div>
        );
      })}
      {messages.length > 4 && (
        <div className="px-3 py-1.5 text-muted-foreground/60 text-xs">
          +{messages.length - 4} more messages
        </div>
      )}
    </div>
  );
}
