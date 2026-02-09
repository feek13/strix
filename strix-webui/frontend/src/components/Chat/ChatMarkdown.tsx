import { memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlockWithCopy } from "../ui/CodeBlockWithCopy";

interface ChatMarkdownProps {
  content: string;
  variant?: "default" | "compact";
}

/** Markdown renderer styled for chat panels. Use variant="compact" for smaller side panels. */
const ChatMarkdown = memo(function ChatMarkdown({ content, variant = "default" }: ChatMarkdownProps) {
  const isCompact = variant === "compact";

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="text-sm font-bold text-strix-text mt-3 mb-1.5 first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="text-sm font-bold text-strix-text mt-3 mb-1.5 first:mt-0">{children}</h3>,
        h3: ({ children }) => <h4 className="text-xs font-bold text-strix-text mt-2.5 mb-1 first:mt-0">{children}</h4>,
        h4: ({ children }) => <h4 className="text-xs font-semibold text-strix-text-secondary mt-2 mb-1 first:mt-0">{children}</h4>,
        p: ({ children }) => (
          <p className={isCompact
            ? "text-xs text-strix-text-secondary mb-2 last:mb-0 leading-relaxed"
            : "text-sm text-strix-text-secondary mb-2 last:mb-0 leading-relaxed"
          }>{children}</p>
        ),
        strong: ({ children }) => <strong className="font-semibold text-strix-text">{children}</strong>,
        em: ({ children }) => <em className="text-strix-text-secondary italic">{children}</em>,
        ul: ({ children }) => (
          <ul className={isCompact
            ? "text-xs text-strix-text-secondary mb-2 ml-3 space-y-0.5 list-disc"
            : "text-sm text-strix-text-secondary mb-2 ml-4 space-y-0.5 list-disc"
          }>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className={isCompact
            ? "text-xs text-strix-text-secondary mb-2 ml-3 space-y-0.5 list-decimal"
            : "text-sm text-strix-text-secondary mb-2 ml-4 space-y-0.5 list-decimal"
          }>{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <CodeBlockWithCopy
                preClassName={isCompact
                  ? "bg-strix-bg border border-strix-border-subtle rounded p-2 my-1.5 overflow-x-auto"
                  : "bg-strix-bg border border-strix-border-subtle rounded-md p-3 my-2 overflow-x-auto"
                }
                codeClassName={isCompact
                  ? "text-[11px] font-mono text-strix-accent leading-relaxed"
                  : "text-xs font-mono text-strix-accent leading-relaxed"
                }
              >{children}</CodeBlockWithCopy>
            );
          }
          return (
            <code
              className={isCompact
                ? "text-[11px] font-mono bg-strix-bg text-strix-accent px-1 py-0.5 rounded"
                : "text-xs font-mono bg-strix-bg text-strix-accent px-1 py-0.5 rounded"
              }
              {...props}
            >{children}</code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className={isCompact
            ? "border-l-2 border-strix-accent/40 pl-2.5 my-1.5 text-xs text-strix-text-muted italic"
            : "border-l-2 border-strix-accent/40 pl-3 my-2 text-sm text-strix-text-muted italic"
          }>{children}</blockquote>
        ),
        hr: () => <hr className="border-strix-border-subtle my-2" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-strix-accent hover:underline">{children}</a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className={isCompact
              ? "text-[11px] w-full border-collapse"
              : "text-xs w-full border-collapse"
            }>{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-strix-border-subtle">{children}</thead>,
        th: ({ children }) => <th className="text-left px-2 py-1 text-strix-text-secondary font-semibold">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1 text-strix-text-muted border-t border-strix-border-subtle/50">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

export { ChatMarkdown };
