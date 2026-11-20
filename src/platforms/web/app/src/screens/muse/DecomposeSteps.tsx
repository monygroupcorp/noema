import { type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { type Dataset as DatasetT } from '../../lib/api';
import { AddImages } from '../../components/AddImages';
import { RunStageline } from '../../components/RunStageline';
import {
  canOfferDecompose,
  decomposeCaptionsetId,
  decomposePlanNote,
  decomposeWorkload,
} from '../../lib/training';
import {
  captionCoverageLine,
  captionPassLabel,
  captionPassNote,
  decomposeGateReason,
  replaceDataset,
} from '../../lib/muse';
import { type useCaptionPass } from './useCaptionPass';
import { type useDecompose } from './useDecompose';

type Decompose = ReturnType<typeof useDecompose>;
type CaptionPass = ReturnType<typeof useCaptionPass>;

/** What an appended image still needs: the caption pass to read it and the decompose
 *  that turns those captions into fragments. Rendered under the add-images panel. */
export function AppendNextSteps({
  d, nextCaptionsetId, decomposing, setDecomposeSet, captioning, doCaption, captionMsg,
  refreshDatasets, trigger, setTrigger, decomposeArmed, doDecompose, redoAll, decomposeGate,
  decomposeWork, redoToggle, decomposeMsg,
}: {
  d: DatasetT;
  nextCaptionsetId: ReturnType<typeof decomposeCaptionsetId>;
  decomposing: Decompose['decomposing'];
  setDecomposeSet: Decompose['setDecomposeSet'];
  captioning: CaptionPass['captioning'];
  doCaption: CaptionPass['doCaption'];
  captionMsg: CaptionPass['captionMsg'];
  refreshDatasets: CaptionPass['refreshDatasets'];
  trigger: Decompose['trigger'];
  setTrigger: Decompose['setTrigger'];
  decomposeArmed: boolean;
  doDecompose: Decompose['doDecompose'];
  redoAll: Decompose['redoAll'];
  decomposeGate: ReturnType<typeof decomposeGateReason>;
  decomposeWork: ReturnType<typeof decomposeWorkload>;
  redoToggle: ReactNode;
  decomposeMsg: Decompose['decomposeMsg'];
}) {
  return (
    <div className="muse-add-next">
      <label className="cc-field"><span>Caption pass</span>
        <select className="cer-input" value={nextCaptionsetId ?? ''}
          disabled={d.captionsets.length === 0 || decomposing}
          onChange={(e) => setDecomposeSet(e.target.value)}>
          {d.captionsets.length === 0 && <option value="">no caption pass yet</option>}
          {d.captionsets.map((cs) => (
            <option key={cs.id} value={cs.id}>{cs.name} · {cs.coverage}</option>
          ))}
        </select>
      </label>

      <div className="muse-add-readout mono">{captionCoverageLine(d, nextCaptionsetId)}</div>

      <div className="muse-add-step">
        <button type="button" className="btn ghost sm" disabled={captioning} onClick={() => void doCaption(d)}>
          {captioning ? 'starting…' : captionPassLabel(d)}
        </button>
        <span className="gt-sub mono">{captionPassNote(d)}</span>
      </div>
      {captionMsg && (
        <div className="gt-sub mono">
          {captionMsg.text}
          {captionMsg.runId && <> · <Link to={`/run?id=${captionMsg.runId}`}>open run view →</Link></>}
          {captionMsg.ok && <> · <button type="button" className="linkish" onClick={() => void refreshDatasets()}>re-read the set</button></>}
        </div>
      )}
      {/* The pass started here is the same run the caption screen watches, so it gets the same
          readout rather than a second one: the pod's phases while it provisions and prepares, and
          its per-image count once it is reading images. */}
      {captionMsg?.ok && captionMsg.runId && <RunStageline runId={captionMsg.runId} />}

      <label className="cc-field"><span>Trigger word to strip (optional)</span>
        <input className="cer-input" value={trigger} disabled={decomposing}
          onChange={(e) => setTrigger(e.target.value)}
          placeholder="keeps fragments reusable" />
      </label>
      <div className="muse-add-step">
        <button type="button" className="btn accent sm"
          disabled={!decomposeArmed}
          onClick={() => void doDecompose(d)}>
          {decomposing ? 'Decomposing…' : redoAll ? 'Re-decompose this pass →' : 'Decompose this pass →'}
        </button>
        <span className="gt-sub mono">
          {decomposeGate ?? decomposePlanNote(decomposeWork, redoAll)}
        </span>
      </div>
      {redoToggle}
      {decomposeMsg && <div className="gt-sub mono">{decomposeMsg.text}</div>}
    </div>
  );
}

/** The empty garden: a dataset nobody has decomposed yet, with the decompose offered when
 *  it has captions to read and the add-images panel either way. */
export function DecomposeEmptyState({
  d, decomposeSet, setDecomposeSet, decomposing, trigger, setTrigger, redoToggle,
  decomposeArmed, doDecompose, redoAll, decomposeGate, decomposeRun, decomposeStream,
  decomposeWork, decomposeMsg, addOpen, setAddOpen, setDatasets,
}: {
  d: DatasetT;
  decomposeSet: Decompose['decomposeSet'];
  setDecomposeSet: Decompose['setDecomposeSet'];
  decomposing: Decompose['decomposing'];
  trigger: Decompose['trigger'];
  setTrigger: Decompose['setTrigger'];
  redoToggle: ReactNode;
  decomposeArmed: boolean;
  doDecompose: Decompose['doDecompose'];
  redoAll: Decompose['redoAll'];
  decomposeGate: ReturnType<typeof decomposeGateReason>;
  decomposeRun: Decompose['decomposeRun'];
  decomposeStream: Decompose['decomposeStream'];
  decomposeWork: ReturnType<typeof decomposeWorkload>;
  decomposeMsg: Decompose['decomposeMsg'];
  addOpen: boolean;
  setAddOpen: Dispatch<SetStateAction<boolean>>;
  setDatasets: Dispatch<SetStateAction<DatasetT[] | null>>;
}) {
  return (
    <div className="empty">
      <div className="t">Nothing has been decomposed yet</div>
      {canOfferDecompose(d) ? (
        <>
          <div className="s">
            Muse rolls prompts from decomposed captions. This dataset has captions — decompose a
            captionset to grow the garden.
          </div>
          <div className="muse-decompose">
            <label className="cc-field"><span>Captionset</span>
              <select className="cer-input" value={decomposeCaptionsetId(d, decomposeSet) ?? ''}
                disabled={decomposing}
                onChange={(e) => setDecomposeSet(e.target.value)}>
                {d.captionsets.map((cs) => (
                  <option key={cs.id} value={cs.id}>{cs.name} · {cs.coverage}</option>
                ))}
              </select>
            </label>
            <label className="cc-field"><span>Trigger word to strip (optional)</span>
              <input className="cer-input" value={trigger} disabled={decomposing}
                onChange={(e) => setTrigger(e.target.value)}
                placeholder="keeps fragments reusable" />
            </label>
            {redoToggle}
            <button className="btn accent"
              disabled={!decomposeArmed}
              onClick={() => void doDecompose(d)}>
              {decomposing ? 'Decomposing…' : redoAll ? 'Re-decompose these captions →' : 'Decompose these captions →'}
            </button>
          </div>
          <div className="muse-decompose-note mono">
            {decomposeGate ?? (decomposing
              ? `reading every caption left to decompose — one pass per caption, and it keeps going on our side whether or not this page is open${decomposeRun ? ` · run ${decomposeRun.slice(0, 8)}, ${decomposeStream.elapsedSec}s elapsed` : ''}`
              : decomposePlanNote(decomposeWork, redoAll))}
          </div>
          {decomposeMsg && <div className="muse-decompose-note mono">{decomposeMsg.text}</div>}
        </>
      ) : (
        <div className="s">
          Muse rolls prompts from decomposed captions — this dataset has none yet. Caption it, then
          decompose those captions to grow the garden.
        </div>
      )}
      {/* V7's other exit, offered from the coldest start there is: the set itself can
          be widened from here, not only the floor. */}
      <AddImages
        dataset={d}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAppended={(updated) => setDatasets((ds) => replaceDataset(ds, updated))}
        next={null}
      />
      <Link className={canOfferDecompose(d) ? 'btn ghost' : 'btn accent'} to={`/datasets/${d.id}`}>← back to {d.name}</Link>
    </div>
  );
}
