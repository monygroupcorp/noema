// Typed client for the Crystal /v1 API. Endpoints proven in the spike research.
// Phase 0: structure + a few live calls; screens still mostly use local mock data
// until each is wired. Dev server proxies /v1 + /api to the backend.
//
// Split by concern under ./api/ — this file is now a barrel: every name that was
// importable from here stays importable from here, re-exported from whichever
// concern module now owns it. `api` itself (the merged client object every screen
// calls) is assembled in ./api/client from each concern's partial.

export type { SseHandle } from './api/core';
export {
  namedOnly,
  READ_TIMEOUT_MS,
  READ_TIMEOUT_MESSAGE,
  withReadTimeout,
  sseStream,
  ApiRequestError,
} from './api/core';

export type { StoredAccount, SessionStore, BehaviourEventKind } from './api/session';
export {
  commitment,
  setActivePurse,
  getActivePurse,
  setPendingToken,
  getAccounts,
  getSession,
  upsertAccount,
  setActiveAnimaId,
  dropAccount,
  dropActiveAccount,
  clearAllAccounts,
  takeLegacySession,
  recordEvent,
  reportClientError,
} from './api/session';

export * from './api/querela';
export * from './api/flow';
export * from './api/concierge';
export * from './api/vestigium';
export * from './api/activity';
export * from './api/funding';
export * from './api/collections';
export * from './api/publishing';
export * from './api/admin';
export * from './api/partner';
export * from './api/purses';
export * from './api/datasets';
export * from './api/muse';
export * from './api/storage';
export * from './api/models';
export * from './api/teams';
export * from './api/projects';
export * from './api/sponsorships';
export * from './api/studios';
export * from './api/tee';
export * from './api/account';
export * from './api/secrets';
export * from './api/status';
export * from './api/earnings';
export * from './api/arcanum';
export * from './api/auth';
export * from './api/tabula';

export * from './api/client';
