import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { loadWebAudio } from './webAudioLibrary';
import { analyzeAudio } from './musicAiInference';
import type { MusicAiTag } from './musicAiTypes';

export const MUSIC_LIBRARY_KEY = 'soundroom.library.v1';
export const MUSIC_PLAYLISTS_KEY = 'soundroom.playlists.v1';
export const MUSIC_AI_ENABLED_KEY = 'soundroom.ai-enabled.v1';

export type MusicAiTrack = {
  id: string;
  uri: string;
  aiTags?: MusicAiTag[];
  aiAnalyzedAt?: number;
  aiError?: string;
};

export type MusicAiPlaylist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  generatedByAi?: boolean;
};

export type MusicAiProcessingResult = {
  tracks: MusicAiTrack[];
  playlists: MusicAiPlaylist[];
  processedCount: number;
  failedCount: number;
};

let processingPromise: Promise<MusicAiProcessingResult> | null = null;

function isMusicAiTrack(value: unknown): value is MusicAiTrack {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as Partial<MusicAiTrack>;
  return typeof track.id === 'string' && typeof track.uri === 'string';
}

function isMusicAiPlaylist(value: unknown): value is MusicAiPlaylist {
  if (typeof value !== 'object' || value === null) return false;
  const playlist = value as Partial<MusicAiPlaylist>;
  return (
    typeof playlist.id === 'string' &&
    typeof playlist.name === 'string' &&
    Array.isArray(playlist.trackIds) &&
    playlist.trackIds.every((id) => typeof id === 'string') &&
    typeof playlist.createdAt === 'number' &&
    typeof playlist.updatedAt === 'number'
  );
}

function createGeneratedPlaylists(
  tracks: MusicAiTrack[],
  existingPlaylists: MusicAiPlaylist[],
): MusicAiPlaylist[] {
  const existingById = new Map(
    existingPlaylists
      .filter((playlist) => playlist.generatedByAi)
      .map((playlist) => [playlist.id, playlist]),
  );
  const now = Date.now();
  const eligibleTracks = tracks.filter(
    (track) => !track.aiError && (track.aiTags?.length ?? 0) > 0,
  );
  const generated: MusicAiPlaylist[] = [];

  if (eligibleTracks.length >= 2) {
    const recommendedTracks = [...eligibleTracks]
      .sort((first, second) => {
        const score = (track: MusicAiTrack) =>
          (track.aiTags ?? [])
            .slice(0, 3)
            .reduce((total, tag) => total + tag.score, 0);
        return score(second) - score(first);
      })
      .slice(0, 30);
    generated.push({
      id: 'soundroom-ai:recommendations',
      name: 'AI Recommendations',
      trackIds: recommendedTracks.map((track) => track.id),
      createdAt: existingById.get('soundroom-ai:recommendations')?.createdAt ?? now,
      updatedAt: now,
      generatedByAi: true,
    });
  }

  const tracksByTag = new Map<string, { label: string; trackIds: string[] }>();
  for (const track of eligibleTracks) {
    for (const tag of track.aiTags ?? []) {
      const id = `soundroom-ai:${tag.category}:${tag.label.toLocaleLowerCase()}`;
      const group = tracksByTag.get(id) ?? { label: tag.label, trackIds: [] };
      group.trackIds.push(track.id);
      tracksByTag.set(id, group);
    }
  }

  for (const [id, group] of tracksByTag) {
    if (group.trackIds.length < 2) continue;
    const category = id.split(':')[1];
    generated.push({
      id,
      name: `${category === 'mood' ? 'Mood' : category === 'theme' ? 'Theme' : 'Genre'}: ${group.label}`,
      trackIds: group.trackIds,
      createdAt: existingById.get(id)?.createdAt ?? now,
      updatedAt: now,
      generatedByAi: true,
    });
  }

  return [
    ...existingPlaylists.filter((playlist) => !playlist.generatedByAi),
    ...generated,
  ];
}

export function processPendingMusicAiTracks(
  maximumTracks = 1,
): Promise<MusicAiProcessingResult> {
  if (processingPromise) return processingPromise;
  processingPromise = processPendingMusicAiTracksInternal(maximumTracks).finally(() => {
    processingPromise = null;
  });
  return processingPromise;
}

