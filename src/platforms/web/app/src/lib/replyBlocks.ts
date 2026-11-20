// Splits a concierge reply's markdown source into independently-copyable tiles (goal
// concierge-opens-too-loud, clause 2): a blank line starts a new tile, except inside a fenced
// code block, where a blank line is content, not a separator — splitting there would cut a
// quoted prompt or command in half.
export function splitReplyBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    const block = current.join('\n').trim();
    if (block) blocks.push(block);
    current = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === '') flush();
    else current.push(line);
  }
  flush();
  return blocks.length ? blocks : [text];
}
