import { memo } from "react";
import { parseReportContext } from "../../lib/chatUtils";
import { ChatMarkdown } from "./ChatMarkdown";

/** Renders user message content, with collapsible report context if present */
const UserMessageContent = memo(function UserMessageContent({ content }: { content: string }) {
  const { context, question } = parseReportContext(content);
  if (!context) return <span className="whitespace-pre-wrap">{content}</span>;
  return (
    <>
      <details className="mb-2 group">
        <summary className="text-[10px] text-strix-text-muted cursor-pointer select-none flex items-center gap-1 hover:text-strix-text-secondary transition-colors">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          Selected from report
        </summary>
        <div className="mt-1.5 pl-2 border-l-2 border-strix-accent/30 max-h-[200px] overflow-y-auto">
          <ChatMarkdown content={context} />
        </div>
      </details>
      <span className="whitespace-pre-wrap">{question}</span>
    </>
  );
});

export { UserMessageContent };
