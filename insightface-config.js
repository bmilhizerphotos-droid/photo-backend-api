// FILE: insightface-config.js
// Face detection and recognition using InsightFace/ArcFace with ONNX Runtime
// Models: SCRFD-10GF (detection) + ArcFace-R50 (recognition)
// Produces 512-dimensional face embeddings

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS_PATH = path.join(__dirname, 'models');

// Matching threshold for ArcFace embeddings (cosine similarity)
// Higher = stricter matching. 0.4-0.5 is typical for ArcFace
export const FACE_MATCH_THRESHOLD = 0.45;

// Model files
const DETECTION_MODEL = 'det_10g.onnx';
const RECOGNITION_MODEL = 'w600k_r50.onnx';

// Detection settings
const DET_INPUT_SIZE = [640, 640];
const DET_THRESH = 0.15;
const NMS_THRESH = 0.4;

// Recognition settings (ArcFace input is 112x112)
const REC_INPUT_SIZE = 112;

let detectionSession = null;
let recognitionSession = null;
let modelsLoaded = false;

/**
 * Initialize InsightFace ONNX models
 */
export async function initializeFaceApi() {
  if (modelsLoaded) return;

  const detModelPath = path.join(MODELS_PATH, DETECTION_MODEL);
  const recModelPath = path.join(MODELS_PATH, RECOGNITION_MODEL);

  if (!fs.existsSync(detModelPath)) {
    throw new Error(`Detection model not found: ${detModelPath}`);
  }
  if (!fs.existsSync(recModelPath)) {
    throw new Error(`Recognition model not found: ${recModelPath}`);
  }

  console.log('Loading InsightFace models...');

  try {
    const sessionOptions = {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    };

    detectionSession = await ort.InferenceSession.create(detModelPath, sessionOptions);
    console.log('  Detection:', DETECTION_MODEL);
    console.log('    Inputs:', detectionSession.inputNames);
    console.log('    Outputs:', detectionSession.outputNames);

    recognitionSession = await ort.InferenceSession.create(recModelPath, sessionOptions);
    console.log('  Recognition:', RECOGNITION_MODEL);
    console.log('    Inputs:', recognitionSession.inputNames);
    console.log('    Outputs:', recognitionSession.outputNames);

    modelsLoaded = true;
    console.log('InsightFace models loaded successfully');
  } catch (error) {
    console.error('Failed to load models:', error);
    throw error;
  }
}

/**
 * Preprocess image for SCRFD detection
 */
async function preprocessForDetection(imagePath) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const [targetW, targetH] = DET_INPUT_SIZE;

  // Calculate resize scale maintaining aspect ratio
  const scale = Math.min(targetW / metadata.width, targetH / metadata.height);
  const newW = Math.round(metadata.width * scale);
  const newH = Math.round(metadata.height * scale);

  // Resize image
  const resized = await image
    .resize(newW, newH, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  // Create padded input (BGR format, NCHW layout)
  const inputData = new Float32Array(3 * targetH * targetW);

  // SCRFD expects RGB input normalized with mean=127.5, std=128
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const srcIdx = (y * newW + x) * 3;
      const r = resized[srcIdx];
      const g = resized[srcIdx + 1];
      const b = resized[srcIdx + 2];

      // RGB order, normalized
      inputData[0 * targetH * targetW + y * targetW + x] = (r - 127.5) / 128.0;
      inputData[1 * targetH * targetW + y * targetW + x] = (g - 127.5) / 128.0;
      inputData[2 * targetH * targetW + y * targetW + x] = (b - 127.5) / 128.0;
    }
  }

  return {
    inputData,
    scale,
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    resizedWidth: newW,
    resizedHeight: newH,
  };
}

/**
 * Run SCRFD face detection
 */
