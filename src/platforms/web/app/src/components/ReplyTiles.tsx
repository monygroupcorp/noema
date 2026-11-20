import { useState } from 'react';
import { ReplyMarkdown } from './ReplyMarkdown';
import { splitReplyBlocks } from '../lib/replyBlocks';

// A reply rendered as this goal's done-when #2: copyable tiles rather than one wall of text
// squeezed into the dock's corner panel. Each tile keeps its own copy button (on top of
// ReplyMarkdown's own per-fence copy button for any code block the tile contains) so a prose
// tile — the common case for a prefix prompt the model didn't fence — is still one click to
// the clipboard.
function Tile({ block }: { block: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(block).then(() => setCopied(true)).catch(() => {});
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="reply-tile">
      <ReplyMarkdown text={block} />
      <button type="button" className="reply-tile-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

export function ReplyTiles({ text }: { text: string }) {
  return (
    <div className="reply-tiles">
      {splitReplyBlocks(text).map((block, i) => <Tile key={i} block={block} />)}
    </div>
  );
}
