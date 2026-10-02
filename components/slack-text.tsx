import type { ReactNode } from "react";

const TOKEN_RE = /<(https?:\/\/[^|>\s]+)\|([^>]+)>|\*([^*\n]+)\*|`([^`\n]+)`/g;
const AMP_RE = /&amp;/g;
const LT_RE = /&lt;/g;
const GT_RE = /&gt;/g;

function unescapeSlack(text: string): string {
  return text.replace(LT_RE, "<").replace(GT_RE, ">").replace(AMP_RE, "&");
}

function renderLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) {
      nodes.push(unescapeSlack(line.slice(last, index)));
    }
    const [, url, label, bold, code] = match;
    if (url) {
      nodes.push(
        <a
          className="text-info underline underline-offset-2"
          href={url}
          key={index}
          rel="noopener noreferrer"
          target="_blank"
        >
          {unescapeSlack(label ?? url)}
        </a>
      );
    } else if (bold) {
      nodes.push(<strong key={index}>{unescapeSlack(bold)}</strong>);
    } else if (code) {
      nodes.push(
        <code
          className="rounded bg-muted px-1 font-mono text-[0.85em]"
          key={index}
        >
          {unescapeSlack(code)}
        </code>
      );
    }
    last = index + match[0].length;
  }
  if (last < line.length) {
    nodes.push(unescapeSlack(line.slice(last)));
  }
  return nodes;
}

/**
 * Renders the small part of Slack's message syntax the agent uses (bold, code, links, bullets)
 * as React elements. Nothing is injected as HTML, so message text can't carry markup.
 */
export function SlackText({ text }: { text: string }) {
  let offset = 0;
  const lines = text.split("\n").map((line) => {
    const entry = { key: offset, line };
    offset += line.length + 1;
    return entry;
  });

  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map(({ key, line }) => (
        <p className="min-h-[1em]" key={key}>
          {renderLine(line)}
        </p>
      ))}
    </div>
  );
}
