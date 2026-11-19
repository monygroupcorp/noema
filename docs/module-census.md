# Module census — 2026-11-19

Regenerate with `npm run census:modules` (or `npx tsx scripts/module-census.ts`). Committed
beside the code per codebase-factoring clause 1 — this file is the output of a command, not
hand-maintained prose, and the next run replaces it rather than appending to it.

Scope: every `.ts`/`.tsx` file under `src/`, test files (`*.test.ts(x)`, `*.spec.ts(x)`) and
type-declaration files (`*.d.ts`) excluded. 538 files counted.

## Ten largest modules

| # | Lines | Path |
|---|---:|---|
| 1 | 6338 | `src/allocutio/api/CrystalApi.ts` |
| 2 | 3750 | `src/platforms/web/app/src/lib/muse.ts` |
| 3 | 3382 | `src/platforms/web/app/src/screens/Muse.tsx` |
| 4 | 3207 | `src/allocutio/api/apiContract.ts` |
| 5 | 2176 | `src/platforms/web/app/src/lib/api.ts` |
| 6 | 2021 | `src/index.ts` |
| 7 | 1710 | `src/allocutio/api/apiRouter.ts` |
| 8 | 1666 | `src/crystal/SecurePodClient.ts` |
| 9 | 1370 | `src/allocutio/api/ConciergeAgent.ts` |
| 10 | 1365 | `src/crystal/seeds/essentiae.ts` |

## Ten most duplicated pairs

Line-level Jaccard similarity over non-blank, non-comment-only lines, among files with at least
30 such lines. 1.0 means every significant line in the smaller file also
appears in the larger one (an exact copy or a superset); it does not mean the files are
byte-identical.

| # | Similarity | Shared lines | A | B |
|---|---:|---:|---|---|
| 1 | 52.8% | 57 | `src/platforms/web/app/src/shell/ReportModal.tsx` (139L) | `src/platforms/web/app/src/shell/ReportOutput.tsx` (93L) |
| 2 | 35.5% | 27 | `src/crystal/FfmpegCursor.ts` (100L) | `src/crystal/LayerCompositeCursor.ts` (93L) |
| 3 | 35.1% | 20 | `src/crystal/MongoFundamentorum.ts` (46L) | `src/crystal/MongoModorum.ts` (74L) |
| 4 | 33.7% | 32 | `src/flow/FlowContextStore.ts` (107L) | `src/flow/MongoFlowContextStore.ts` (132L) |
| 5 | 31.8% | 21 | `src/crystal/MemorySecretarium.ts` (62L) | `src/crystal/MongoSecretarium.ts` (88L) |
| 6 | 31.6% | 24 | `src/crystal/MemoryMerces.ts` (64L) | `src/crystal/MongoMerces.ts` (94L) |
| 7 | 31.5% | 17 | `src/crystal/MongoColloquium.ts` (66L) | `src/crystal/MongoCorpus.ts` (59L) |
| 8 | 31.3% | 15 | `src/crystal/MemoryLegatus.ts` (51L) | `src/crystal/MongoLegatus.ts` (52L) |
| 9 | 30.8% | 33 | `src/crystal/MongoRedituum.ts` (175L) | `src/ledger/MemoryRedituum.ts` (108L) |
| 10 | 30.8% | 24 | `src/crystal/MemoryTabula.ts` (72L) | `src/crystal/MongoTabula.ts` (87L) |
