// FILE: extract-people.js
// Extracts people names from photo XMP Subject metadata and populates the database

import { dbRun, dbGet, dbAll } from "./db.js";
import { execSync, exec } from "child_process";
import path from "path";

const PHOTO_ROOT = process.env.PHOTO_ROOT || "G:/Photos";
const BATCH_SIZE = 100;

// Parse exiftool JSON output for a single photo
function parseExiftoolOutput(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    console.error("Failed to parse exiftool output:", e.message);
    return [];
  }
}

// Extract people names from Subject field
function extractPeopleFromSubject(subject) {
  if (!subject) return [];

  // Subject can be string or array
  const subjectStr = Array.isArray(subject) ? subject.join(", ") : subject;

  // Split by comma and clean up
  return subjectStr
    .split(",")
    .map(name => name.trim())
    .filter(name => name.length > 0 && name !== "undefined");
}

// Get or create a person by name
async function getOrCreatePerson(name) {
  const existing = await dbGet("SELECT id FROM people WHERE name = ?", [name]);
  if (existing) return existing.id;

  const result = await dbRun("INSERT INTO people (name) VALUES (?)", [name]);
  console.log(`  + Created person: ${name}`);
  return result.lastID;
}

// Link a photo to a person
async function linkPhotoPerson(photoId, personId) {
  try {
    await dbRun(
      "INSERT OR IGNORE INTO photo_people (photo_id, person_id) VALUES (?, ?)",
      [photoId, personId]
    );
  } catch (e) {
    // Ignore duplicate errors
  }
}

// Update person photo counts and set thumbnail
async function updatePersonStats() {
  console.log("\nUpdating person statistics...");

  // Update photo counts
  await dbRun(`
    UPDATE people SET photo_count = (
      SELECT COUNT(*) FROM photo_people WHERE person_id = people.id
    )
  `);

  // Set thumbnail_photo_id to the first photo for each person (if not set)
  await dbRun(`
    UPDATE people SET thumbnail_photo_id = (
      SELECT photo_id FROM photo_people
      WHERE person_id = people.id
      ORDER BY photo_id
      LIMIT 1
    )
    WHERE thumbnail_photo_id IS NULL
  `);

  console.log("Statistics updated.");
}

// Process photos in batches
async function processPhotos() {
  console.log("=== Extracting People from Photo Metadata ===\n");

  // Get all photos with full_path
  const photos = await dbAll(
    "SELECT id, filename, full_path FROM photos WHERE full_path IS NOT NULL AND full_path != ''"
  );

  console.log(`Found ${photos.length} photos to process.\n`);

  let processed = 0;
  let withPeople = 0;
  let errors = 0;

  for (const photo of photos) {
    try {
      // Use exiftool to get Subject metadata
      const cmd = `exiftool -j -Subject "${photo.full_path}"`;
      const output = execSync(cmd, { encoding: "utf8", timeout: 10000 });
      const data = parseExiftoolOutput(output);

      if (data.length > 0 && data[0].Subject) {
        const people = extractPeopleFromSubject(data[0].Subject);

        if (people.length > 0) {
          withPeople++;
          console.log(`[${processed + 1}/${photos.length}] ${photo.filename}: ${people.join(", ")}`);

          for (const personName of people) {
            const personId = await getOrCreatePerson(personName);
            await linkPhotoPerson(photo.id, personId);
          }
        }
      }
    } catch (e) {
      // File might not exist or exiftool error - skip silently
      errors++;
    }

    processed++;

    // Progress update every 100 photos
    if (processed % 100 === 0) {
      console.log(`\n--- Progress: ${processed}/${photos.length} (${withPeople} with people, ${errors} errors) ---\n`);
    }
  }

  console.log(`\n=== Extraction Complete ===`);
  console.log(`Total photos: ${photos.length}`);
  console.log(`Photos with people: ${withPeople}`);
  console.log(`Errors: ${errors}`);

  // Update statistics
  await updatePersonStats();

  // Show summary
  const people = await dbAll("SELECT name, photo_count FROM people ORDER BY photo_count DESC");
  console.log(`\n=== People Found (${people.length}) ===`);
  for (const person of people) {
    console.log(`  ${person.name}: ${person.photo_count} photos`);
  }
}

// Run the extraction
processPhotos()
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
