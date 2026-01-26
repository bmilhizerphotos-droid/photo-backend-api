import { createHash } from "crypto";
import { readFile, stat } from "fs/promises";
import { dbAll, dbRun, dbGet } from "./db.js";

async function hashFile(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export async function computeHashes(onProgress) {
  const photos = await dbAll(
    `SELECT id, filepath FROM photos WHERE (filehash IS NULL OR filehash = '') AND filepath IS NOT NULL`
  );
  let hashed = 0;
  let failed = 0;
  for (let i = 0; i < photos.length; i++) {
    try {
      const hash = await hashFile(photos[i].filepath);
      await dbRun(`UPDATE photos SET filehash = ? WHERE id = ?`, [hash, photos[i].id]);
      hashed++;
    } catch {
      failed++;
    }
    if (onProgress && (i + 1) % 500 === 0) {
      onProgress(i + 1, photos.length, hashed, failed);
    }
  }
  return { hashed, failed, total: photos.length };
}

export async function groupExactDuplicates() {
  await dbRun(`UPDATE photos SET duplicate_group_id = NULL`);

  const groups = await dbAll(`
    SELECT filehash, COUNT(*) as cnt
    FROM photos
    WHERE filehash IS NOT NULL AND filehash != ''
    GROUP BY filehash
    HAVING cnt > 1
  `);

  let groupId = 1;
  for (const g of groups) {
    await dbRun(
      `UPDATE photos SET duplicate_group_id = ? WHERE filehash = ?`,
      [groupId, g.filehash]
    );
    groupId++;
  }
  return groups.length;
}

export async function groupBursts() {
  await dbRun(`UPDATE photos SET burst_id = NULL`);

  const photos = await dbAll(`
    SELECT id, date_taken, width, height
    FROM photos
    WHERE date_taken IS NOT NULL
    ORDER BY date_taken ASC
  `);

  if (photos.length < 2) return 0;

  let burstId = 1;
  let burstCount = 0;
  let current = [photos[0]];

  for (let i = 1; i < photos.length; i++) {
    const prev = photos[i - 1];
    const curr = photos[i];
    const gap = Math.abs(
      new Date(curr.date_taken).getTime() - new Date(prev.date_taken).getTime()
    );
    const sameRes =
      prev.width != null &&
      curr.width != null &&
      prev.width === curr.width &&
      prev.height === curr.height;

    if (gap <= 2000 && sameRes) {
      current.push(curr);
    } else {
      if (current.length >= 2) {
        for (const p of current) {
          await dbRun(`UPDATE photos SET burst_id = ? WHERE id = ?`, [burstId, p.id]);
        }
        burstId++;
        burstCount++;
      }
      current = [curr];
    }
  }
  if (current.length >= 2) {
    for (const p of current) {
      await dbRun(`UPDATE photos SET burst_id = ? WHERE id = ?`, [burstId, p.id]);
    }
    burstCount++;
  }

  return burstCount;
}

export async function scanAll(onProgress) {
  console.log("Duplicate scan: computing hashes...");
  const hashResult = await computeHashes(onProgress);
  console.log(`Hashed ${hashResult.hashed} photos (${hashResult.failed} failed).`);

  console.log("Duplicate scan: grouping exact duplicates...");
  const dupeGroups = await groupExactDuplicates();
  console.log(`Found ${dupeGroups} exact duplicate groups.`);

  console.log("Duplicate scan: grouping bursts...");
  const burstGroups = await groupBursts();
  console.log(`Found ${burstGroups} burst groups.`);

  return {
    hashed: hashResult.hashed,
    hashFailed: hashResult.failed,
    hashTotal: hashResult.total,
    dupeGroups,
    burstGroups,
  };
}

export async function getDuplicateGroups() {
  const groups = await dbAll(`
    SELECT duplicate_group_id as groupId, filehash, COUNT(*) as count
    FROM photos
    WHERE duplicate_group_id IS NOT NULL
    GROUP BY duplicate_group_id
    ORDER BY count DESC
  `);

  const result = [];
  for (const g of groups) {
    const photos = await dbAll(
      `SELECT id, filename, filepath, date_taken, width, height
       FROM photos
       WHERE duplicate_group_id = ?
       ORDER BY date_taken ASC, id ASC`,
      [g.groupId]
    );
    result.push({ groupId: g.groupId, count: g.count, photos });
  }
  return result;
}

export async function getBurstGroups() {
  const groups = await dbAll(`
    SELECT burst_id as groupId, COUNT(*) as count
    FROM photos
    WHERE burst_id IS NOT NULL
    GROUP BY burst_id
    ORDER BY count DESC
  `);

  const result = [];
  for (const g of groups) {
    const photos = await dbAll(
      `SELECT id, filename, filepath, date_taken, width, height
       FROM photos
       WHERE burst_id = ?
       ORDER BY date_taken ASC, id ASC`,
      [g.groupId]
    );
    result.push({ groupId: g.groupId, count: g.count, photos });
  }
  return result;
}

export async function getScanStats() {
  const total = await dbGet(`SELECT COUNT(*) as c FROM photos`);
  const hashed = await dbGet(
    `SELECT COUNT(*) as c FROM photos WHERE filehash IS NOT NULL AND filehash != ''`
  );
  const dupeGroups = await dbGet(
    `SELECT COUNT(DISTINCT duplicate_group_id) as c FROM photos WHERE duplicate_group_id IS NOT NULL`
  );
  const dupePhotos = await dbGet(
    `SELECT COUNT(*) as c FROM photos WHERE duplicate_group_id IS NOT NULL`
  );
  const burstGroups = await dbGet(
    `SELECT COUNT(DISTINCT burst_id) as c FROM photos WHERE burst_id IS NOT NULL`
  );
  const burstPhotos = await dbGet(
    `SELECT COUNT(*) as c FROM photos WHERE burst_id IS NOT NULL`
  );
  return {
    totalPhotos: total.c,
    hashedPhotos: hashed.c,
    duplicateGroups: dupeGroups.c,
    duplicatePhotos: dupePhotos.c,
    burstGroups: burstGroups.c,
    burstPhotos: burstPhotos.c,
  };
}
