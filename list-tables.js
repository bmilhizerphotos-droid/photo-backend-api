import { db } from './db.js';

const tables = await db.all(`
  SELECT name FROM sqlite_master WHERE type='table';
`);

console.log('\nTABLES IN DATABASE:\n');
console.table(tables);

process.exit(0);
