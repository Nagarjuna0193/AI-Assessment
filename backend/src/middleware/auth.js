const config = require('../config');
const authService = require('../services/authService');

// Gates org-user-facing routes (reviewer dashboard API). Reads the session
// JWT from an httpOnly cookie rather than a header, since the frontend is a
// browser dashboard, not another service.
function requireOrgAuth(req, res, next) {
  const token = req.cookies && req.cookies[config.sessionCookieName];
  if (!token) {
    return res.status(401).json({ error: 'auth_required', message: 'Login required' });
  }

  try {
    const payload = authService.verifySessionToken(token);
    req.orgUser = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'auth_required', message: 'Session expired or invalid' });
  }
}

// Gates a route to a specific org_user role (e.g. ADMIN for creating
// templates/inviting candidates). Must run after requireOrgAuth.
function requireOrgRole(role) {
  return (req, res, next) => {
    if (!req.orgUser || req.orgUser.role !== role) {
      return res.status(403).json({ error: 'forbidden', message: `${role} role required` });
    }
    next();
  };
}

// Gates ops-only routes (org/org_user provisioning, credit grants) — a
// shared secret, deliberately separate from org-user auth so an org admin
// can never grant their own org credits. See docs/DECISIONS.md.
function requireOpsKey(req, res, next) {
  const key = req.get('x-ops-key');
  if (!config.opsApiKey || !key || key !== config.opsApiKey) {
    return res.status(401).json({ error: 'ops_auth_required', message: 'Valid x-ops-key header required' });
  }
  next();
}

module.exports = { requireOrgAuth, requireOrgRole, requireOpsKey };
