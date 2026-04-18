import { db } from './db.js';

const columns = await db.all(`PRAGMA table_info(photos);`);

console.log('\nPHOTOS TABLE SCHEMA:\n');
console.table(columns);

process.exit(0);
