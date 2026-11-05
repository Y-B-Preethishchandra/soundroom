import type { MusicAiTag } from './musicAiTypes';

export async function analyzeAudio(
  _input: string | ArrayBuffer,
): Promise<MusicAiTag[]> {
  throw new Error('On-device music analysis is available in the iOS and Android apps.');
}
