#!/usr/bin/env node
/** Regenerate the derived traceability summary in a plan artifact. */

import fs from 'fs';
import { parseArgs } from 'util';
import { artifactPath, readManifest, renderTraceabilitySummary, traceabilityReport } from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    id: { type: 'string' },
    write: { type: 'boolean', default: false },
  },
  strict: true,
});

const usage = 'Usage: traceability-sync.mjs --id <id> [--write]';
if (values.help) { console.log(usage); process.exit(0); }
if (!values.id) { console.error(usage); process.exit(1); }

try {
  const manifest = readManifest(values.id, process.cwd());
  const planPath = artifactPath(manifest, 'plan', process.cwd());
  if (!fs.existsSync(planPath)) throw new Error(`plan artifact does not exist: ${planPath}`);
  const summary = renderTraceabilitySummary(traceabilityReport(manifest, process.cwd()));
  const plan = fs.readFileSync(planPath, 'utf8');
  const current = plan.match(/<!-- traceability:start -->\n[\s\S]*?\n<!-- traceability:end -->/m)?.[0];
  if (!current) throw new Error('plan.md is missing traceability markers from the canonical template');
  const changed = current !== summary;
  if (values.write && changed) fs.writeFileSync(planPath, plan.replace(current, summary));
  console.error(changed ? (values.write ? 'Traceability summary updated.' : 'Traceability summary is stale.') : 'Traceability summary is current.');
  process.stdout.write(JSON.stringify({ id: values.id, changed, written: values.write && changed, report: traceabilityReport(manifest, process.cwd()) }) + '\n');
  process.exit(changed && !values.write ? 1 : 0);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
