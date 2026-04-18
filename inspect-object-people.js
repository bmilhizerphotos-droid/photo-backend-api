import { db } from './db.js';

const suspicious = await db.all(`
  SELECT p.id, p.name, COUNT(pp.photo_id) as photo_count
  FROM people p
  LEFT JOIN photo_people pp ON pp.person_id = p.id
  WHERE LOWER(p.name) IN (
    'wardrobe','closet','press',
    'washbasin','handbasin','washbowl','lavabo',
    'ashcan','trash can','garbage can'
  )
  GROUP BY p.id, p.name
`);

console.log('\nSUSPICIOUS PEOPLE ENTRIES:\n');
console.table(suspicious);

process.exit(0);
