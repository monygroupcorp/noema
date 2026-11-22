// blogPosts.ts — the guides, read from the folder they live in.
//
// A post is a markdown file in `src/content/blog/`. Adding one is adding a file: the index picks
// it up, the route resolves from the filename, and nothing else has to be edited. The alternative
// — a registry listing every post beside the posts themselves — drifts the first time someone
// adds a file and forgets the second edit.

export interface Post {
  /** URL segment, from the filename: `train-a-model.md` → `/blog/train-a-model`. */
  slug: string;
  title: string;
  /** One line under the title in the index: what the reader will be able to do afterwards.
   *  From a `**Summary:** …` line in the post's front matter, else the post's first paragraph. */
  blurb: string;
  /** ISO date from a `**Published:** YYYY-MM-DD` line, when the post carries one. */
  published?: string;
  body: string;
}

/**
 * Pull a post's index entry out of its own text, so a file is the only place its title and
 * summary live. A post whose markdown says one thing and whose registry entry says another is a
 * bug waiting for someone to notice; there is no registry to disagree with.
 */
export function parsePost(slug: string, md: string): Post {
  const lines = md.split('\n');
  const titleLine = lines.findIndex((l) => /^#\s+/.test(l));
  const title = titleLine >= 0 ? lines[titleLine].replace(/^#\s+/, '').trim() : slug;

  const published = md.match(/^\*\*Published:\*\*\s*(\d{4}-\d{2}-\d{2})/m)?.[1];

  // The index line is front matter, like the date: a `**Summary:**` line says what the reader
  // will be able to do after the guide, which a post's own lede — written for someone already
  // reading it — need not. It is index copy, so it leaves the body before the body is shown.
  const summaryLine = /^\*\*Summary:\*\*\s*(.+)$/m;
  const summary = md.match(summaryLine)?.[1]?.trim();

  // Without one: the first real paragraph after the title — not the date line, not a rule,
  // not a heading.
  let blurb = summary ?? '';
  if (!blurb) {
    for (const line of lines.slice(titleLine + 1)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('---') || t.startsWith('**Published:**')) continue;
      blurb = t;
      break;
    }
  }
  blurb = blurb.replace(/[*_`]/g, '');

  const body = summary ? md.replace(summaryLine, '').replace(/\n{3,}/g, '\n\n') : md;
  return { slug, title, blurb, published, body };
}

const files = import.meta.glob('../content/blog/*.md', { query: '?raw', import: 'default', eager: true });

/** Every published guide, newest first; undated posts sort last, then by title. */
export const POSTS: Post[] = Object.entries(files)
  .map(([path, md]) => parsePost(path.replace(/^.*\/(.+)\.md$/, '$1'), md as string))
  .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? '') || a.title.localeCompare(b.title));

export const postBySlug = (slug: string): Post | undefined => POSTS.find((p) => p.slug === slug);
