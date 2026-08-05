import { useProject, type HoldingKind } from '../state/project';

// The file/re-file affordance (Projects · Decision 3): a compact toggle on a canonical asset
// card that files the asset into (or removes it from) a project's holdings. Targets the given
// project (the scoped one on a `?project=` surface, else the active project). Optimistic;
// backend-backed for identified accounts, local-only for anon. Stops propagation so it never
// triggers the card's own navigation.
const FIELD: Record<HoldingKind, 'datasetIds' | 'modelIds' | 'collectionIds'> = {
  dataset: 'datasetIds', model: 'modelIds', collection: 'collectionIds',
};

export function HoldingToggle({ kind, assetId, projectId }: { kind: HoldingKind; assetId: string; projectId: string }) {
  const { projects, fileAsset, unfileAsset } = useProject();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  const filed = project[FIELD[kind]].includes(assetId);
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (filed) unfileAsset(projectId, kind, assetId);
    else fileAsset(projectId, kind, assetId);
  };
  return (
    <button
      type="button"
      className={`holding-toggle mono${filed ? ' on' : ''}`}
      onClick={toggle}
      title={filed ? `In ${project.name} — click to remove` : `File into ${project.name}`}
    >
      {filed ? '✓' : '＋'} {project.name}
    </button>
  );
}
