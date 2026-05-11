// src/api/widget/widgetApi.js
//
// Embeddable widget surface — served at /widget/*.
//
// Routes:
//   GET  /sdk.js                   — browser SDK (CORS: *)
//   GET  /:agentId                 — iframe mini-app HTML shell
//   GET  /:agentId/workspace       — workspace + spells JSON (CORS: *)
//   POST /:agentId/auth/challenge  — public EIP-712 challenge relay (CORS: *)
//   POST /:agentId/auth/verify     — public verify + session JWT relay (CORS: *)
//
// The auth endpoints are public-facing relays to the same services used by the
// internal treasury API.  They bypass the internal-API key requirement so that
// the browser SDK running on third-party sites can authenticate agent owners.

'use strict';

const fs      = require('fs');
const path    = require('path');
const express = require('express');

const { OnChainVerifier } = require('../../core/services/agents/OnChainVerifier');
const { ChallengeService } = require('../../core/services/agents/ChallengeService');
const { VerifyService }    = require('../../core/services/agents/VerifyService');

const SDK_PATH = path.join(__dirname, 'sdk.browser.js');

// ── CORS helper ────────────────────────────────────────────────────────────────

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Iframe mini-app HTML ───────────────────────────────────────────────────────

function buildAppHtml(agentId, mode) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>StationThis Agent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e8e8e8; height: 100vh; overflow: hidden; }
  #root { display: flex; flex-direction: column; height: 100vh; }
  #status { padding: 8px 12px; font-size: 11px; color: #666; border-bottom: 1px solid #1a1a1a; }
  #content { flex: 1; overflow: auto; padding: 16px; }
  .loading { color: #555; font-size: 13px; }
  .spell-item { padding: 10px 14px; border: 1px solid #222; border-radius: 6px; margin-bottom: 8px; cursor: pointer; }
  .spell-item:hover { border-color: #444; background: #111; }
  .spell-name { font-size: 14px; font-weight: 500; }
  .spell-desc { font-size: 12px; color: #666; margin-top: 3px; }
  .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .gallery-item img { width: 100%; border-radius: 4px; }
  .canvas-note { color: #555; font-size: 13px; text-align: center; padding: 40px 20px; }
</style>
</head>
<body>
<div id="root">
  <div id="status">Connecting…</div>
  <div id="content"><p class="loading">Waiting for authentication…</p></div>
</div>
<script>
(function() {
  'use strict';
  var AGENT_ID  = ${JSON.stringify(agentId)};
  var BASE_URL  = window.location.origin;
  var _mode     = ${JSON.stringify(mode)};
  var _jwt      = null;
  var _ws       = null;

  var $status  = document.getElementById('status');
  var $content = document.getElementById('content');

  function setStatus(txt) { $status.textContent = txt; }
  function setContent(html) { $content.innerHTML = html; }

  // ── postMessage bridge ────────────────────────────────────────────────────
  window.addEventListener('message', function(evt) {
    // Accept messages from parent only
    var msg = evt.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'SESSION_READY') {
      _jwt = msg.sessionJwt;
      setStatus('Authenticated');
      loadWorkspace();
    } else if (msg.type === 'AUTH_ERROR') {
      setStatus('Auth failed: ' + msg.error);
      setContent('<p class="loading">Authentication failed: ' + msg.error + '</p>');
    } else if (msg.type === 'SET_MODE') {
      _mode = msg.mode;
      if (_ws) render(_ws);
    } else if (msg.type === 'CAST_SPELL') {
      castSpell(msg.spellSlug, msg.inputs);
    }
  });

  // Signal that we are ready for the auth handshake
  window.parent.postMessage({ type: 'WIDGET_READY' }, '*');

  // ── Workspace loading ─────────────────────────────────────────────────────
  function loadWorkspace() {
    setContent('<p class="loading">Loading workspace…</p>');
    fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/workspace', {
      headers: _jwt ? { 'Authorization': 'Bearer ' + _jwt } : {},
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _ws = data;
      render(_ws);
    })
    .catch(function(err) {
      setContent('<p class="loading">Failed to load workspace: ' + err.message + '</p>');
    });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function render(ws) {
    if (_mode === 'list')    return renderList(ws);
    if (_mode === 'gallery') return renderGallery(ws);
    renderCanvas(ws);
  }

  function renderList(ws) {
    var spells = ws.spells || [];
    if (!spells.length) {
      setContent('<p class="loading">No spells configured.</p>');
      return;
    }
    var html = spells.map(function(s) {
      return '<div class="spell-item" data-slug="' + s.slug + '">'
        + '<div class="spell-name">' + esc(s.name) + '</div>'
        + (s.description ? '<div class="spell-desc">' + esc(s.description) + '</div>' : '')
        + '</div>';
    }).join('');
    setContent(html);
    $content.querySelectorAll('.spell-item').forEach(function(el) {
      el.addEventListener('click', function() {
        castSpell(el.dataset.slug, {});
      });
    });
  }

  function renderGallery(ws) {
    var outputs = ws.recentOutputs || [];
    if (!outputs.length) {
      setContent('<p class="loading">No outputs yet.</p>');
      return;
    }
    var html = '<div class="gallery-grid">'
      + outputs.map(function(o) {
          return '<div class="gallery-item"><img src="' + esc(o.url) + '" loading="lazy"></div>';
        }).join('')
      + '</div>';
    setContent(html);
  }

  function renderCanvas(ws) {
    // Canvas mode — full workspace UI. Visual implementation done at staging.
    var count = (ws.spells || []).length;
    setContent('<div class="canvas-note">Canvas mode — '
      + count + ' spell' + (count !== 1 ? 's' : '') + ' in this workspace.'
      + '<br><br>Tap a spell node to run it.</div>');
    window.parent.postMessage({ type: 'WORKSPACE_LOADED', workspace: ws }, '*');
  }

  // ── Spell execution ───────────────────────────────────────────────────────
  function castSpell(slug, inputs) {
    window.parent.postMessage({ type: 'SPELL_STARTED', spellSlug: slug }, '*');
    fetch(BASE_URL + '/api/v1/spells/' + encodeURIComponent(slug) + '/cast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + _jwt,
      },
      body: JSON.stringify({ inputs: inputs }),
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
      window.parent.postMessage({ type: 'SPELL_CAST', result: result }, '*');
    })
    .catch(function(err) {
      window.parent.postMessage({ type: 'SPELL_ERROR', error: err.message }, '*');
    });
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
})();
</script>
</body>
</html>`;
}

// ── Router factory ─────────────────────────────────────────────────────────────

/**
 * @param {{ db, logger }} deps
 * @returns {express.Router}
 */
function createWidgetApi(deps = {}) {
    const router = express.Router();
    const logger = deps.logger || console;

    // Shared auth services (one instance per router, in-memory state)
    const onChainVerifier = new OnChainVerifier({ logger });
    const challengeService = new ChallengeService();
    const verifySvc = new VerifyService({ challengeService, onChainVerifier, logger });

    // Allow CORS preflight for all widget routes
    router.options('*', (req, res) => { cors(res); res.sendStatus(204); });

    // ── SDK ──────────────────────────────────────────────────────────────────

    router.get('/sdk.js', (req, res) => {
        cors(res);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.sendFile(SDK_PATH);
    });

    // ── Helper ───────────────────────────────────────────────────────────────

    async function findAgent(agentId) {
        return deps.db?.userCore?.findByAgentId(agentId) || null;
    }

    function handleErr(res, err, label) {
        logger.error(`[WidgetApi] ${label}: ${err.message}`);
        const map = {
            NOT_FOUND: 404, INVALID_PARAMS: 400,
            CHALLENGE_NOT_FOUND: 400, CHALLENGE_EXPIRED: 400, INVALID_NONCE: 400,
            INVALID_SIGNATURE: 400, OWNERSHIP_MISMATCH: 403, CONFIG_ERROR: 500,
        };
        res.status(map[err.code] || 500).json({ error: { code: err.code || 'INTERNAL_ERROR', message: err.message } });
    }

    // ── Auth relay ───────────────────────────────────────────────────────────

    router.post('/:agentId/auth/challenge', async (req, res) => {
        cors(res);
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
            res.json(verifySvc.issueChallenge(agentDoc));
        } catch (err) { handleErr(res, err, 'POST challenge'); }
    });

    router.post('/:agentId/auth/verify', async (req, res) => {
        cors(res);
        try {
            const { nonce, signature } = req.body;
            if (!nonce || !signature) {
                return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'nonce and signature are required' } });
            }
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
            const result = await verifySvc.verify(agentDoc, { nonce, signature });
            res.json(result);
        } catch (err) { handleErr(res, err, 'POST verify'); }
    });

    // ── Workspace data ───────────────────────────────────────────────────────

    router.get('/:agentId/workspace', async (req, res) => {
        cors(res);
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

            const slug = agentDoc.starterWorkspaceSlug;
            if (!slug) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent has no starter workspace' } });

            const workspace = await deps.db?.workspaces?.findBySlug(slug);
            if (!workspace) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });

            // Resolve spells referenced in tool windows
            const spells = [];
            const toolWindows = workspace.toolWindows || [];
            for (const win of toolWindows) {
                if (win.spellRef && deps.db?.spells) {
                    try {
                        const spell = await deps.db.spells.findBySlug(win.spellRef);
                        if (spell) {
                            spells.push({
                                slug:        spell.slug,
                                name:        spell.name,
                                description: spell.description || null,
                                windowId:    win.id,
                            });
                        }
                    } catch (e) {
                        logger.warn(`[WidgetApi] Could not resolve spell ${win.spellRef}: ${e.message}`);
                    }
                }
            }

            res.json({
                agentId:       agentDoc.agentId,
                workspaceSlug: slug,
                toolWindows,
                connections:   workspace.connections || [],
                spells,
                recentOutputs: [], // populated in a future pass once outputs DB is wired
            });
        } catch (err) { handleErr(res, err, 'GET workspace'); }
    });

    // ── Iframe mini-app ──────────────────────────────────────────────────────

    router.get('/:agentId', async (req, res) => {
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).send('Agent not found');

            const mode = ['canvas', 'list', 'gallery'].includes(req.query.mode)
                ? req.query.mode
                : 'canvas';

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('X-Frame-Options', 'ALLOWALL');
            res.setHeader('Content-Security-Policy', "frame-ancestors *");
            res.send(buildAppHtml(req.params.agentId, mode));
        } catch (err) {
            logger.error(`[WidgetApi] GET /:agentId: ${err.message}`);
            res.status(500).send('Internal server error');
        }
    });

    return router;
}

module.exports = { createWidgetApi };
