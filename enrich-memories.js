#!/usr/bin/env node
/**
 * enrich-memories.js
 *
 * Enriches memories that have no AI-generated title yet.
 * Runs continuously until all memories are enriched, then exits.
 * Safe to run multiple times — skips already-enriched memories.
 *
 * Usage:
 *   node enrich-memories.js              # process all unenriched
 *   node enrich-memories.js --batch 10   # process N at a time then exit
 */

import { generateNarratives } from './memory-generator.js';
import { dbGet } from './db.js';

const args = process.argv.slice(2);
const batchIdx = args.indexOf('--batch');
const BATCH_MODE = batchIdx !== -1;
const BATCH_SIZE = BATCH_MODE ? parseInt(args[batchIdx + 1], 10) || 10 : null;
const DELAY_BETWEEN_BATCHES = 2000;

async function main() {
  const total = await dbGet("SELECT COUNT(*) as c FROM memories WHERE title IS NULL OR title LIKE 'Photos from%'");
  console.log(`🧠 Memories needing enrichment: ${total.c}`);

  if (total.c === 0) {
    console.log('✅ All memories already enriched. Nothing to do.');
    process.exit(0);
  }

  if (BATCH_MODE) {
    const generated = await generateNarratives(BATCH_SIZE);
    console.log(`✅ Enriched ${generated} memories (batch mode). Run again for more.`);
    process.exit(0);
  }

  // Continuous mode: process all unenriched memories
  let totalEnriched = 0;
  let pass = 0;
  const start = Date.now();

  while (true) {
    pass++;
    const remaining = await dbGet("SELECT COUNT(*) as c FROM memories WHERE title IS NULL OR title LIKE 'Photos from%'");
    if (remaining.c === 0) break;

    const elapsed = Math.round((Date.now() - start) / 60000);
    console.log(`\n[Pass ${pass}] ${remaining.c} remaining | ${totalEnriched} enriched so far | ${elapsed}min elapsed`);

    const generated = await generateNarratives(10);
    totalEnriched += generated;

    if (generated === 0) {
      console.log('No progress made, stopping.');
      break;
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
  }

  console.log(`\n✅ All done! Enriched ${totalEnriched} memories total.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
