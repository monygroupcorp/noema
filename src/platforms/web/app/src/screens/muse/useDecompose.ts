import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { type SetURLSearchParams } from 'react-router-dom';
import { api, type Dataset as DatasetT } from '../../lib/api';
import { useRunStream } from '../../lib/runStream';
import {
  canFireDecompose,
  decomposeCaptionsetId,
  decomposeFailureNote,
  decomposeRunParam,
  decomposeWorkload,
  launchDecomposeJob,
  withDecomposeRunParam,
} from '../../lib/training';

/** The decompose pass Muse offers from its empty state and under the add-images panel:
 *  which captionset it reads, the run it is watching (carried in `?run=`), and the
 *  re-read of the dataset when that run goes terminal. */
export function useDecompose(
  id: string | undefined,
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
  setDatasets: Dispatch<SetStateAction<DatasetT[] | null>>,
) {
  const [decomposeSet, setDecomposeSet] = useState<string | null>(null);
  const [trigger, setTrigger] = useState('');
  const [decomposeRun, setDecomposeRun] = useState<string | null>(() => decomposeRunParam(searchParams));
  const [decomposeStarting, setDecomposeStarting] = useState(false);
  const [decomposeMsg, setDecomposeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const decomposeMountChecked = useRef(false);

  const decomposeStream = useRunStream(decomposeRun ?? undefined);
  const decomposeTerminal = decomposeStream.terminal;
  const decomposing = decomposeStarting || (decomposeRun !== null && decomposeTerminal === null);

  // A `?run=` carried in on mount gets ONE validating fetch — a run that is gone or was never
  // this caller's must clear rather than leave the screen showing a pass that is not running.
  // `useRunStream`'s poll fallback reads a persistent 404 as "still pending", so the check
  // belongs here rather than there.
  useEffect(() => {
    if (decomposeMountChecked.current) return;
    decomposeMountChecked.current = true;
    const carried = decomposeRun;
    if (!carried) return;
    let live = true;
    api.getRun(carried).catch(() => {
      if (!live) return;
      setDecomposeRun(null);
      setSearchParams((prev) => withDecomposeRunParam(prev, null), { replace: true });
      setDecomposeMsg({ ok: false, text: 'that decompose is gone or not yours' });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pass landing. Fragments are written onto the DATASET, so the garden fills through a
  // re-read of the record rather than through the run's own exitus.
  useEffect(() => {
    if (!decomposeRun || decomposeTerminal === null) return;
    if (decomposeTerminal === 'failed') {
      setDecomposeMsg({ ok: false, text: `decompose failed: ${decomposeStream.error ?? 'no reason reported'}` });
      return;
    }
    let live = true;
    void (async () => {
      const { datasets: ds } = await api.listDatasetsFull().catch(() => ({ datasets: [] as DatasetT[] }));
      if (!live) return;
      setDatasets(await api.withDatasetFallback(ds, id));
      setDecomposeMsg({ ok: true, text: 'decompose finished — the garden is built from it' });
    })();
    return () => { live = false; };
  }, [decomposeRun, decomposeTerminal, decomposeStream.error, id]);
  // noema-278 — the whole-set path, off by default and offered from BOTH decompose controls on
  // this screen. An item that already carries fragments has been through the extractor, and a
  // decompose spends one model call per item it runs, so the default pass is the new work only.
  const [redoAll, setRedoAll] = useState(false);

  // A decompose is metered and it runs OFF-REQUEST: the dispatch comes back with a run id and
  // every caption is one chat call from there on. So the button locks for as long as the run is
  // live rather than for as long as a request is open, the state on screen says what is actually
  // happening, and a failure keeps its text. The watch above re-reads the dataset when the run
  // goes terminal, so the garden fills without a refresh.
  async function doDecompose(dataset: DatasetT) {
    const captionsetId = decomposeCaptionsetId(dataset, decomposeSet);
    // With `redo` the workload is the whole pass, so the pending count is not what gates it.
    const pending = redoAll ? undefined : decomposeWorkload(dataset, captionsetId).pending;
    if (!canFireDecompose({ captionsetId, inFlight: decomposing, pending })) return;
    setDecomposeStarting(true);
    setDecomposeMsg(null);
    try {
      const run = await launchDecomposeJob({ datasetId: dataset.id, captionsetId: captionsetId!, trigger, redo: redoAll });
      if (run.status === 'failed') {
        setDecomposeMsg({ ok: false, text: `decompose failed: ${run.failure?.message ?? 'no reason reported'}` });
        return;
      }
      // The dispatch is done, the pass is not: attach to the run and let the watch above finish
      // the story. The id goes into the URL in the same breath, before anything can navigate away.
      setDecomposeRun(run.id);
      setSearchParams((prev) => withDecomposeRunParam(prev, run.id), { replace: true });
      setDecomposeMsg({ ok: true, text: `decompose started · run ${run.id.slice(0, 8)}` });
    } catch (e) {
      // Same reading the dataset screen does: a refusal because one is already running, or
      // because there is nothing left to decompose, is a status rather than a failure.
      setDecomposeMsg({ ok: false, text: decomposeFailureNote(String((e as Error).message)) });
    } finally {
      setDecomposeStarting(false);
    }
  }

  return {
    decomposeSet, setDecomposeSet, trigger, setTrigger, decomposeRun, decomposeStream,
    decomposing, decomposeMsg, redoAll, setRedoAll, doDecompose,
  };
}