async function runDetection(preprocessed) {
  const { inputData, scale, originalWidth, originalHeight, resizedWidth, resizedHeight } = preprocessed;
  const [targetW, targetH] = DET_INPUT_SIZE;

  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, targetH, targetW]);
  const feeds = { [detectionSession.inputNames[0]]: inputTensor };

  const results = await detectionSession.run(feeds);

  // SCRFD det_10g outputs (9 total) - flattened format [N*H*W*anchors, C]:
  // Outputs 0,1,2 = scores for strides 8,16,32 -> [N, 1]
  // Outputs 3,4,5 = bboxes for strides 8,16,32 -> [N, 4]
  // Outputs 6,7,8 = keypoints for strides 8,16,32 -> [N, 10]
  const outputNames = detectionSession.outputNames;
  const outputArrays = outputNames.map(name => results[name]);

  const faces = [];
  const strides = [8, 16, 32];
  const numAnchors = 2;

  for (let i = 0; i < 3; i++) {
    const stride = strides[i];
    const scoreOutput = outputArrays[i];
    const bboxOutput = outputArrays[i + 3];
    const kpsOutput = outputArrays[i + 6];

    if (!scoreOutput || !bboxOutput) continue;

    const scoreData = scoreOutput.data;
    const bboxData = bboxOutput.data;
    const kpsData = kpsOutput?.data;

    // Feature map dimensions
    const fmH = Math.floor(targetH / stride);
    const fmW = Math.floor(targetW / stride);
    const totalAnchors = scoreOutput.dims[0]; // First dim is total anchors

    for (let idx = 0; idx < totalAnchors; idx++) {
      const score = scoreData[idx];

      if (score > DET_THRESH) {
        // Calculate grid position from flattened index
        // Index order: for each (y, x) position, iterate through anchors
        const gridIdx = Math.floor(idx / numAnchors);
        const gridY = Math.floor(gridIdx / fmW);
        const gridX = gridIdx % fmW;

        const anchorX = (gridX + 0.5) * stride;
        const anchorY = (gridY + 0.5) * stride;

        // Decode bbox - format depends on model
        // det_10g uses distance format: [left, top, right, bottom] * stride
        const bx = bboxData[idx * 4];
        const by = bboxData[idx * 4 + 1];
        const bw = bboxData[idx * 4 + 2];
        const bh = bboxData[idx * 4 + 3];

        const x1 = (anchorX - bx * stride) / scale;
        const y1 = (anchorY - by * stride) / scale;
        const x2 = (anchorX + bw * stride) / scale;
        const y2 = (anchorY + bh * stride) / scale;

        // Clamp to image bounds
        const bbox = [
          Math.max(0, Math.min(x1, originalWidth)),
          Math.max(0, Math.min(y1, originalHeight)),
          Math.max(0, Math.min(x2, originalWidth)),
          Math.max(0, Math.min(y2, originalHeight)),
        ];

        // Skip invalid boxes
        if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) continue;

        // Decode landmarks if available
        let landmarks = null;
        if (kpsData) {
          landmarks = [];
          for (let k = 0; k < 5; k++) {
            landmarks.push({
              x: (anchorX + kpsData[idx * 10 + k * 2] * stride) / scale,
              y: (anchorY + kpsData[idx * 10 + k * 2 + 1] * stride) / scale,
            });
          }
        }

        faces.push({ bbox, score, landmarks });
      }
    }
  }

  // Apply NMS
  return nms(faces, NMS_THRESH);
}

/**
 * Non-maximum suppression
 */
function nms(faces, threshold) {
  if (faces.length === 0) return [];

  // Sort by score descending
  faces.sort((a, b) => b.score - a.score);

  const keep = [];
  const suppressed = new Set();

  for (let i = 0; i < faces.length; i++) {
    if (suppressed.has(i)) continue;
    keep.push(faces[i]);

    for (let j = i + 1; j < faces.length; j++) {
      if (suppressed.has(j)) continue;
      if (iou(faces[i].bbox, faces[j].bbox) > threshold) {
        suppressed.add(j);
      }
    }
  }

  return keep;
}

/**
 * Calculate IoU between two boxes
 */
function iou(boxA, boxB) {
  const x1 = Math.max(boxA[0], boxB[0]);
  const y1 = Math.max(boxA[1], boxB[1]);
  const x2 = Math.min(boxA[2], boxB[2]);
  const y2 = Math.min(boxA[3], boxB[3]);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
  const areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);

  return intersection / (areaA + areaB - intersection);
}

/**
 * Align and preprocess face for recognition
 */
