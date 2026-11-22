import { api, type FlowSummary } from './api';

// The public flow list, fetched once per session and shared by the screens that read it.
// The catalogue lists it; a model card reads one entry from it to name and describe the
// model while the full schema is still on its way, so the screen holds its shape from the
// first paint (DESIGN.md D-61). A failed fetch is not cached: the next reader tries again.

let inflight: Promise<FlowSummary[]> | null = null;

export function flowSummaries(): Promise<FlowSummary[]> {
  if (!inflight) {
    inflight = api.listFlows()
      .then((r) => r.flows)
      .catch((e) => { inflight = null; throw e; });
  }
  return inflight;
}

export async function flowSummary(id: string): Promise<FlowSummary | undefined> {
  const flows = await flowSummaries();
  return flows.find((f) => f.id === id);
}
