import { useEffect, useState } from 'react';
import { api, type FlowSummary, type ModelCard } from '../lib/api';

// The landing page's breadth claim is not written down anywhere. It is read from the same
// catalogue the product runs on, so it cannot drift from what noema actually carries and it
// grows on its own as work ships. A competitor writes "1,000+ models"; this counts.

export interface Tally {
  key: string;
  count: number;
}

export interface CatalogSummary {
  workflows: number;
  /** Distinct verbs across the workflow catalogue, commonest first. */
  verbs: Tally[];
  /** Distinct modalities, commonest first. Workflows that declare none are not counted. */
  modalities: Tally[];
  /** Everything on the public model catalogue: base models, embeddings and LoRAs. */
  models: number;
  /** Model catalogue split by kind, largest first. */
  kinds: Tally[];
  /** Low-rank adaptations specifically — the trained identities. */
  loras: number;
  /** What those identities were trained on, commonest base first. Aggregate rather than a list
   *  of names: it answers what people actually build on here, and it does not put a stranger's
   *  slug on the front page. */
  bases: Tally[];
}

function tally(values: Array<string | null | undefined>): Tally[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const key = raw.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

const asText = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function summariseCatalog(flows: FlowSummary[], models: ModelCard[]): CatalogSummary {
  const kinds = tally(models.map((m) => m.genus));
  const loras = models.filter((m) => m.genus === 'lora');
  return {
    workflows: flows.length,
    verbs: tally(flows.map((f) => f.modusGenus)),
    modalities: tally(flows.map((f) => asText(f.categoria))),
    models: models.length,
    kinds,
    loras: kinds.find((k) => k.key === 'lora')?.count ?? 0,
    bases: tally(loras.map((m) => m.basis)),
  };
}

/** What the public API contract says about itself. Counted from the served document rather
 *  than written down, for the same reason the catalogue is. */
export interface ApiSummary {
  endpoints: number;
  /** Whether the contract carries an MCP route — i.e. whether agents can drive this. */
  mcp: boolean;
}

export function summariseApi(doc: unknown): ApiSummary | null {
  const paths =
    doc && typeof doc === 'object' && 'paths' in doc
      ? (doc as { paths?: unknown }).paths
      : undefined;
  if (!paths || typeof paths !== 'object') return null;
  const keys = Object.keys(paths as Record<string, unknown>);
  return { endpoints: keys.length, mcp: keys.some((k) => k === '/mcp' || k.startsWith('/mcp/')) };
}

export type CatalogState = 'loading' | 'ready' | 'error';

export interface LandingCatalog {
  state: CatalogState;
  summary: CatalogSummary | null;
  flows: FlowSummary[];
  models: ModelCard[];
  /** null until it loads, and null for good if it cannot be read — the API block simply does
   *  not render rather than claiming a shape of contract it did not see. */
  api: ApiSummary | null;
}

/**
 * Reads the live catalogue for the landing page.
 *
 * Both endpoints are the public, anon-readable projections, so a signed-out visitor sees the
 * same catalogue a signed-in one does. On failure the state is `error` and nothing is rendered
 * in the block's place — the one thing this must never do is show a number it did not get.
 */
export function useLandingCatalog(): LandingCatalog {
  const [state, setState] = useState<CatalogState>('loading');
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);
  // named for the summary, not `api` — that is the client this module already imports
  const [contract, setContract] = useState<ApiSummary | null>(null);

  useEffect(() => {
    let live = true;
    // The contract is fetched on its own so a missing document costs the API block and not the
    // catalogue block.
    fetch('/v1/openapi.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((doc) => {
        if (live) setContract(summariseApi(doc));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([api.listFlows(), api.listModels({ limit: 500 })])
      .then(([f, m]) => {
        if (!live) return;
        setFlows(f.flows ?? []);
        setModels(m.models ?? []);
        setState('ready');
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, []);

  return {
    state,
    summary: state === 'ready' ? summariseCatalog(flows, models) : null,
    flows,
    models,
    api: contract,
  };
}
