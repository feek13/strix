/** Parse user message to extract optional report context */
export function parseReportContext(content: string): { context: string | null; question: string } {
  const match = content.match(/^<!--report-context-->\n([\s\S]*?)\n<!--\/report-context-->\n([\s\S]*)$/);
  if (match) return { context: match[1], question: match[2] };
  return { context: null, question: content };
}
