import { useEffect, useState } from 'react';
import { api, type FlowSummary, type ModelCard, type Pack } from '../lib/api';

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
  /** The model families the platform runs, alphabetical. The roster — what a competitor would
   *  put up as a wall of borrowed logos, and what we can state as fact instead. */
  families: string[];
  /** What those identities were trained on, commonest base first. Aggregate rather than a list
   *  of names: it answers what people actually build on here, and it does not put a stranger's
   *  slug on the front page. */
  bases: Tally[];
}

/**
 * The family a model belongs to, from its own name.
 *
 * The catalogue stores what it runs, precisely: `Wan2.2 T2V — high-noise unet (14B, fp8 scaled)`.
 * A roster wants the family, once — `Wan` — not four quantisations of it. So the name is cut at
 * its first qualifier, reduced to its leading token, and stripped of a trailing version.
 *
 * It is approximate on purpose, and it is derived rather than listed: a hand-kept roster is a
 * second place the truth lives, and it goes stale the first time someone adds a model.
 */
export function modelFamily(nomen: string): string {
  const head = nomen.split(/\s+—\s+| \(/)[0].trim();
  if (/^Stable Diffusion/i.test(head)) return 'Stable Diffusion';
  const first = head.split(/\s+/)[0] ?? '';
  // `FLUX.2` and `Wan2.2` are the same families as `FLUX.1` and `Wan`; `Z-Image` and `Qwen3-VL`
  // carry no trailing version and are left whole.
  return first.replace(/[\d.]+$/, '') || first;
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
    families: [
      ...new Set(models.filter((m) => m.genus === 'model' && m.nomen).map((m) => modelFamily(m.nomen))),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
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

/** What a credit pack costs, and what it buys. Read from the same catalogue the checkout
 *  charges against, so the landing page cannot quote a price the till does not honour.
 *
 *  `creditsPerUsd` is derived here rather than served: it is the only number on the block that
 *  answers "is a bigger pack better", and deriving it means it cannot disagree with the pair it
 *  came from. */
export interface PackRate extends Pack {
  creditsPerUsd: number;
}

export function ratePacks(packs: Pack[]): PackRate[] {
  return packs
    .filter((p) => p.usd > 0 && p.credits > 0)
    .map((p) => ({ ...p, creditsPerUsd: p.credits / p.usd }))
    .sort((a, b) => a.usd - b.usd);
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
  /** The sellable credit packs, cheapest first. Empty until they load, and empty for good if
   *  they cannot be read — the pricing block renders nothing rather than a guessed price. */
  packs: PackRate[];
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
  const [packs, setPacks] = useState<PackRate[]>([]);

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

  // Packs are fetched on their own for the same reason the contract is: an unreachable till
  // costs the pricing block and nothing else.
  useEffect(() => {
    let live = true;
    api
      .listPacks()
      .then((p) => {
        if (live) setPacks(ratePacks(p ?? []));
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
    packs,
  };
}
