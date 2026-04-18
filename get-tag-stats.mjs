import { dbAll } from './db.js';

const stats = await Promise.all([
  dbAll("SELECT COUNT(*) as count FROM tags WHERE type = 'ai'"),
  dbAll("SELECT COUNT(*) as count FROM tags WHERE type = 'user'"),
  dbAll("SELECT COUNT(*) as count FROM tags WHERE type IS NULL OR type = ''"),
  dbAll("SELECT t.type, COUNT(*) as count FROM tags t GROUP BY t.type"),
  dbAll("SELECT t.name, COUNT(*) as photo_count FROM tags t JOIN photo_tags pt ON t.id = pt.tag_id GROUP BY t.id ORDER BY photo_count DESC LIMIT 10"),
]);

console.log('AI TAGS:', stats[0][0].count);
console.log('USER TAGS:', stats[1][0].count);
console.log('NULL/UNKNOWN TYPE TAGS:', stats[2][0].count);
console.log('\nTAGS BY TYPE:');
console.table(stats[3]);
console.log('\nTOP 10 TAGS BY USAGE:');
console.table(stats[4]);
process.exit(0);
