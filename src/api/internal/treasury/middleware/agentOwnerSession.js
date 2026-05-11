// src/api/internal/treasury/middleware/agentOwnerSession.js
//
// Verifies the HS256 session JWTs issued by VerifyService after a successful
// challenge/verify flow. Sets req.agentSession on success.
//
// Env var: AGENT_SESSION_SECRET

const jwt = require('jsonwebtoken');

/**
 * @param {{ required?: boolean }} [options]
 */
function agentOwnerSession({ required = true } = {}) {
    return function agentOwnerSessionMiddleware(req, res, next) {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!token) {
            if (!required) { req.agentSession = null; return next(); }
            return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization Bearer token required' } });
        }

        const secret = process.env.AGENT_SESSION_SECRET;
        if (!secret) {
            return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } });
        }

        try {
            const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
            if (payload.tier !== 'agent_owner') {
                return res.status(403).json({ error: { code: 'WRONG_TIER', message: 'This endpoint requires an agent_owner session JWT' } });
            }
            req.agentSession = {
                agentId: payload.sub,
                ownerAddress: payload.ownerAddress,
                chainId: payload.chainId,
            };
            next();
        } catch (err) {
            const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
            return res.status(401).json({ error: { code, message: err.message } });
        }
    };
}

module.exports = { agentOwnerSession };
