#!/usr/bin/env node
/**
 * artifact-validate.mjs — Check deterministic evidence before approving an approval.
 *
 * Usage: node artifact-validate.mjs --id <id> --approval architect|specify|plan
 */

import { parseArgs } from 'util';
import { readManifest, validateApprovalArtifacts } from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    id: { type: 'string' },
    approval: { type: 'string' },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: artifact-validate.mjs --id <id> --approval architect|specify|plan');
  process.exit(0);
}
if (!values.id || !values.approval) {
  console.error('Usage: artifact-validate.mjs --id <id> --approval architect|specify|plan');
  process.exit(1);
}

try {
  const manifest = readManifest(values.id, process.cwd());
  const result = validateApprovalArtifacts(manifest, values.approval, process.cwd());
  if (!result.valid) {
    console.error(`Artifact validation failed for ${values.approval}:`);
    result.errors.forEach(error => console.error(`  - ${error}`));
    process.stdout.write(JSON.stringify({ id: values.id, approval: values.approval, ...result }) + '\n');
    process.exit(1);
  }
  console.error(`Artifact validation passed for ${values.approval}.`);
  process.stdout.write(JSON.stringify({ id: values.id, approval: values.approval, ...result }) + '\n');
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
