import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  MUSIC_AI_ENABLED_KEY,
  processPendingMusicAiTracks,
} from './musicAi';

export const MUSIC_AI_BACKGROUND_TASK = 'soundroom-ai-analysis';

if (!TaskManager.isTaskDefined(MUSIC_AI_BACKGROUND_TASK)) {
  TaskManager.defineTask(MUSIC_AI_BACKGROUND_TASK, async () => {
    try {
      if (await AsyncStorage.getItem(MUSIC_AI_ENABLED_KEY) !== 'true') {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      await processPendingMusicAiTracks(1);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      console.error('Background music analysis failed:', error);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerMusicAiBackgroundTask() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
    throw new Error('OS-scheduled background tasks are unavailable on this device.');
  }

  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(
    MUSIC_AI_BACKGROUND_TASK,
  );
  if (!alreadyRegistered) {
    await BackgroundTask.registerTaskAsync(MUSIC_AI_BACKGROUND_TASK, {
      minimumInterval: 15,
    });
  }
}

export async function unregisterMusicAiBackgroundTask() {
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(
    MUSIC_AI_BACKGROUND_TASK,
  );
  if (alreadyRegistered) {
    await BackgroundTask.unregisterTaskAsync(MUSIC_AI_BACKGROUND_TASK);
  }
}
