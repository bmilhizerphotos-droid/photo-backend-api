import { db } from './db.js';

const faces = await db.all(`PRAGMA table_info(faces);`);
console.log('\nFACES TABLE:\n');
console.table(faces);

const people = await db.all(`PRAGMA table_info(people);`);
console.log('\nPEOPLE TABLE:\n');
console.table(people);

process.exit(0);
