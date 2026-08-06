#!/usr/bin/env node
/**
 * artifact-validate.mjs — Check deterministic evidence before approving a gate.
 *
 * Usage: node artifact-validate.mjs --id <id> --gate architect|specify|plan
 */

import { parseArgs } from 'util';
import { readManifest, validateGateArtifacts } from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    id: { type: 'string' },
    gate: { type: 'string' },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: artifact-validate.mjs --id <id> --gate architect|specify|plan');
  process.exit(0);
}
if (!values.id || !values.gate) {
  console.error('Usage: artifact-validate.mjs --id <id> --gate architect|specify|plan');
  process.exit(1);
}

try {
  const manifest = readManifest(values.id, process.cwd());
  const result = validateGateArtifacts(manifest, values.gate, process.cwd());
  if (!result.valid) {
    console.error(`Artifact validation failed for ${values.gate}:`);
    result.errors.forEach(error => console.error(`  - ${error}`));
    process.stdout.write(JSON.stringify({ id: values.id, gate: values.gate, ...result }) + '\n');
    process.exit(1);
  }
  console.error(`Artifact validation passed for ${values.gate}.`);
  process.stdout.write(JSON.stringify({ id: values.id, gate: values.gate, ...result }) + '\n');
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
