import { db } from './db.js';

const tags = await db.all(`
  SELECT name FROM tags 
  WHERE name IN (
    'ashcan','closet','garbage can',
    'handbasin','lavabo','press',
    'trash can','wardrobe','washbasin','washbowl'
  )
`);

console.table(tags);
process.exit(0);
