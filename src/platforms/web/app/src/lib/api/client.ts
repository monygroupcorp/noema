// Assembles the single `api` client every screen calls, out of the per-concern partials
// defined in the sibling modules. Each partial is this module's default export so it
// doesn't leak into the `lib/api` barrel's re-export surface — only the merged `api`
// below, and the types/standalone functions each concern module exports by name, are
// public.
import accountApi from './account';
import activityApi from './activity';
import adminApi from './admin';
import arcanumApi from './arcanum';
import authApi from './auth';
import collectionsApi from './collections';
import conciergeApi from './concierge';
import datasetsApi from './datasets';
import earningsApi from './earnings';
import flowApi from './flow';
import fundingApi from './funding';
import modelsApi from './models';
import museApi from './muse';
import partnerApi from './partner';
import projectsApi from './projects';
import publishingApi from './publishing';
import pursesApi from './purses';
import querelaApi from './querela';
import { recordEvent, reportClientError } from './session';
import secretsApi from './secrets';
import sponsorshipsApi from './sponsorships';
import statusApi from './status';
import storageApi from './storage';
import studiosApi from './studios';
import tabulaApi from './tabula';
import teamsApi from './teams';
import teeApi from './tee';
import vestigiumApi from './vestigium';

export const api = {
  ...flowApi,
  ...statusApi,
  ...earningsApi,
  ...partnerApi,
  ...conciergeApi,
  ...vestigiumApi,
  ...activityApi,
  ...fundingApi,
  ...collectionsApi,
  ...publishingApi,
  ...adminApi,
  ...pursesApi,
  ...datasetsApi,
  ...museApi,
  ...storageApi,
  ...modelsApi,
  ...teamsApi,
  ...projectsApi,
  ...sponsorshipsApi,
  ...studiosApi,
  ...teeApi,
  ...accountApi,
  ...secretsApi,
  arcanum: arcanumApi,
  auth: authApi,
  ...tabulaApi,
  ...querelaApi,
  // noema/user-behaviour-corpus — see the module-level functions in ./session.
  recordEvent,
  reportClientError,
};
