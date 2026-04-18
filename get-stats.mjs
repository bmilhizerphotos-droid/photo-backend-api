import { dbAll } from './db.js';

const stats = await Promise.all([
  dbAll('SELECT COUNT(*) as count FROM photos WHERE is_deleted=0'),
  dbAll('SELECT COUNT(*) as count FROM photos'),
  dbAll('SELECT COUNT(*) as count FROM tags'),
  dbAll('SELECT COUNT(DISTINCT photo_id) as count FROM photo_tags'),
  dbAll('SELECT COUNT(*) as count FROM photo_captions'),
  dbAll('SELECT COUNT(*) as count FROM photo_people'),
  dbAll('SELECT COUNT(*) as count FROM people'),
]);

console.log('ACTIVE PHOTOS:', stats[0][0].count);
console.log('TOTAL PHOTOS (incl deleted):', stats[1][0].count);
console.log('TOTAL TAGS:', stats[2][0].count);
console.log('PHOTOS WITH TAGS:', stats[3][0].count);
console.log('PHOTO CAPTIONS:', stats[4][0].count);
console.log('PHOTO-PEOPLE LINKS:', stats[5][0].count);
console.log('PEOPLE:', stats[6][0].count);
process.exit(0);
