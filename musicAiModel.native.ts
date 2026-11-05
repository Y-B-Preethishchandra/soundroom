import { decodeAudioData } from 'react-native-audio-api';
import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';

import { MUSIC_AI_CLASSES, type MusicAiTag } from './musicAiTypes';

// YAMNet expects mono audio resampled to 16 kHz.
const MODEL_SAMPLE_RATE = 16_000;
const MAX_ANALYSIS_DURATION_SECONDS = 5 * 60;
// Metro resolves bundled TFLite models from static require calls.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('./assets/ai/yamnet.tflite') as number;

let modelPromise: Promise<TfliteModel> | null = null;

function getModel() {
  modelPromise ??= loadTensorflowModel(MODEL_ASSET, []).catch((error: unknown) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

function tensorSize(shape: number[]) {
  if (shape.length === 0 || shape.some((dimension) => dimension <= 0)) {
    throw new Error('The audio model has an unsupported tensor shape.');
  }
  return shape.reduce((size, dimension) => size * dimension, 1);
}

function getSampleOffsets(length: number, sampleCount: number) {
  const lastOffset = Math.max(0, length - sampleCount);
  return [...new Set([0, Math.floor(lastOffset / 2), lastOffset])];
}

function getTags(scores: number[], classCount: number): MusicAiTag[] {
  const candidates = MUSIC_AI_CLASSES
    .filter(({ classIndex }) => classIndex < classCount)
    .map(({ classIndex, category, label }) => ({
      category,
      label,
      score: scores[classIndex] ?? 0,
    }))
    .filter(({ score }) => score >= 0.08)
    .sort((first, second) => second.score - first.score);
  const categories: MusicAiTag['category'][] = ['genre', 'mood', 'theme'];
  return categories
    .flatMap((category) =>
      candidates.filter((tag) => tag.category === category).slice(0, 2),
    )
    .sort((first, second) => second.score - first.score);
}

export async function analyzeAudio(input: string | ArrayBuffer): Promise<MusicAiTag[]> {
  const [model, audio] = await Promise.all([
    getModel(),
    decodeAudioData(input, MODEL_SAMPLE_RATE, undefined, MAX_ANALYSIS_DURATION_SECONDS),
  ]);
  const inputTensor = model.inputs[0];
  const outputTensor = model.outputs[0];
  if (!inputTensor || !outputTensor || model.outputs.length !== 1) {
    throw new Error('The bundled audio model has an unsupported tensor layout.');
  }

  const sampleCount = tensorSize(inputTensor.shape);
  const classCount = tensorSize(outputTensor.shape);
  const summedScores = new Array<number>(classCount).fill(0);
  const analysisLength = Math.min(
    audio.length,
    MAX_ANALYSIS_DURATION_SECONDS * audio.sampleRate,
  );
  const offsets = getSampleOffsets(analysisLength, sampleCount);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index),
  );

  for (const offset of offsets) {
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount && offset + index < analysisLength; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[offset + index] ?? 0;
      samples[index] = sample / channels.length;
    }

    const buffer = samples.buffer.slice(
      samples.byteOffset,
      samples.byteOffset + samples.byteLength,
    );
    const outputs = await model.run([buffer]);
    const output = outputs[0];
    if (!output) throw new Error('The audio model returned no classification scores.');
    const scores = new Float32Array(output);
    if (scores.length !== classCount) {
      throw new Error('The audio model returned an unexpected number of scores.');
    }
    scores.forEach((score, index) => {
      summedScores[index] = (summedScores[index] ?? 0) + score;
    });
  }

  return getTags(
    summedScores.map((score) => score / offsets.length),
    classCount,
  );
}