async function processPendingMusicAiTracksInternal(
  maximumTracks: number,
): Promise<MusicAiProcessingResult> {
  if (await AsyncStorage.getItem(MUSIC_AI_ENABLED_KEY) !== 'true') {
    return { tracks: [], playlists: [], processedCount: 0, failedCount: 0 };
  }

  const savedLibrary = await AsyncStorage.getItem(MUSIC_LIBRARY_KEY);
  const parsedLibrary: unknown = savedLibrary ? JSON.parse(savedLibrary) : [];
  if (!Array.isArray(parsedLibrary) || !parsedLibrary.every(isMusicAiTrack)) {
    throw new Error('The saved music library could not be read for AI analysis.');
  }

  const savedPlaylists = await AsyncStorage.getItem(MUSIC_PLAYLISTS_KEY);
  const parsedPlaylists: unknown = savedPlaylists ? JSON.parse(savedPlaylists) : [];
  if (!Array.isArray(parsedPlaylists) || !parsedPlaylists.every(isMusicAiPlaylist)) {
    throw new Error('The saved playlists could not be read for AI recommendations.');
  }

  const tracks = [...parsedLibrary];
  let processedCount = 0;
  let failedCount = 0;
  for (let index = 0; index < tracks.length && processedCount < maximumTracks; index += 1) {
    const track = tracks[index];
    if (!track || track.aiAnalyzedAt !== undefined || track.aiError) continue;
    if (await AsyncStorage.getItem(MUSIC_AI_ENABLED_KEY) !== 'true') break;

    try {
      let input: string | ArrayBuffer = track.uri;
      if (Platform.OS === 'web') {
        const audio = await loadWebAudio(track.id);
        if (!audio) throw new Error('The saved browser audio file is unavailable.');
        input = await audio.arrayBuffer();
      }
      track.aiTags = await analyzeAudio(input);
      delete track.aiError;
    } catch (error) {
      track.aiTags = [];
      track.aiError = error instanceof Error ? error.message : String(error);
      failedCount += 1;
    }
    if (await AsyncStorage.getItem(MUSIC_AI_ENABLED_KEY) !== 'true') break;
    track.aiAnalyzedAt = Date.now();
    processedCount += 1;
  }

  if (processedCount === 0) {
    return {
      tracks: parsedLibrary,
      playlists: parsedPlaylists,
      processedCount,
      failedCount,
    };
  }

  const latestLibrary = await AsyncStorage.getItem(MUSIC_LIBRARY_KEY);
  const latestParsedLibrary: unknown = latestLibrary ? JSON.parse(latestLibrary) : [];
  if (!Array.isArray(latestParsedLibrary) || !latestParsedLibrary.every(isMusicAiTrack)) {
    throw new Error('The saved music library changed to an unreadable format.');
  }
  const analyzedById = new Map(tracks.map((track) => [track.id, track]));
  const mergedTracks = latestParsedLibrary.map((track) => {
    const analyzedTrack = analyzedById.get(track.id);
    if (!analyzedTrack || analyzedTrack.aiAnalyzedAt === undefined) return track;
    return {
      ...track,
      aiTags: analyzedTrack.aiTags ?? [],
      aiAnalyzedAt: analyzedTrack.aiAnalyzedAt,
      ...(analyzedTrack.aiError ? { aiError: analyzedTrack.aiError } : {}),
    };
  });

  const latestSavedPlaylists = await AsyncStorage.getItem(MUSIC_PLAYLISTS_KEY);
  const latestParsedPlaylists: unknown = latestSavedPlaylists
    ? JSON.parse(latestSavedPlaylists)
    : [];
  if (
    !Array.isArray(latestParsedPlaylists) ||
    !latestParsedPlaylists.every(isMusicAiPlaylist)
  ) {
    throw new Error('The saved playlists changed to an unreadable format.');
  }
  const playlists = createGeneratedPlaylists(mergedTracks, latestParsedPlaylists);
  await AsyncStorage.setItem(MUSIC_LIBRARY_KEY, JSON.stringify(mergedTracks));
  await AsyncStorage.setItem(MUSIC_PLAYLISTS_KEY, JSON.stringify(playlists));
  return { tracks: mergedTracks, playlists, processedCount, failedCount };
}
