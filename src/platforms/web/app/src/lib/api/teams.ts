import { j, namedOnly } from './core';
import { authHeaders, readHeaders } from './session';

// A team (Sodalitas) — GET/POST /v1/teams. Members co-own work; founder is the first member.
export interface Team {
  id: string;
  nomen: string;
  members: string[];
  founder: string;
  createdAt: string;
}

const NO_TEAMS = { status: 403, code: 'auth.forbidden', message: 'teams require an identified account' };

const teamsApi = {
  // ── Teams (Sodalitas) — a fellowship of Animae that co-owns work ─────────────
  // All member-scoped; identified accounts only. Founder is the first member.
  // Named-account only (see namedOnly): without a session the 403 is settled client-side.
  listTeams: () => namedOnly(NO_TEAMS, () => fetch('/v1/teams', { headers: readHeaders() }).then(j<{ teams: Team[] }>)),
  getTeam: (id: string) => fetch(`/v1/teams/${encodeURIComponent(id)}`, { headers: readHeaders() }).then(j<{ team: Team }>),
  createTeam: (body: { nomen: string; members?: string[] }) =>
    fetch('/v1/teams', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(j<{ team: Team }>),
  addTeamMember: (id: string, animaId: string) =>
    fetch(`/v1/teams/${encodeURIComponent(id)}/members`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ animaId }) }).then(j<{ team: Team }>),
  removeTeamMember: (id: string, animaId: string) =>
    fetch(`/v1/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(animaId)}`, { method: 'DELETE', headers: authHeaders() }).then(j<{ team: Team }>),
};

export default teamsApi;
