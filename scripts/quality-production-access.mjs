import {createHmac, timingSafeEqual} from 'node:crypto';

// Reuse the existing workbench's signed DingTalk session. No fallback login,
// query-string identity, delegated identity or local bootstrap is accepted.
export function createProductionAccess({secret, userId, origin, allowedUser = id => id === userId}) {
  if (!secret || secret.length < 32 || !userId || !origin) throw new Error('Production access configuration incomplete');
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.origin !== origin) throw new Error('HTTPS origin required');
  return function authenticate(req, now = Date.now()) {
    if (req.headers.origin && req.headers.origin !== origin) return null;
    if (req.headers['sec-fetch-site'] === 'cross-site') return null;
    try {
      const cookies = String(req.headers.cookie || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith('wb_session='));
      if (cookies.length !== 1) return null;
      const parts = cookies[0].slice('wb_session='.length).split('.');
      if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
      const signature = createHmac('sha256', secret).update(parts[0]).digest();
      if (!timingSafeEqual(signature, Buffer.from(parts[1], 'hex'))) return null;
      const session = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      if (!allowedUser(session.userId) || session.loginSource !== 'dingtalk_authcode' || session.impersonation) return null;
      if (session.dingUser?.userId !== session.userId || !Number.isFinite(session.exp) || session.exp * 1000 <= now) return null;
      if (!Number.isFinite(session.iat) || session.iat * 1000 > now + 60000) return null;
      if (!['admin','manager','employee'].includes(session.role)) return null;
      return Object.freeze({userId:session.userId, session});
    } catch { return null; }
  };
}
