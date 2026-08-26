// Pure decision for which colloquium the concierge dock should attach to when it has no
// active thread pointer — on first mount and after every navigation, since the dock is
// remounted per-screen and its pointer is component state (noema-324).
//
// Rule: resume the most recently active existing thread; create only when the caller has
// no threads at all. The dock's explicit "+ New conversation" affordance clears the pointer
// on purpose and never consults this helper.
export type ConciergeThreadPick = { action: 'resume'; id: string } | { action: 'create' };

export function pickConciergeThread(threads: { id: string; mutatum: string }[]): ConciergeThreadPick {
  if (threads.length === 0) return { action: 'create' };
  // Pick by mutatum directly rather than trusting the caller's ordering, so this holds even
  // if a future caller passes an unsorted list.
  const newest = threads.reduce((a, b) => (new Date(b.mutatum).getTime() > new Date(a.mutatum).getTime() ? b : a));
  return { action: 'resume', id: newest.id };
}
