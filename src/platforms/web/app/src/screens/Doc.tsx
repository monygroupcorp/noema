import {
  Children, cloneElement, createContext, isValidElement, useContext,
  type HTMLAttributes, type ReactElement, type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import { entryPath } from '../lib/entry';
import './landing.css'; // reuse .topnav / .btn chrome
import './doc.css';

// A table on a phone has nowhere to go sideways. The first answer was a scroll container
// (.table-wrap), and it was not enough: a scroller is read by eye as a table cut off at the
// page edge, because the columns past the fold are invisible until the reader thinks to drag,
// and a legal table's last column (retention, purpose) is the one the reader came for.
// Below the phone breakpoint in doc.css every body row therefore reflows into a stack of
// label + value lines, with the column header carried onto each cell as `data-label`. Above
// it the table keeps real table layout inside the scroll container, which has the width to
// show every column (REFERENCES.md REF-3: long prose a reader finishes on any width).
//
// The labels come from the markdown's own header row: react-markdown hands every element its
// hast node, so the table component reads `thead > tr > th` before rendering, and each body
// row clones its cells with the matching header. Whitespace text nodes sit between the cells
// react-markdown renders, so cells are counted by element, not by child.
const Headers = createContext<string[]>([]);

type HastNode = { type?: string; tagName?: string; value?: string; children?: HastNode[] };

function textOf(n: HastNode | undefined): string {
  if (!n) return '';
  if (n.type === 'text') return n.value ?? '';
  return (n.children ?? []).map(textOf).join('');
}

function headerLabels(table: HastNode | undefined): string[] {
  const thead = table?.children?.find((c) => c.tagName === 'thead');
  const row = thead?.children?.find((c) => c.tagName === 'tr');
  return (row?.children ?? []).filter((c) => c.tagName === 'th').map((c) => textOf(c).trim());
}

function labelled(children: ReactNode, labels: string[]): ReactNode {
  let i = 0;
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const label = labels[i++];
    return label
      ? cloneElement(child as ReactElement<{ 'data-label'?: string }>, { 'data-label': label })
      : child;
  });
}

type RowProps = { node?: unknown; children?: ReactNode } & HTMLAttributes<HTMLTableRowElement>;

function Row({ node: _node, children, ...props }: RowProps) {
  const labels = useContext(Headers);
  return <tr {...props}>{labels.length ? labelled(children, labels) : children}</tr>;
}

const components: Components = {
  table: ({ node, ...props }) => (
    <Headers.Provider value={headerLabels(node as HastNode | undefined)}>
      <div className="table-wrap"><table {...props} /></div>
    </Headers.Provider>
  ),
  // The header row carries no labels: a `th` already is the label. Only body rows reflow.
  thead: ({ node: _node, ...props }) => (
    <Headers.Provider value={[]}><thead {...props} /></Headers.Provider>
  ),
  tr: Row,
};

// Generic markdown content page (about / features / pricing / blog / legal/*).
export function Doc({ md }: { md: string }) {
  return (
    <div className="doc-page">
      <nav className="topnav">
        <Link to="/landing" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="dot" />noema
        </Link>
        <div className="right">
          <Link className="btn-ghost" to="/features">Features</Link>
          <Link className="btn-ghost" to="/pricing">Pricing</Link>
          <Link className="btn" to={entryPath()}>Open app</Link>
        </div>
      </nav>
      <article className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{md}</ReactMarkdown>
      </article>
      <SiteFooter />
    </div>
  );
}
