// scripts/check-bundle-budget.mjs
//
// Fails the build when a deployment's Vercel Function bundles grow past budget.
//
// Why this exists: Vercel bills "Function Storage" as the total size of the
// Function bundles across every deployment it retains, and it never deletes the
// 10 most recent production deployments — no retention policy or `vercel remove`
// can go below that floor. So the quota is really
//
//     10 x (size of one deployment)  <=  10GB
//
// which caps a deployment at roughly 1GB and leaves nothing for previews. Issue
// #50 cut a deployment from 4.04GB to 1.47GB, and by the time anyone looked
// again it had drifted back to 1.74GB without a single change that looked like
// it was about bundle size. This script is what makes that drift visible: a
// dependency that pulls in a native binary, or a new import in the middleware,
// shows up as a failing CI job rather than as an over-quota email weeks later.
//
// What it measures: Next writes a .nft.json next to every server entrypoint
// listing the files it traced into that entrypoint. Vercel packages each one
// separately, so a file reached by 50 routes is stored 50 times — summing the
// traces without deduplicating is what matches how the storage is billed.
//
// Usage:  npm run check:bundle    (after `next build`)

import fs from 'node:fs';
import path from 'node:path';

// ~25% headroom over the 249MB measured when this landed. Ten production
// deployments at the budget is 3.2GB, comfortably inside a 10GB quota with room
// for previews. Raise it only with a reason: the point is that it bites.
const MAX_DEPLOYMENT_MB = 320;

// Entrypoints above this are worth a look on their own. The middleware is traced
// separately from the routes and ignores next.config.ts's
// outputFileTracingExcludes, so it is the one most likely to regress quietly.
const MAX_ENTRYPOINT_MB = 20;

const NEXT_DIR = path.join(import.meta.dirname, '..', '.next');

if (!fs.existsSync(NEXT_DIR)) {
  console.error('No .next directory — run `next build` first.');
  process.exit(1);
}

/** Every *.nft.json Next emitted, i.e. one per deployed entrypoint. */
function findTraces(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTraces(full));
    else if (entry.name.endsWith('.nft.json')) out.push(full);
  }
  return out;
}

const sizes = new Map();
function sizeOf(file) {
  if (!sizes.has(file)) {
    let bytes = 0;
    // A trace can name a file that no longer exists (or that an exclude
    // removed); those cost nothing, so count them as zero rather than throwing.
    try { bytes = fs.statSync(file).size; } catch { /* counted as 0 */ }
    sizes.set(file, bytes);
  }
  return sizes.get(file);
}

/** "node_modules/@scope/name" or "(app code)" — for the breakdown only. */
function packageOf(file) {
  const at = file.lastIndexOf('node_modules/');
  if (at < 0) return '(app code)';
  const parts = file.slice(at + 'node_modules/'.length).split('/');
  return 'node_modules/' + (parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
}

const traces = findTraces(NEXT_DIR);
if (traces.length === 0) {
  console.error('No .nft.json trace files under .next — was this a server build?');
  process.exit(1);
}

const entrypoints = [];
const byPackage = new Map();

for (const trace of traces) {
  const base = path.dirname(trace);
  const files = JSON.parse(fs.readFileSync(trace, 'utf8')).files
    .map((f) => path.resolve(base, f));

  let total = 0;
  for (const file of files) {
    const bytes = sizeOf(file);
    total += bytes;
    const pkg = packageOf(file);
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + bytes);
  }

  entrypoints.push({ name: path.relative(NEXT_DIR, trace).replace(/\.nft\.json$/, ''), total });
}

const MB = 1024 * 1024;
const mb = (bytes) => (bytes / MB).toFixed(1).padStart(7) + 'MB';

const deploymentBytes = entrypoints.reduce((sum, e) => sum + e.total, 0);
entrypoints.sort((a, b) => b.total - a.total);

console.log(`Entrypoints: ${entrypoints.length}`);
console.log(`Deployment size: ${mb(deploymentBytes).trim()} (budget ${MAX_DEPLOYMENT_MB}MB)\n`);

console.log('Largest entrypoints:');
for (const e of entrypoints.slice(0, 5)) console.log(` ${mb(e.total)}  ${e.name}`);

console.log('\nLargest contributors, summed across every entrypoint:');
for (const [pkg, bytes] of [...byPackage].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(` ${mb(bytes)}  ${pkg}`);
}

const oversized = entrypoints.filter((e) => e.total > MAX_ENTRYPOINT_MB * MB);
const overBudget = deploymentBytes > MAX_DEPLOYMENT_MB * MB;

if (oversized.length > 0) {
  console.error(`\nEntrypoints over ${MAX_ENTRYPOINT_MB}MB:`);
  for (const e of oversized) console.error(` ${mb(e.total)}  ${e.name}`);
}

if (overBudget) {
  console.error(
    `\nFAIL: a deployment is ${(deploymentBytes / MB).toFixed(1)}MB, over the ` +
    `${MAX_DEPLOYMENT_MB}MB budget. Vercel keeps the last 10 production ` +
    `deployments permanently, so this is ~${(deploymentBytes * 10 / MB / 1024).toFixed(1)}GB ` +
    `of Function Storage that no amount of pruning can reclaim.\n` +
    `See the outputFileTracingExcludes comment in next.config.ts.`,
  );
  process.exit(1);
}

if (oversized.length > 0) {
  console.error('\nFAIL: see the oversized entrypoints above.');
  process.exit(1);
}

console.log('\nOK — within budget.');
