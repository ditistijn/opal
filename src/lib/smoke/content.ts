/**
 * Sanity check for an artifact's HTML file: catches the failure mode seen in the first real run, where the model
 * published `{"index.html": "<<FILE:index.html>>"}` (an invented file-reference syntax) and the preview "rendered"
 * that literal text.
 */
const PLACEHOLDER = /^\s*(<<[^<>\n]{1,200}>>|@[\w./-]+|\{\{[^{}\n]{1,200}\}\}|\.{0,2}\/?[\w./-]+\.html?)\s*$/
const MARKUP = /<(html|head|body|main|div|section|script|style|svg|canvas)\b/i
export const MIN_HTML_BYTES = 200

/** Returns why `text` is not a real HTML document, or undefined when it looks like one. */
export function htmlProblem(text: string): string | undefined {
  const preview = JSON.stringify(text.slice(0, 80))
  if (PLACEHOLDER.test(text)) return `the file is a placeholder/file reference, not content: ${preview}`
  if (text.length < MIN_HTML_BYTES) return `the file is only ${text.length} characters: ${preview}`
  if (!MARKUP.test(text)) return `the file contains no HTML markup: ${preview}`
  return undefined
}
