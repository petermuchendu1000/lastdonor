// Replicates src/middleware.ts PUBLIC_API_PREFIXES + isPublicApiRoute (startsWith)
// and classifies every real route path in the repo.
import { execSync } from 'node:child_process';

const PUBLIC_API_PREFIXES = [
  '/api/auth','/api/v1/campaigns','/api/v1/blog','/api/v1/newsletter','/api/v1/auth',
  '/api/v1/donations/webhook','/api/v1/donations/confirm','/api/v1/donations/create-checkout',
  '/api/v1/stripe-connect/webhook','/api/v1/health','/api/v1/stats','/api/v1/search',
  '/api/v1/cron','/api/v1/og','/api/v1/campaign-photos',
];
const isPublic = (p) => PUBLIC_API_PREFIXES.some((x) => p.startsWith(x));

const files = execSync('find /home/user/lastdonor/src/app/api -name route.ts', {encoding:'utf8'})
  .trim().split('\n').sort();

const rows = [];
for (const f of files) {
  const src = execSync(`cat ${JSON.stringify(f)}`, {encoding:'utf8'});
  const methods = [...src.matchAll(/export\s+(?:const|async function)\s+(GET|POST|PUT|PATCH|DELETE)/g)].map(m=>m[1]);
  const path = f.replace('/home/user/lastdonor/src/app','').replace(/\/route\.ts$/,'');
  const hasOwnAuthz = /requireAuthRole|requireAuth\b|requireRole|verifyCronAuth|constructEvent|session\?\.user|session\.user\?\.id/.test(src);
  if (isPublic(path)) rows.push({path, methods: methods.join(','), ownAuthz: hasOwnAuthz});
}
console.log('--- PUBLIC (middleware-exempt) routes ---');
for (const r of rows) {
  const mutating = r.methods.split(',').some(m=>['POST','PUT','PATCH','DELETE'].includes(m));
  console.log(
    (r.ownAuthz ? 'authz-in-handler ' : '*** NO AUTHZ ***  ') +
    (mutating ? '[MUTATING] ' : '[read-only] ') + r.path + '  {' + r.methods + '}');
}
