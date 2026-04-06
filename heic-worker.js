/**
 * heic-worker.js
 * Runs HEIC → JPEG conversion in a worker thread so the main
 * event loop is never blocked by the synchronous WASM execution
 * inside heic-decode/libheif.
 */
import { workerData, parentPort } from "worker_threads";
import heicConvert from "heic-convert";
import fs from "fs/promises";

const { filePath } = workerData;

try {
  const inputBuffer = await fs.readFile(filePath);

  // Quick magic-byte check: JPEG starts with FF D8.
  // Some files have a .heic extension but are actually JPEG (Google Takeout).
  if (inputBuffer[0] === 0xff && inputBuffer[1] === 0xd8) {
    parentPort.postMessage({ ok: true, jpeg: inputBuffer, wasJpeg: true });
  } else {
    const jpeg = await heicConvert({
      buffer: inputBuffer,
      format: "JPEG",
      quality: 0.92,
    });
    parentPort.postMessage({ ok: true, jpeg: Buffer.from(jpeg), wasJpeg: false });
  }
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
