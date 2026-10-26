import {
  Children, cloneElement, createContext, isValidElement, useContext, useEffect, useMemo, useRef,
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

// A long document is finished more often when its shape is visible before its body is read
// (REFERENCES.md REF-3). The terms run ten numbered sections and the features page seven, each
// a single scroll on a phone with nothing to say what lies below the fold. So every document with
// three or more `##` headings carries an "On this page" list under its title: the headings, as
// in-page anchors, inside a `<details>` that opens on request and otherwise costs one row, so the
// list never pushes the prose down on a phone. Fewer than three headings is not a shape worth a
// list, and such a page shows none.
//
// The ids come from the heading text, the same way on both sides: the list reads the markdown's
// `## ` lines (skipping any fenced code), the h2 component reads its hast node, and both run the
// text through `slugOf`. Two headings with the same text would share an id, so the second is
// dropped from the list rather than linked to the wrong place.
const MIN_SECTIONS = 3;

type Section = { id: string; text: string };

function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Inline markdown stripped from a heading line, leaving what the reader sees. */
function plainOf(line: string): string {
  return line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim();
}

function sectionsOf(md: string): Section[] {
  const out: Section[] = [];
  const seen = new Set<string>();
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^## +(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = plainOf(m[1]);
    const id = slugOf(text);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text });
  }
  return out;
}

const Sections = createContext<Section[]>([]);

function SectionList() {
  const sections = useContext(Sections);
  const list = useRef<HTMLDetailsElement>(null);
  if (sections.length < MIN_SECTIONS) return null;
  // Choosing a section folds the list. On a phone the row is stuck under the nav while the page
  // scrolls (doc.css), so an open list left open would sit over the very heading it just jumped
  // to; folded, the heading lands under the row's edge and the reader is looking at the section.
  const choose = () => { if (list.current) list.current.open = false; };
  return (
    <details className="doc-sections" ref={list}>
      <summary>On this page</summary>
      <ol>
        {sections.map((s) => (
          <li key={s.id}><a href={`#${s.id}`} onClick={choose}>{s.text}</a></li>
        ))}
      </ol>
    </details>
  );
}

type HeadingProps = { node?: unknown; children?: ReactNode } & HTMLAttributes<HTMLHeadingElement>;

// The title carries the list directly beneath it, so the list sits where a reader looks for the
// shape of the page: after the name of the thing, before the first word of its body.
function Title({ node: _node, children, ...props }: HeadingProps) {
  return (
    <>
      <h1 {...props}>{children}</h1>
      <SectionList />
    </>
  );
}

function Heading({ node, children, ...props }: HeadingProps) {
  const id = props.id ?? (slugOf(textOf(node as HastNode | undefined)) || undefined);
  return <h2 {...props} id={id}>{children}</h2>;
}

const components: Components = {
  h1: Title,
  h2: Heading,
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
  const sections = useMemo(() => sectionsOf(md), [md]);
  // A link that arrives carrying a fragment finds nothing to scroll to until the markdown has
  // rendered, so the jump is made here, once the headings exist.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [md]);
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
        <Sections.Provider value={sections}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{md}</ReactMarkdown>
        </Sections.Provider>
      </article>
      <SiteFooter />
    </div>
  );
}
