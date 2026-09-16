import {createHmac, timingSafeEqual} from 'node:crypto';

// The pilot operator can explicitly switch test perspectives. Business APIs
// require the signed active perspective, never a query/header supplied role.
export function createQualityViewAccess({secret, prefix}) {
  if (!secret || secret.length < 32) throw Error('Quality view signing secret required');
  const sign = payload => createHmac('sha256', secret).update('quality-view:' + payload).digest('hex');
  return {
    cookie(identity, view, now = Date.now()) {
      const payload = Buffer.from(JSON.stringify({userId:identity.userId,view,exp:Math.floor(now/1000)+43200})).toString('base64url');
      return `quality_view=${payload}.${sign(payload)}; Path=${prefix}/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`;
    },
    isTong(req, identity, now = Date.now()) {
      if (!identity || identity.session?.impersonation) return false;
      const values = String(req.headers.cookie || '').split(';').map(x=>x.trim()).filter(x=>x.startsWith('quality_view='));
      if (values.length !== 1) return false;
      try {
        const [payload, signature, extra] = values[0].slice(13).split('.');
        if (extra || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(sign(payload),'hex'),Buffer.from(signature,'hex'))) return false;
        const value = JSON.parse(Buffer.from(payload,'base64url').toString());
        return value.userId === identity.userId && value.view === 'tong' && Number.isFinite(value.exp) && value.exp > now/1000;
      } catch { return false; }
    },
  };
}