async function preprocessFace(imagePath, bbox) {
  const [x1, y1, x2, y2] = bbox;
  const w = x2 - x1;
  const h = y2 - y1;

  // Get image dimensions for bounds checking
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const imgW = metadata.width;
  const imgH = metadata.height;

  // Add margin and clamp to image bounds
  const margin = 0.15;
  let cropX = Math.max(0, Math.round(x1 - w * margin));
  let cropY = Math.max(0, Math.round(y1 - h * margin));
  let cropW = Math.round(w * (1 + margin * 2));
  let cropH = Math.round(h * (1 + margin * 2));

  // Ensure crop doesn't exceed image bounds
  if (cropX + cropW > imgW) cropW = imgW - cropX;
  if (cropY + cropH > imgH) cropH = imgH - cropY;

  // Ensure minimum crop size
  cropW = Math.max(1, cropW);
  cropH = Math.max(1, cropH);

  // Load, crop, and resize to 112x112
  const faceData = await image
    .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
    .resize(REC_INPUT_SIZE, REC_INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  // Convert to NCHW format with normalization
  const inputData = new Float32Array(3 * REC_INPUT_SIZE * REC_INPUT_SIZE);

  for (let y = 0; y < REC_INPUT_SIZE; y++) {
    for (let x = 0; x < REC_INPUT_SIZE; x++) {
      const srcIdx = (y * REC_INPUT_SIZE + x) * 3;
      // ArcFace expects RGB, normalized to [-1, 1]
      inputData[0 * REC_INPUT_SIZE * REC_INPUT_SIZE + y * REC_INPUT_SIZE + x] =
        (faceData[srcIdx] - 127.5) / 127.5;
      inputData[1 * REC_INPUT_SIZE * REC_INPUT_SIZE + y * REC_INPUT_SIZE + x] =
        (faceData[srcIdx + 1] - 127.5) / 127.5;
      inputData[2 * REC_INPUT_SIZE * REC_INPUT_SIZE + y * REC_INPUT_SIZE + x] =
        (faceData[srcIdx + 2] - 127.5) / 127.5;
    }
  }

  return inputData;
}

/**
 * Get 512-dimensional face embedding using ArcFace
 */
async function getEmbedding(faceData) {
  const inputTensor = new ort.Tensor('float32', faceData, [1, 3, REC_INPUT_SIZE, REC_INPUT_SIZE]);
  const feeds = { [recognitionSession.inputNames[0]]: inputTensor };

  const results = await recognitionSession.run(feeds);
  const embedding = Array.from(results[recognitionSession.outputNames[0]].data);

  // L2 normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map(v => v / norm);
}

/**
 * Detect faces and extract embeddings
 */
export async function detectFaces(imagePath) {
  if (!modelsLoaded) {
    await initializeFaceApi();
  }

  try {
    // Preprocess and detect
    const preprocessed = await preprocessForDetection(imagePath);
    const detections = await runDetection(preprocessed);

    if (detections.length === 0) {
      return [];
    }

    // Get embedding for each face
    const results = [];
    for (const det of detections) {
      try {
        const faceData = await preprocessFace(imagePath, det.bbox);
        const embedding = await getEmbedding(faceData);

        const [x1, y1, x2, y2] = det.bbox;
        results.push({
          bbox: {
            x: x1 / preprocessed.originalWidth,
            y: y1 / preprocessed.originalHeight,
            width: (x2 - x1) / preprocessed.originalWidth,
            height: (y2 - y1) / preprocessed.originalHeight,
          },
          confidence: det.score,
          embedding, // 512-dimensional
        });
      } catch (err) {
        console.warn('Failed to process face:', err.message);
      }
    }

    return results;
  } catch (error) {
    console.error('Face detection error:', error);
    throw error;
  }
}

/**
 * Convert embedding to Buffer (512 floats = 2048 bytes)
 */
export function embeddingToBuffer(embedding) {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * Convert Buffer to embedding array
 */
export function bufferToEmbedding(buffer) {
  return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4));
}

/**
 * Cosine similarity between embeddings
 */
export function calculateSimilarity(e1, e2) {
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < e1.length; i++) {
    dot += e1[i] * e2[i];
    n1 += e1[i] * e1[i];
    n2 += e2[i] * e2[i];
  }
  return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

/**
 * Distance metric (for compatibility)
 */
export function calculateDistance(e1, e2) {
  return 1 - calculateSimilarity(e1, e2);
}

/**
 * Find best matching person
 */
export function findBestMatch(embedding, references) {
  if (!references?.length) return null;

  let best = null;
  let bestSim = -1;

  for (const ref of references) {
    const refEmb = ref.embedding instanceof Buffer
      ? bufferToEmbedding(ref.embedding)
      : ref.embedding;

    const sim = calculateSimilarity(embedding, refEmb);
    if (sim > bestSim && sim > FACE_MATCH_THRESHOLD) {
      bestSim = sim;
      best = { personId: ref.personId, distance: 1 - sim, similarity: sim };
    }
  }

  return best;
}

export function areModelsLoaded() {
  return modelsLoaded;
}

export default {
  initializeFaceApi,
  detectFaces,
  embeddingToBuffer,
  bufferToEmbedding,
  calculateSimilarity,
  calculateDistance,
  findBestMatch,
  areModelsLoaded,
  FACE_MATCH_THRESHOLD,
};
