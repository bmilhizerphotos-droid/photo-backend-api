import * as tf from "@tensorflow/tfjs";
import * as wasm from "@tensorflow/tfjs-backend-wasm";
import "@tensorflow/tfjs-backend-cpu";
import canvas from "canvas";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { dbAll, dbRun, dbGet } from "./db.js";

// IMPORTANT: use the node-wasm build explicitly
import * as faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let modelsLoaded = false;
let processing = false;
let tfReady = false;

/* ================================
   TENSORFLOW (WASM) INIT
   ================================ */

function resolveWasmDir() {
  const pkgJsonPath = require.resolve("@tensorflow/tfjs-backend-wasm/package.json");
  const pkgDir = path.dirname(pkgJsonPath);
  return path.join(pkgDir, "dist");
}

async function initTensorflow() {
  if (tfReady) return;

  const wasmDir = resolveWasmDir();
  wasm.setWasmPaths(wasmDir + path.sep);

  await tf.setBackend("wasm");
  await tf.ready();

  tfReady = true;
  console.log(`[faces] tf backend: ${tf.getBackend()}`);
}

/* ================================
   MODEL LOADING
   ================================ */

function findModelDir() {
  const dir = path.join(process.cwd(), "faceapi-models");
  const marker = path.join(dir, "ssd_mobilenetv1_model-weights_manifest.json");
  if (fs.existsSync(marker)) {
    console.log(`[faces] using face-api model dir: ${dir}`);
    return dir;
  }

  throw new Error(
    `FaceAPI TFJS models not found.\nExpected: ${marker}\n`
  );
}

async function loadModels() {
  if (modelsLoaded) return;

  await initTensorflow();

  const dir = findModelDir();

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(dir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(dir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(dir);

  modelsLoaded = true;
}

/* ================================
   IMAGE LOADING
   ================================ */

async function loadImage(filePath) {
  const buffer = await sharp(filePath)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return canvas.loadImage(buffer);
}

/* ================================
   BACKGROUND JOB
   ================================ */

async function updateJobProgress(jobId, photosProcessed, facesDetected) {
  // Keep DB write volume reasonable
  await dbRun(
    `
    UPDATE face_jobs
    SET photos_processed=?,
        faces_detected=?
    WHERE id=?
    `,
    [photosProcessed, facesDetected, jobId]
  );
}

export async function processAllFaces() {
  if (processing) throw new Error("Face processing already running");
  processing = true;

  const job = await dbRun(
    `INSERT INTO face_jobs (status, started_at) VALUES ('running', datetime('now'))`
  );
  const jobId = job.lastID;

  // Update progress every N photos
  const PROGRESS_EVERY = 25;

  try {
    await loadModels();

    const photos = await dbAll(`
      SELECT id, full_path
      FROM photos
      WHERE id NOT IN (SELECT DISTINCT photo_id FROM faces)
        AND full_path IS NOT NULL
      ORDER BY id ASC
    `);

    let processed = 0;
    let facesDetected = 0;

    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });

    for (const photo of photos) {
      if (!fs.existsSync(photo.full_path)) {
        processed++;
      } else {
        try {
          const img = await loadImage(photo.full_path);

          const detections = await faceapi
            .detectAllFaces(img, options)
            .withFaceLandmarks()
            .withFaceDescriptors();

          for (const d of detections) {
            const b = d.detection.box;
            await dbRun(
              `
              INSERT INTO faces
                (photo_id, embedding, box_x, box_y, box_width, box_height, confidence)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              `,
              [
                photo.id,
                Buffer.from(JSON.stringify(Array.from(d.descriptor))),
                b.x / img.width,
                b.y / img.height,
                b.width / img.width,
                b.height / img.height,
                d.detection.score,
              ]
            );
            facesDetected++;
          }
        } catch {
          // ignore single-photo failures
        }

        processed++;
      }

      if (processed % PROGRESS_EVERY === 0) {
        try {
          await updateJobProgress(jobId, processed, facesDetected);
        } catch {
          // If progress update fails, do not stop the job
        }
      }

      if (processed % 5 === 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // Final progress + completion
    await dbRun(
      `
      UPDATE face_jobs
      SET status='complete',
          finished_at=datetime('now'),
          photos_processed=?,
          faces_detected=?
      WHERE id=?
      `,
      [processed, facesDetected, jobId]
    );
  } catch (err) {
    try {
      // Try to record whatever progress we have before failing
      // (processed/facesDetected may be undefined if we failed very early)
    } catch {}

    await dbRun(
      `UPDATE face_jobs SET status='failed', finished_at=datetime('now') WHERE id=?`,
      [jobId]
    );
    throw err;
  } finally {
    processing = false;
  }
}

export function isProcessing() {
  return processing;
}

export async function getFaceStatus() {
  const total = await dbGet(`SELECT COUNT(*) as c FROM photos`);
  const processed = await dbGet(`SELECT COUNT(DISTINCT photo_id) as c FROM faces`);
  const faces = await dbGet(`SELECT COUNT(*) as c FROM faces`);
  const job = await dbGet(`SELECT * FROM face_jobs ORDER BY id DESC LIMIT 1`);

  return {
    totalPhotos: total.c,
    photosProcessed: processed.c,
    facesDetected: faces.c,
    processing,
    latestJob: job,
  };
}
