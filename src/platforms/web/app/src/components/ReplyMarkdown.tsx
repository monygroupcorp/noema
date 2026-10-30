import { isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Renders a concierge reply's text as markdown. ConciergeAgent.buildSystemPrompt instructs the
// model to fence anything copyable — an id, a command, a prompt it is quoting back — in
// backticks; this is what turns that fence into an actual code block with its own copy control,
// instead of the backtick characters printing literally in a plain <div>.

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function CodeBlock({ node: _node, children, ...props }: { node?: unknown; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = textOf(children).replace(/\n$/, '');
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className="reply-code-block">
      <button type="button" className="reply-code-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      <pre {...props}>{children}</pre>
    </span>
  );
}

const components: Components = {
  // A paragraph is the common case; margins live in CSS rather than per-element inline styles.
  p: ({ node: _node, ...props }) => <p className="reply-p" {...props} />,
  pre: CodeBlock,
};

export function ReplyMarkdown({ text }: { text: string }) {
  return (
    <div className="reply-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
}
