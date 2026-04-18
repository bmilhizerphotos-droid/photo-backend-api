import { db } from './db.js';

const rows = await db.all(`SELECT * FROM faces LIMIT 5`);

console.log('\nFACES ROW SAMPLE:\n');
console.table(rows);

process.exit(0);
