import { db } from './db.js';

const columns = await db.all(`PRAGMA table_info(photo_people);`);

console.log('\nPHOTO_PEOPLE TABLE:\n');
console.table(columns);

process.exit(0);
