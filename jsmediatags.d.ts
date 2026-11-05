declare module 'jsmediatags/build2/MediaFileReader' {
  export type FileReaderCallbacks = {
    onSuccess: () => void;
    onError?: (error: unknown) => void;
  };

  export default class MediaFileReader {
    constructor(file: unknown);
    _size: number;
    _isInitialized: boolean;
    _init(callbacks: FileReaderCallbacks): void;
    loadRange(range: [number, number], callbacks: FileReaderCallbacks): void;
    getSize(): number;
    getByteAt(offset: number): number;
    getBytesAt(offset: number, length: number): number[];
    isBitSetAt(offset: number, bit: number): boolean;
    getSByteAt(offset: number): number;
    getShortAt(offset: number, isBigEndian: boolean): number;
    getSShortAt(offset: number, isBigEndian: boolean): number;
    getLongAt(offset: number, isBigEndian: boolean): number;
    getSLongAt(offset: number, isBigEndian: boolean): number;
    getInteger24At(offset: number, isBigEndian: boolean): number;
    getStringAt(offset: number, length: number): string;
    getStringWithCharsetAt(
      offset: number,
      length: number,
      charset?: string | null,
    ): { toString(): string };
    getCharAt(offset: number): string;
    getSynchsafeInteger32At(offset: number): number;
  }
}

declare module 'jsmediatags/build2/BlobFileReader' {
  export default class BlobFileReader {
    constructor(blob: Blob);
  }
}

declare module 'jsmediatags/dist/jsmediatags.min.js' {
  export type TagResult = {
    type?: string;
    version?: string;
    major?: number;
    revision?: number;
    tags: Record<string, unknown>;
  };
  export type TagReaderCallbacks = {
    onSuccess: (result: TagResult) => void;
    onError: (error: unknown) => void;
  };

  export class Reader {
    constructor(file: unknown);
    setFileReader(fileReader: new (file: Blob) => unknown): Reader;
    setTagsToRead(tags: string[]): Reader;
    read(callbacks: TagReaderCallbacks): void;
  }
}
