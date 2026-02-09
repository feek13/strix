import { useState, useCallback, memo } from "react";
import { Copy, Check } from "lucide-react";

/** Code block with a GitHub-style copy button */
const CodeBlockWithCopy = memo(function CodeBlockWithCopy({
  children, preClassName, codeClassName,
}: { children: React.ReactNode; preClassName: string; codeClassName: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, "");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);
  return (
    <div className="relative group/code">
      <pre className={preClassName}>
        <code className={codeClassName}>{children}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-strix-elevated/80 border border-strix-border-subtle text-strix-text-muted hover:text-strix-text opacity-0 group-hover/code:opacity-100 transition-all"
        title="Copy code"
      >
        {copied ? <Check size={12} className="text-strix-accent" /> : <Copy size={12} />}
      </button>
    </div>
  );
});

export { CodeBlockWithCopy };
