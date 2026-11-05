const DATABASE_NAME = 'soundroom.web-audio';
const DATABASE_VERSION = 1;
const STORE_NAME = 'tracks';
const WEB_TRACK_PREFIX = 'web-audio:';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open browser music storage.'));
    request.onblocked = () => reject(new Error('Browser music storage is blocked by another tab.'));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        let result: T;
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error ?? new Error('Browser music storage request failed.'));
        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error('Browser music storage transaction failed.'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error('Browser music storage transaction was aborted.'));
        };
      }),
  );
}

export function webTrackUri(id: string) {
  return `${WEB_TRACK_PREFIX}${id}`;
}

export function webArtworkUri(id: string) {
  return `web-artwork:${id}`;
}

export function isWebTrackUri(uri: string) {
  return uri.startsWith(WEB_TRACK_PREFIX);
}

export async function saveWebAudio(id: string, audio: Blob) {
  await runTransaction('readwrite', (store) => store.put(audio, id));
}

export async function saveWebArtwork(id: string, artwork: Blob) {
  await runTransaction('readwrite', (store) => store.put(artwork, webArtworkUri(id)));
}

export async function loadWebAudio(id: string): Promise<Blob | undefined> {
  return runTransaction('readonly', (store) => store.get(id));
}

export async function loadWebArtwork(id: string): Promise<Blob | undefined> {
  return runTransaction('readonly', (store) => store.get(webArtworkUri(id)));
}

export async function removeWebAudio(id: string) {
  await runTransaction('readwrite', (store) => {
    const request = store.delete(id);
    store.delete(webArtworkUri(id));
    return request;
  });
}
