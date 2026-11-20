import { useState, type Dispatch, type SetStateAction } from 'react';
import { api, type Dataset as DatasetT } from '../../lib/api';
import { launchCaptionJob } from '../../lib/training';
import { errText } from './errText';

/** Starting a caption pass over the set, and re-reading the set once that pass has
 *  written its captionset back. */
export function useCaptionPass(
  id: string | undefined,
  setDatasets: Dispatch<SetStateAction<DatasetT[] | null>>,
) {
  const [captioning, setCaptioning] = useState(false);
  const [captionMsg, setCaptionMsg] = useState<{ ok: boolean; text: string; runId?: string } | null>(null);

  // A caption pass is a normal metered run and it is ASYNCHRONOUS — it provisions a pod
  // and the captionset lands on the set when the pass finishes, so this returns at
  // dispatch rather than at completion. The screen says that instead of implying the
  // captions are already there, and offers the re-read that picks the new pass up.
  async function doCaption(dataset: DatasetT) {
    if (captioning) return;
    setCaptioning(true);
    setCaptionMsg(null);
    try {
      const run = await launchCaptionJob({ datasetId: dataset.id });
      setCaptionMsg({
        ok: true,
        runId: run.id,
        text: 'captioning started — it runs on a pod, and the new pass lands on this set when it finishes',
      });
    } catch (e) {
      setCaptionMsg({ ok: false, text: `couldn't start captioning: ${errText(e)}` });
    } finally {
      setCaptioning(false);
    }
  }

  // Re-read the set. The caption pass writes back out-of-band, so this is how its
  // captionset (and every pass' recomputed coverage) reaches the screen.
  async function refreshDatasets() {
    try {
      const { datasets: ds } = await api.listDatasetsFull();
      setDatasets(await api.withDatasetFallback(ds, id));
    } catch (e) {
      setCaptionMsg({ ok: false, text: `couldn't re-read the set: ${errText(e)}` });
    }
  }

  return { captioning, captionMsg, doCaption, refreshDatasets };
}
