import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { BlurTargetView } from 'expo-blur';
import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { Reader } from 'jsmediatags/dist/jsmediatags.min.js';
import BlobFileReader from 'jsmediatags/build2/BlobFileReader';
import MediaFileReader from 'jsmediatags/build2/MediaFileReader';
import Slider from '@react-native-community/slider';
import {
  Audio,
  AudioManager,
  AudioContext,
  PlaybackNotificationManager,
  useAudioTagContext,
  type AudioTagHandle,
  type BiquadFilterNode,
  type MediaElementAudioSourceNode,
} from 'react-native-audio-api';
import { VolumeManager } from 'react-native-volume-manager';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import {
  AppState,
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  LayoutAnimation,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Platform,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import EqualizerSheet, {
  EQUALIZER_BANDS,
  isEqualizerSettings,
  type EqualizerSettings,
} from './EqualizerSheet';
import GlassSurface from './GlassSurface';
import {
  MUSIC_AI_ENABLED_KEY,
  MUSIC_LIBRARY_KEY,
  MUSIC_PLAYLISTS_KEY,
  processPendingMusicAiTracks,
} from './musicAi';
import {
  registerMusicAiBackgroundTask,
  unregisterMusicAiBackgroundTask,
} from './musicAiBackground';
import type { MusicAiTag } from './musicAiTypes';
import { THEME_COLORS, type ThemeColors, type ThemeMode } from './theme';
import {
  isWebTrackUri,
  loadWebAudio,
  loadWebArtwork,
  removeWebAudio,
  saveWebAudio,
  saveWebArtwork,
  webTrackUri,
  webArtworkUri,
} from './webAudioLibrary';

const LIBRARY_KEY = 'soundroom.library.v1';
const PLAYLISTS_KEY = 'soundroom.playlists.v1';
const EQUALIZER_KEY = 'soundroom.equalizer.v1';
const THEME_KEY = 'soundroom.theme.v1';
const DROP_FOLDER_KEY = 'soundroom.drop-folder.v1';
const IGNORED_DROP_SOURCES_KEY = 'soundroom.ignored-drop-sources.v1';
const TRACK_METADATA_VERSION = 3;
const MUSIC_FOLDER = 'soundroom-audio';
const ARTWORK_FOLDER = 'soundroom-artwork';
const MAX_ARTWORK_BYTES = 12 * 1024 * 1024;
const ART_COLORS = ['#D6F36A', '#E39C76', '#A99AE8', '#7FC9B9', '#D98CA1'];
const DEFAULT_EQUALIZER: EqualizerSettings = {
  enabled: true,
  bands: [0, 0, 0, 0, 0],
};

type MetadataBlobReader = new (blob: Blob) => unknown;

type Track = {
  id: string;
  fileName: string;
  title: string;
  artist: string;
  uri: string;
  sourceUri?: string;
  artworkUri?: string;
  metadata?: Record<string, string>;
  metadataVersion?: number;
  album?: string;
  albumArtist?: string;
  composer?: string;
  genre?: string;
  metadataLoaded?: boolean;
  aiTags?: MusicAiTag[];
  aiAnalyzedAt?: number;
  aiError?: string;
  addedAt: number;
};

type TrackMetadata = Pick<
  Track,
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'composer'
  | 'genre'
  | 'metadata'
  | 'metadataVersion'
  | 'metadataLoaded'
  | 'artworkUri'
>;

type ImportAudioAsset = {
  name: string;
  mimeType?: string;
  uri?: string;
  sourceUri?: string;
  file?: Blob;
};

type MetadataReaderCallbacks = {
  onSuccess: () => void;
  onError?: (error: unknown) => void;
};

type ParsedAudioTags = {
  type?: string;
  version?: string;
  tags: Record<string, unknown>;
};

type AudioArtwork = {
  data: number[];
  format: string;
};

const MAX_METADATA_RANGE_BYTES = 16 * 1024 * 1024;
const TAG_FIELDS: { label: string; aliases: string[] }[] = [
  { label: 'Title', aliases: ['title', 'TIT2', 'TT2', '©nam'] },
  { label: 'Artist', aliases: ['artist', 'TPE1', 'TP1', '©ART'] },
  { label: 'Album', aliases: ['album', 'TALB', 'TAL', '©alb'] },
  { label: 'Album artist', aliases: ['album artist', 'TPE2', 'TP2', 'aART'] },
  { label: 'Composer', aliases: ['composer', 'TCOM', 'TCM', '©wrt', 'soco'] },
  { label: 'Genre', aliases: ['genre', 'TCON', 'TCO', '©gen'] },
  { label: 'Date', aliases: ['date', 'year', 'TDRC', 'TYER', 'TYE', 'TDRL', '©day'] },
  { label: 'Track', aliases: ['track', 'TRCK', 'TRK', 'trkn'] },
  { label: 'Disc', aliases: ['disc', 'disk', 'TPOS', 'TPA'] },
  { label: 'BPM', aliases: ['bpm', 'TBPM', 'TBP', 'tmpo'] },
  { label: 'Comment', aliases: ['comment', 'COMM', 'COM', '©cmt'] },
  { label: 'Lyrics', aliases: ['lyrics', 'USLT', 'ULT', '©lyr'] },
  { label: 'Subtitle', aliases: ['subtitle', 'TIT3', 'TT3'] },
  { label: 'Publisher', aliases: ['publisher', 'TPUB', 'TPB'] },
  { label: 'Copyright', aliases: ['copyright', 'TCOP', 'TCR', 'cprt'] },
  { label: 'Encoded by', aliases: ['encoded by', 'TENC', 'TEN', '©enc'] },
  { label: 'Encoding tool', aliases: ['©too'] },
  { label: 'Conductor', aliases: ['conductor', 'TPE3', 'TP3'] },
  { label: 'Remixer', aliases: ['remixer', 'TPE4', 'TP4'] },
  { label: 'Lyricist', aliases: ['lyricist', 'TEXT', 'TXT', 'TOLY', 'TOL'] },
  { label: 'Language', aliases: ['language', 'TLAN', 'TLA'] },
  { label: 'ISRC', aliases: ['isrc', 'TSRC', 'TRC'] },
  { label: 'Grouping', aliases: ['grouping', 'TIT1', 'TT1', '©grp'] },
  { label: 'Mood', aliases: ['mood', 'TMOO'] },
  { label: 'Initial key', aliases: ['initial key', 'TKEY', 'TKE'] },
  { label: 'Original artist', aliases: ['original artist', 'TOPE', 'TOA'] },
  { label: 'Original album', aliases: ['original album', 'TOAL', 'TOT'] },
  { label: 'Original release date', aliases: ['TORY', 'TOR'] },
  { label: 'Media type', aliases: ['media type', 'TMED', 'TMT', 'stik'] },
  { label: 'File type', aliases: ['file type', 'TFLT', 'TFT'] },
  { label: 'Album sort title', aliases: ['TSOA', 'TSA', 'soaa'] },
  { label: 'Artist sort name', aliases: ['TSOP', 'TSO2', 'TSO', 'soar'] },
  { label: 'Title sort name', aliases: ['TSOT', 'TST', 'sonm'] },
  { label: 'Recording dates', aliases: ['TRDA', 'TRD'] },
  { label: 'Recording time', aliases: ['TIME', 'TIM'] },
  { label: 'Recording location', aliases: ['TXXX:LOCATION'] },
  { label: 'Website', aliases: ['WOAR', 'WAR', 'WAF', 'WAS', 'WORS'] },
  { label: 'Publisher website', aliases: ['WPUB', 'WPB'] },
  { label: 'Copyright website', aliases: ['WCOP', 'WCP'] },
];
const TAG_ALIAS_LABELS = new Map(
  TAG_FIELDS.flatMap(({ label, aliases }) =>
    aliases.map((alias) => [alias.toLowerCase(), label] as const),
  ),
);
const AUDIO_FILE_EXTENSIONS = new Set([
  'aac',
  'amr',
  'aiff',
  'aif',
  'aifc',
  'caf',
  'flac',
  'm4a',
  'm4b',
  'mp3',
  'mp4',
  'oga',
  'ogg',
  'opus',
  '3gp',
  '3g2',
  'wav',
]);
const metadataReaders = new WeakMap<Blob, ExpoFileReader>();

function isAudioFileName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  return extension !== undefined && AUDIO_FILE_EXTENSIONS.has(extension);
}

function isAudioAsset(asset: ImportAudioAsset) {
  return asset.mimeType?.toLowerCase().startsWith('audio/') || isAudioFileName(asset.name);
}

function pickWebAudioFolder(): Promise<ImportAudioAsset[] | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');

    if (!('webkitdirectory' in input)) {
      reject(new Error('Folder selection is not supported by this browser.'));
      return;
    }

    const cleanup = () => {
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      input.remove();
    };
    const onChange = () => {
      const assets = Array.from(input.files ?? [])
        .map((file) => ({ name: file.name, mimeType: file.type, file }))
        .filter(isAudioAsset);
      cleanup();
      resolve(assets);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    input.addEventListener('change', onChange, { once: true });
    input.addEventListener('cancel', onCancel, { once: true });
    input.click();
  });
}

class ExpoFileReader extends MediaFileReader {
  private file: File | Blob;
  private handle: FileHandle | null = null;
  private chunks: { offset: number; bytes: Uint8Array }[] = [];

  constructor(file: unknown) {
    super(file);
    if (!(file instanceof Blob)) {
      throw new Error('The audio file is not available for metadata reading.');
    }
    this.file = file;
    metadataReaders.set(file, this);
  }

  close() {
    this.handle?.close();
    this.handle = null;
    this.chunks = [];
  }

  _init(callbacks: MetadataReaderCallbacks) {
    if (!(this.file instanceof File)) {
      this._size = this.file.size;
      callbacks.onSuccess();
      return;
    }

    try {
      this.handle = this.file.open(FileMode.ReadOnly);
      this._size = this.handle.size ?? this.file.size;
      callbacks.onSuccess();
    } catch (error) {
      callbacks.onError?.(error);
    }
  }

  loadRange(range: [number, number], callbacks: MetadataReaderCallbacks) {
    void (async () => {
      try {
        const [start, end] = range;
        const length = end - start + 1;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          length <= 0 ||
          length > MAX_METADATA_RANGE_BYTES
        ) {
          throw new RangeError('The audio metadata block is too large or invalid.');
        }

        let bytes: Uint8Array;
        if (this.file instanceof File) {
          const handle = this.handle;
          if (!handle) throw new Error('The audio file handle is closed.');
          handle.offset = start;
          bytes = await handle.readBytes(length);
        } else {
          bytes = new Uint8Array(await this.file.slice(start, end + 1).arrayBuffer());
        }
        if (bytes.length !== length) {
          throw new Error('The audio file ended before its metadata could be read.');
        }
        this.chunks.push({ offset: start, bytes });
        callbacks.onSuccess();
      } catch (error) {
        callbacks.onError?.(error);
      }
    })();
  }

  getByteAt(offset: number) {
    const chunk = this.chunks.find(
      (item) => offset >= item.offset && offset < item.offset + item.bytes.length,
    );
    if (!chunk) throw new RangeError(`Audio metadata byte ${offset} was not loaded.`);
    return chunk.bytes[offset - chunk.offset];
  }
}

type BrowseMode =
  | 'songs'
  | 'albums'
  | 'artists'
  | 'composers'
  | 'genres'
  | 'moods'
  | 'themes'
  | 'playlists';
type CollectionMode = Exclude<BrowseMode, 'songs' | 'playlists'>;
type SortMode =
  | 'name'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'composer'
  | 'genre'
  | 'year'
  | 'track'
  | 'disc'
  | 'bpm'
  | 'dateAdded'
  | `metadata:${string}`;

type LibraryGroup = {
  id: string;
  title: string;
  subtitle: string;
  count: number;
  tracks: Track[];
  newestAddedAt: number;
  oldestAddedAt: number;
  metadata: Record<string, string>;
  artworkUri?: string;
};

type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  generatedByAi?: boolean;
};

type LibraryListItem =
  | { kind: 'track'; track: Track }
  | { kind: 'group'; group: LibraryGroup }
  | { kind: 'playlist'; playlist: Playlist };

type DockIconName =
  | 'songs'
  | 'albums'
  | 'artists'
  | 'composers'
  | 'genres'
  | 'playlists'
  | 'files'
  | 'folder'
  | 'settings'
  | 'play'
  | 'pause';

const BROWSE_MODES: { id: BrowseMode; label: string; icon: DockIconName }[] = [
  { id: 'songs', label: 'Songs', icon: 'songs' },
  { id: 'albums', label: 'Albums', icon: 'albums' },
  { id: 'artists', label: 'Artists', icon: 'artists' },
  { id: 'composers', label: 'Composers', icon: 'composers' },
  { id: 'genres', label: 'Genres', icon: 'genres' },
  { id: 'moods', label: 'Moods', icon: 'genres' },
  { id: 'themes', label: 'Themes', icon: 'genres' },
  { id: 'playlists', label: 'Playlists', icon: 'playlists' },
];
const BROWSE_MENU_MODES = BROWSE_MODES.filter((mode) => mode.id !== 'playlists');

function DockIcon({ name, color }: { name: DockIconName; color: string }) {
  const strokeStyle = { borderColor: color };
  const fillStyle = { backgroundColor: color };

  switch (name) {
    case 'songs':
      return (
        <View style={dockIconStyles.icon}>
          <View style={[dockIconStyles.noteStem, dockIconStyles.noteStemBack, fillStyle]} />
          <View style={[dockIconStyles.noteStem, dockIconStyles.noteStemFront, fillStyle]} />
          <View style={[dockIconStyles.noteBeam, fillStyle]} />
          <View style={[dockIconStyles.noteHead, dockIconStyles.noteHeadBack, fillStyle]} />
          <View style={[dockIconStyles.noteHead, dockIconStyles.noteHeadFront, fillStyle]} />
        </View>
      );
    case 'albums':
      return (
        <View style={dockIconStyles.icon}>
          <View style={[dockIconStyles.albumBack, strokeStyle]} />
          <View style={[dockIconStyles.albumCover, strokeStyle]}>
            <View style={[dockIconStyles.albumDisc, strokeStyle]}>
              <View style={[dockIconStyles.albumCenter, fillStyle]} />
            </View>
          </View>
        </View>
      );
    case 'artists':
      return (
        <View style={dockIconStyles.icon}>
          <View style={[dockIconStyles.artistHead, fillStyle]} />
          <View style={[dockIconStyles.artistBody, fillStyle]} />
        </View>
      );
    case 'composers':
      return (
        <View style={dockIconStyles.icon}>
          <View style={[dockIconStyles.composerPage, strokeStyle]}>
            <View style={[dockIconStyles.composerLine, fillStyle]} />
            <View style={[dockIconStyles.composerLine, dockIconStyles.composerLineShort, fillStyle]} />
          </View>
          <View style={[dockIconStyles.composerPencil, fillStyle]} />
        </View>
      );
    case 'genres':
      return (
        <View style={dockIconStyles.icon}>
          <View style={[dockIconStyles.genreTag, strokeStyle]}>
            <View style={[dockIconStyles.genreHole, fillStyle]} />
          </View>
        </View>
      );
    case 'playlists':
      return (
        <View style={dockIconStyles.icon}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={dockIconStyles.playlistRow}>
              <View style={[dockIconStyles.playlistBullet, fillStyle]} />
              <View
                style={[
                  dockIconStyles.playlistLine,
                  row === 1 && dockIconStyles.playlistLineShort,
                  fillStyle,
                ]}
              />
            </View>
          ))}
        </View>
      );
    case 'files':
      return (
        <View style={dockIconStyles.icon}>
          <View style={[dockIconStyles.filePage, strokeStyle]}>
            <View style={[dockIconStyles.fileFold, strokeStyle]} />
            <View style={[dockIconStyles.fileLine, fillStyle]} />
          </View>
          <View style={[dockIconStyles.filePlusHorizontal, fillStyle]} />
          <View style={[dockIconStyles.filePlusVertical, fillStyle]} />
        </View>
      );
    case 'folder':
      return (
        <View style={dockIconStyles.icon}>
          <View style={[dockIconStyles.folderTab, strokeStyle]} />
          <View style={[dockIconStyles.folderBody, strokeStyle]} />
        </View>
      );
    case 'settings':
      return <Text style={{ color, fontSize: 19, lineHeight: 21 }}>⚙</Text>;
    case 'play':
      return (
        <View style={dockIconStyles.icon}>
          <View style={[dockIconStyles.playTriangle, { borderLeftColor: color }]} />
        </View>
      );
    case 'pause':
      return (
        <View style={[dockIconStyles.icon, dockIconStyles.pauseIcon]}>
          <View style={[dockIconStyles.pauseBar, fillStyle]} />
          <View style={[dockIconStyles.pauseBar, fillStyle]} />
        </View>
      );
  }
}

const dockIconStyles = StyleSheet.create({
  icon: {
    width: 18,
    height: 18,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteStem: {
    position: 'absolute',
    width: 1.5,
    borderRadius: 1,
  },
  noteStemBack: {
    height: 8,
    left: 7,
    top: 3,
  },
  noteStemFront: {
    height: 10,
    right: 3,
    top: 1,
  },
  noteBeam: {
    position: 'absolute',
    height: 1.5,
    width: 8,
    right: 3,
    top: 1,
    transform: [{ rotate: '-12deg' }],
  },
  noteHead: {
    position: 'absolute',
    width: 6,
    height: 4,
    borderRadius: 4,
    bottom: 3,
    transform: [{ rotate: '-22deg' }],
  },
  noteHeadBack: {
    left: 2,
  },
  noteHeadFront: {
    left: 8,
  },
  albumBack: {
    position: 'absolute',
    width: 11,
    height: 12,
    left: 2,
    top: 2,
    borderWidth: 1.3,
    borderRadius: 2,
  },
  albumCover: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  albumDisc: {
    width: 7,
    height: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 4,
  },
  albumCenter: {
    width: 2,
    height: 2,
    borderRadius: 1,
  },
  artistHead: {
    position: 'absolute',
    top: 1,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  artistBody: {
    position: 'absolute',
    bottom: 1,
    width: 14,
    height: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  composerPage: {
    position: 'absolute',
    left: 2,
    top: 1,
    width: 11,
    height: 15,
    borderWidth: 1.3,
    borderRadius: 2,
    paddingTop: 5,
    paddingHorizontal: 2,
    gap: 2,
    backgroundColor: 'transparent',
  },
  composerLine: {
    height: 1,
    width: 5,
    borderRadius: 1,
  },
  composerLineShort: {
    width: 4,
  },
  composerPencil: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 2.5,
    height: 9,
    borderRadius: 1,
    transform: [{ rotate: '38deg' }],
  },
  genreTag: {
    width: 13,
    height: 9,
    alignItems: 'flex-start',
    justifyContent: 'center',
    borderWidth: 1.4,
    borderRadius: 2,
    transform: [{ rotate: '-35deg' }],
  },
  genreHole: {
    width: 2.5,
    height: 2.5,
    borderRadius: 2,
    marginLeft: 2,
  },
  playlistRow: {
    height: 4,
    width: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  playlistBullet: {
    width: 2,
    height: 2,
    borderRadius: 1,
  },
  playlistLine: {
    height: 1.4,
    width: 10,
    borderRadius: 1,
  },
  playlistLineShort: {
    width: 7,
  },
  filePage: {
    position: 'absolute',
    left: 3,
    top: 1,
    width: 11,
    height: 15,
    borderWidth: 1.3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  fileFold: {
    position: 'absolute',
    right: -1,
    top: -1,
    width: 4,
    height: 4,
    borderLeftWidth: 1.2,
    borderBottomWidth: 1.2,
  },
  fileLine: {
    position: 'absolute',
    left: 2,
    top: 7,
    width: 5,
    height: 1,
    borderRadius: 1,
  },
  filePlusHorizontal: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 7,
    height: 1.5,
    borderRadius: 1,
  },
  filePlusVertical: {
    position: 'absolute',
    right: 2.75,
    bottom: -0.75,
    width: 1.5,
    height: 7,
    borderRadius: 1,
  },
  folderTab: {
    position: 'absolute',
    left: 2,
    top: 3,
    width: 8,
    height: 4,
    borderWidth: 1.3,
    borderBottomWidth: 0,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  folderBody: {
    position: 'absolute',
    left: 1,
    top: 6,
    width: 16,
    height: 10,
    borderWidth: 1.3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 2,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 9,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  pauseIcon: {
    flexDirection: 'row',
    gap: 3,
  },
  pauseBar: {
    width: 2.5,
    height: 10,
    borderRadius: 1,
  },
});

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'albumArtist', label: 'Album artist' },
  { id: 'composer', label: 'Composer' },
  { id: 'genre', label: 'Genre' },
  { id: 'year', label: 'Year / date' },
  { id: 'track', label: 'Track' },
  { id: 'disc', label: 'Disc' },
  { id: 'bpm', label: 'BPM' },
  { id: 'dateAdded', label: 'Date added' },
];
const METADATA_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function isTrack(value: unknown): value is Track {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as Partial<Track>;
  return (
    typeof track.id === 'string' &&
    typeof track.uri === 'string' &&
    typeof track.fileName === 'string' &&
    typeof track.title === 'string' &&
    typeof track.artist === 'string' &&
    (track.artworkUri === undefined || typeof track.artworkUri === 'string') &&
    (track.metadata === undefined ||
      (typeof track.metadata === 'object' &&
        track.metadata !== null &&
        Object.values(track.metadata).every((item) => typeof item === 'string'))) &&
    (track.metadataVersion === undefined || typeof track.metadataVersion === 'number') &&
    (track.album === undefined || typeof track.album === 'string') &&
    (track.albumArtist === undefined || typeof track.albumArtist === 'string') &&
    (track.composer === undefined || typeof track.composer === 'string') &&
    (track.genre === undefined || typeof track.genre === 'string') &&
    (track.metadataLoaded === undefined || typeof track.metadataLoaded === 'boolean') &&
    (track.aiTags === undefined ||
      (Array.isArray(track.aiTags) &&
        track.aiTags.every(
          (tag) =>
            typeof tag === 'object' &&
            tag !== null &&
            (tag.category === 'genre' || tag.category === 'mood' || tag.category === 'theme') &&
            typeof tag.label === 'string' &&
            typeof tag.score === 'number',
        ))) &&
    (track.aiAnalyzedAt === undefined || typeof track.aiAnalyzedAt === 'number') &&
    (track.aiError === undefined || typeof track.aiError === 'string') &&
    typeof track.addedAt === 'number'
  );
}

function isPlaylist(value: unknown): value is Playlist {
  if (typeof value !== 'object' || value === null) return false;
  const playlist = value as Partial<Playlist>;
  return (
    typeof playlist.id === 'string' &&
    typeof playlist.name === 'string' &&
    Array.isArray(playlist.trackIds) &&
    playlist.trackIds.every((id) => typeof id === 'string') &&
    typeof playlist.createdAt === 'number' &&
    typeof playlist.updatedAt === 'number' &&
    (playlist.generatedByAi === undefined || typeof playlist.generatedByAi === 'boolean')
  );
}

function trackDetails(fileName: string) {
  const name = fileName.replace(/\.[^.]+$/, '');
  const separator = name.match(/\s[-–—]\s/);
  if (!separator || separator.index === undefined) {
    return { title: name || fileName, artist: 'Unknown artist' };
  }

  return {
    artist: name.slice(0, separator.index).trim() || 'Unknown artist',
    title: name.slice(separator.index + separator[0].length).trim() || name,
  };
}

async function readTrackMetadata(
  file: Blob,
  fallback: Pick<Track, 'title' | 'artist'>,
  trackId: string,
  makeWebObjectUrl: (blob: Blob) => string,
  cleanupFiles?: File[],
): Promise<TrackMetadata> {
  const parsed = await readAudioTags(file);
  const { tags } = parsed;
  const picture =
    typeof tags.picture === 'object' && tags.picture !== null
      ? tags.picture as Partial<AudioArtwork>
      : undefined;
  const tagText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value.trim() || undefined;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      if (value.every((item) => typeof item === 'number')) return undefined;
      return value.map(tagText).filter((entry): entry is string => Boolean(entry)).join('; ');
    }
    if (typeof value === 'object' && value !== null) {
      if ('data' in value) return tagText(value.data);
      const record = value as Record<string, unknown>;
      const position = record.track ?? record.disk;
      if (typeof position === 'number') {
        const total = typeof record.total === 'number' ? ` of ${record.total}` : '';
        return `${position}${total}`;
      }
    }
    return undefined;
  };
  const findTag = (aliases: string[]) => {
    for (const alias of aliases) {
      const match = Object.keys(tags).find((key) => key.toLowerCase() === alias.toLowerCase());
      if (match) {
        const value = tagText(tags[match]);
        if (value) return value;
      }
    }
    return undefined;
  };
  const metadata: Record<string, string> = {};
  for (const { label, aliases } of TAG_FIELDS) {
    const value = findTag(aliases);
    if (value) metadata[label] = value;
  }

  const artist = metadata.Artist || fallback.artist;
  const title = metadata.Title || fallback.title;
  metadata.Title = title;
  metadata.Artist = artist;
  metadata['File size'] = formatFileSize(file.size);
  if (file.type) metadata['MIME type'] = file.type;
  if (parsed.type) metadata['Tag format'] = parsed.type;
  if (parsed.version) metadata['Tag version'] = parsed.version;

  const knownAliases = new Set(
    TAG_FIELDS.flatMap(({ aliases }) => aliases.map((alias) => alias.toLowerCase())),
  );
  for (const [key, rawValue] of Object.entries(tags)) {
    if (key.toLowerCase() === 'picture' || knownAliases.has(key.toLowerCase())) continue;
    const value = tagText(rawValue);
    if (!value) continue;

    const tag = rawValue as { description?: unknown } | null;
    const description =
      typeof tag?.description === 'string' ? tag.description.trim() : undefined;
    const normalizedKey = key.replace(/^(©|_)/, '').replace(/[_-]+/g, ' ').trim();
    const label =
      TAG_ALIAS_LABELS.get(key.toLowerCase()) ??
      (description && description.length > 0
        ? description
        : normalizedKey || key);
    if (!(label in metadata)) metadata[label] = value;
  }

  const artworkUri =
    picture &&
    Array.isArray(picture.data) &&
    picture.data.length > 0 &&
    picture.data.length <= MAX_ARTWORK_BYTES &&
    picture.data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) &&
    typeof picture.format === 'string'
      ? await saveTrackArtwork(
          trackId,
          { data: picture.data, format: picture.format },
          makeWebObjectUrl,
          cleanupFiles,
        )
      : undefined;

  return {
    title,
    artist,
    album: metadata.Album,
    albumArtist: metadata['Album artist'] || artist,
    composer: metadata.Composer,
    genre: metadata.Genre,
    artworkUri,
    metadata,
    metadataVersion: TRACK_METADATA_VERSION,
    metadataLoaded: true,
  };
}

async function saveTrackArtwork(
  trackId: string,
  artwork: AudioArtwork,
  makeWebObjectUrl: (blob: Blob) => string,
  cleanupFiles?: File[],
) {
  const format = artwork.format.toLowerCase().trim();
  const mimeType =
    format === 'jpg' || format === 'jpeg' || format === 'image/jpg' || format === 'image/jpeg'
      ? 'image/jpeg'
      : format === 'png' || format === 'image/png'
        ? 'image/png'
        : format === 'gif' || format === 'image/gif'
          ? 'image/gif'
          : format === 'webp' || format === 'image/webp'
            ? 'image/webp'
            : null;
  if (!mimeType) return undefined;

  const bytes = Uint8Array.from(artwork.data);
  if (Platform.OS === 'web') {
    const blob = new Blob([bytes], { type: mimeType });
    await saveWebArtwork(trackId, blob);
    return makeWebObjectUrl(blob);
  }

  const extension = mimeType.slice('image/'.length).replace('jpeg', 'jpg');
  const directory = new Directory(Paths.document, ARTWORK_FOLDER);
  directory.create({ intermediates: true, idempotent: true });
  const imageFile = new File(directory, `${trackId}.${extension}`);
  if (imageFile.exists) return imageFile.uri;

  imageFile.create();
  cleanupFiles?.push(imageFile);
  try {
    await imageFile.write(bytes);
    return imageFile.uri;
  } catch (error) {
    if (imageFile.exists) imageFile.delete();
    if (cleanupFiles) {
      const fileIndex = cleanupFiles.indexOf(imageFile);
      if (fileIndex >= 0) cleanupFiles.splice(fileIndex, 1);
    }
    throw error;
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fallbackTrackMetadata(
  file: Blob,
  fallback: Pick<Track, 'title' | 'artist'>,
): TrackMetadata {
  const metadata: Record<string, string> = {
    Title: fallback.title,
    Artist: fallback.artist,
    'File size': formatFileSize(file.size),
  };
  if (file.type) metadata['MIME type'] = file.type;
  return {
    ...fallback,
    metadata,
    metadataVersion: TRACK_METADATA_VERSION,
    metadataLoaded: true,
  };
}

function readAudioTags(file: Blob): Promise<ParsedAudioTags> {
  return new Promise((resolve, reject) => {
    const releaseReader = () => {
      const reader = metadataReaders.get(file);
      if (reader) {
        if (reader instanceof ExpoFileReader) reader.close();
        metadataReaders.delete(file);
      }
    };

    try {
      const FileReader: MetadataBlobReader =
        Platform.OS === 'web' ? BlobFileReader : ExpoFileReader;
      new Reader(file)
        .setFileReader(FileReader)
        .read({
          onSuccess: (result) => {
            try {
              releaseReader();
              resolve(result);
            } catch (error) {
              reject(error);
            }
          },
          onError: (error) => {
            try {
              releaseReader();
              reject(error);
            } catch (releaseError) {
              reject(releaseError);
            }
          },
        });
    } catch (error) {
      try {
        releaseReader();
        reject(error);
      } catch (releaseError) {
        reject(releaseError);
      }
    }
  });
}

function groupDetails(track: Track, mode: CollectionMode) {
  const aiCategory =
    mode === 'genres'
      ? 'genre'
      : mode === 'moods'
        ? 'mood'
        : mode === 'themes'
          ? 'theme'
          : null;
  const aiTag =
    aiCategory &&
    track.aiTags
      ?.filter((tag) => tag.category === aiCategory)
      .sort((first, second) => second.score - first.score)[0];
  if ((mode === 'moods' || mode === 'themes') && !aiTag) return null;

  const title = (() => {
    switch (mode) {
      case 'albums':
        return track.album?.trim() || 'Unknown album';
      case 'artists':
        return track.artist.trim() || 'Unknown artist';
      case 'composers':
        return track.composer?.trim() || 'Unknown composer';
      case 'genres':
        return aiTag?.label || track.genre?.trim() || 'Unknown genre';
      case 'moods':
      case 'themes':
        return aiTag?.label ?? '';
    }
  })();
  const albumArtist = track.albumArtist?.trim() || track.artist.trim() || 'Unknown artist';
  const identity =
    mode === 'albums'
      ? [mode, title.toLocaleLowerCase(), albumArtist.toLocaleLowerCase()]
      : [mode, title.toLocaleLowerCase()];

  return {
    id: JSON.stringify(identity),
    title,
    subtitle: mode === 'albums' ? albumArtist : '',
  };
}

function trackSortValue(track: Track, sortMode: SortMode) {
  if (sortMode.startsWith('metadata:')) {
    return track.metadata?.[sortMode.slice('metadata:'.length)] ?? '';
  }
  switch (sortMode) {
    case 'name':
      return track.title;
    case 'artist':
      return track.artist;
    case 'album':
      return track.album ?? '';
    case 'albumArtist':
      return track.albumArtist ?? '';
    case 'composer':
      return track.composer ?? '';
    case 'genre':
      return (
        track.aiTags?.find((tag) => tag.category === 'genre')?.label ??
        track.genre ??
        ''
      );
    case 'year':
      return track.metadata?.Date ?? '';
    case 'track':
      return track.metadata?.Track ?? '';
    case 'disc':
      return track.metadata?.Disc ?? '';
    case 'bpm':
      return track.metadata?.BPM ?? '';
    case 'dateAdded':
      return '';
    default:
      return track.metadata?.[sortMode] ?? '';
  }
}

function groupSortValue(
  group: LibraryGroup,
  sortMode: SortMode,
  browseMode: BrowseMode,
) {
  if (sortMode.startsWith('metadata:')) {
    return group.metadata[sortMode.slice('metadata:'.length)] ?? group.title;
  }
  if (sortMode === 'dateAdded') return '';
  if (sortMode === 'name') return group.title;
  if (sortMode === 'artist' && browseMode === 'albums') return group.subtitle;
  const fieldBySortMode: Partial<Record<SortMode, string>> = {
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Album artist',
    composer: 'Composer',
    genre: 'Genre',
    year: 'Date',
    track: 'Track',
    disc: 'Disc',
    bpm: 'BPM',
  };
  const field = fieldBySortMode[sortMode];
  return (field && group.metadata[field]) || group.title;
}

function compareMetadataValues(first: string, second: string) {
  return METADATA_COLLATOR.compare(first, second);
}

function shuffleTracks(tracksToShuffle: Track[]) {
  const shuffled = [...tracksToShuffle];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function isPickerCancelled(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return (
    error.code === 'ERR_CANCELED' ||
    error.code === 'ERR_DOCUMENT_PICKER_CANCELED' ||
    error.code === 'DOCUMENT_PICKER_CANCELED'
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function AudioStatusBridge({
  trackId,
  onStatus,
}: {
  trackId: string;
  onStatus: (
    trackId: string,
    status: { currentTime: number; duration: number; playing: boolean },
  ) => void;
}) {
  const { currentTime, duration, playbackState } = useAudioTagContext();
  const playing = playbackState === 'playing' || playbackState === 'buffering';

  useEffect(() => {
    onStatus(trackId, { currentTime, duration, playing });
  }, [currentTime, duration, onStatus, playing, trackId]);

  return null;
}

function Artwork({
  seed,
  size,
  uri,
  styles,
}: {
  seed: string;
  size: number;
  uri?: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const colorIndex = [...seed].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const color = ART_COLORS[colorIndex % ART_COLORS.length];
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showImage = Boolean(uri && failedUri !== uri);

  return (
    <View
      style={[
        styles.artwork,
        { width: size, height: size, backgroundColor: color },
      ]}
      accessible={false}
    >
      {uri && showImage ? (
        <Image
          accessibilityIgnoresInvertColors
          onError={() => setFailedUri(uri)}
          resizeMode="cover"
          source={{ uri }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <>
          <View style={[styles.artworkOrb, { width: size * 0.72, height: size * 0.72 }]} />
          <Text style={[styles.artworkNote, { fontSize: size * 0.48 }]}>♫</Text>
        </>
      )}
    </View>
  );
}

function ProgressBar({
  currentTime,
  duration,
  onSeek,
  compact = false,
  draggable = false,
  styles,
}: {
  currentTime: number;
  duration: number;
  onSeek: (position: number) => void;
  compact?: boolean;
  draggable?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const [width, setWidth] = useState(0);
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  return (
    <View>
      {draggable ? (
        <Slider
          accessibilityLabel="Playback position"
          disabled={duration <= 0}
          maximumTrackTintColor={styles.progressTrack.backgroundColor as string}
          maximumValue={Math.max(duration, 1)}
          minimumTrackTintColor={styles.progressFill.backgroundColor as string}
          minimumValue={0}
          onSlidingComplete={onSeek}
          style={styles.seekSlider}
          value={Math.min(currentTime, duration)}
        />
      ) : (
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            if (width > 0 && duration > 0) {
              onSeek((event.nativeEvent.locationX / width) * duration);
            }
          }}
          style={[styles.progressTrack, compact && styles.progressTrackCompact]}
        >
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </Pressable>
      )}
      {!compact && (
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
      )}
    </View>
  );
}

function QueueDragHandle({
  id,
  index,
  title,
  onMove,
  onDragStateChange,
  styles,
}: {
  id: string;
  index: number;
  title: string;
  onMove: (trackId: string, targetIndex: number) => void;
  onDragStateChange: (trackId: string | null) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => onDragStateChange(id),
        onPanResponderRelease: (_, gesture) => {
          onMove(id, Math.max(0, index + Math.round(gesture.dy / 65)));
          onDragStateChange(null);
        },
        onPanResponderTerminate: () => onDragStateChange(null),
        onPanResponderTerminationRequest: () => false,
      }),
    [id, index, onDragStateChange, onMove],
  );

  return (
    <View
      {...panResponder.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={`Drag ${title} to reorder`}
      accessibilityHint="Touch and hold, then drag up or down to change the queue order."
      onAccessibilityAction={(event) => {
        const direction = event.nativeEvent.actionName === 'decrement' ? -1 : 1;
        onMove(id, index + direction);
      }}
      accessibilityActions={[
        { name: 'decrement', label: 'Move up' },
        { name: 'increment', label: 'Move down' },
      ]}
      style={styles.queueDragHandle}
    >
      <Text style={styles.queueDragGlyph}>⠿</Text>
    </View>
  );
}

function MusicPlayer() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const playerArtworkSize = Math.min(screenWidth - 60, 340);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [themeReady, setThemeReady] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiSettingsReady, setAiSettingsReady] = useState(false);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const isLightTheme = theme === 'light';
  const COLORS = THEME_COLORS[theme];
  const styles = useMemo(
    () => createStyles(COLORS, isLightTheme),
    [COLORS, isLightTheme],
  );
  const [audioContext] = useState<AudioContext | null>(() =>
    Platform.OS === 'web' ? null : new AudioContext({ latencyHint: 'playback' }),
  );
  const audioRef = useRef<AudioTagHandle>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const volumeChangeVersion = useRef(0);
  const libraryBlurTarget = useRef<ComponentRef<typeof View> | null>(null);
  const equalizerSource = useRef<MediaElementAudioSourceNode | null>(null);
  const equalizerFilters = useRef<BiquadFilterNode[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsReady, setPlaylistsReady] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<Track[]>([]);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [trackOptionsTrack, setTrackOptionsTrack] = useState<Track | null>(null);
  const [detailsTrack, setDetailsTrack] = useState<Track | null>(null);
  const [playlistTrack, setPlaylistTrack] = useState<Track | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlistEditorId, setPlaylistEditorId] = useState<string | null>(null);
  const [playlistEditorTrackId, setPlaylistEditorTrackId] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistFormError, setPlaylistFormError] = useState('');
  const [playback, setPlayback] = useState({ currentTime: 0, duration: 0, playing: false });
  const [search, setSearch] = useState('');
  const [browseMode, setBrowseMode] = useState<BrowseMode>('songs');
  const [isBrowseMenuOpen, setIsBrowseMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [sortDirection, setSortDirection] = useState<'ascending' | 'descending'>(
    'ascending',
  );
  const [selectedGroup, setSelectedGroup] = useState<LibraryGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [dropFolderUri, setDropFolderUri] = useState<string | null>(null);
  const [dropFolderReady, setDropFolderReady] = useState(false);
  const [ignoredDropSources, setIgnoredDropSources] = useState<string[]>([]);
  const [isScanningDropFolder, setIsScanningDropFolder] = useState(false);
  const [dropFolderScanProgress, setDropFolderScanProgress] = useState<{
    phase: 'scanning' | 'importing';
    found: number;
    processed: number;
  } | null>(null);
  const [dropFolderScanRequest, setDropFolderScanRequest] = useState(0);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isAddingQueueTracks, setIsAddingQueueTracks] = useState(false);
  const [draggingQueueTrackId, setDraggingQueueTrackId] = useState<string | null>(null);
  const [isEqualizerOpen, setIsEqualizerOpen] = useState(false);
  const [isPlaylistEditorOpen, setIsPlaylistEditorOpen] = useState(false);
  const [equalizerSettings, setEqualizerSettings] =
    useState<EqualizerSettings>(DEFAULT_EQUALIZER);
  const [equalizerLoaded, setEqualizerLoaded] = useState(false);
  const [isShuffling, setIsShuffling] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [notice, setNotice] = useState('');
  const tracksRef = useRef<Track[]>([]);
  const handledDropFolderScanRequest = useRef(0);
  const notificationPermissionRequested = useRef(false);
  const webObjectUrls = useRef(new Set<string>());
  const notificationActions = useRef({
    play: () => {},
    pause: () => {},
    next: () => {},
    previous: () => {},
    seek: (_seconds: number) => {},
    stop: () => {},
  });

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let active = true;
    const requestVersion = volumeChangeVersion.current;
    const subscription = VolumeManager.addVolumeListener(({ volume, type }) => {
      if (Platform.OS === 'android' && type !== undefined && type !== 'music') return;
      volumeChangeVersion.current += 1;
      setPlayerVolume(volume);
    });

    void VolumeManager.getVolume()
      .then(({ volume }) => {
        if (active && volumeChangeVersion.current === requestVersion) {
          setPlayerVolume(volume);
        }
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Could not read system media volume: ${errorMessage(error)}`);
      });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const makeWebObjectUrl = useCallback((blob: Blob) => {
    const uri = URL.createObjectURL(blob);
    webObjectUrls.current.add(uri);
    return uri;
  }, []);

  const revokeWebObjectUrl = (uri: string) => {
    if (!webObjectUrls.current.delete(uri)) return;
    URL.revokeObjectURL(uri);
  };

  const saveLibrary = useCallback((library: Track[]) =>
    AsyncStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify(
        library.map((track) =>
          Platform.OS === 'web'
            ? {
                ...track,
                uri: track.uri.startsWith('blob:') ? webTrackUri(track.id) : track.uri,
                artworkUri: track.artworkUri?.startsWith('blob:')
                  ? webArtworkUri(track.id)
                  : track.artworkUri,
              }
            : track,
        ),
      ),
    ), []);

  const savePlaylists = (nextPlaylists: Playlist[]) =>
    AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(nextPlaylists));

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark') {
          if (active) setTheme(saved);
        }
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Could not load appearance setting: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setThemeReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(MUSIC_AI_ENABLED_KEY)
      .then((saved) => {
        if (active) setAiEnabled(saved === 'true');
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Could not load AI feature setting: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setAiSettingsReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      AsyncStorage.getItem(DROP_FOLDER_KEY),
      AsyncStorage.getItem(IGNORED_DROP_SOURCES_KEY),
    ])
      .then(([savedUri, savedIgnoredSources]) => {
        if (active && savedUri) setDropFolderUri(savedUri);
        if (savedIgnoredSources) {
          const parsed: unknown = JSON.parse(savedIgnoredSources);
          if (!Array.isArray(parsed) || !parsed.every((source) => typeof source === 'string')) {
            throw new Error('The saved ignored music files could not be read.');
          }
          if (active) setIgnoredDropSources(parsed);
        }
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Could not load music drop folder settings: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setDropFolderReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    void AsyncStorage.setItem(THEME_KEY, theme).catch((error: unknown) => {
      setNotice(`Could not save appearance setting: ${errorMessage(error)}`);
    });
  }, [theme, themeReady]);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PLAYLISTS_KEY)
      .then((saved) => {
        if (!saved) return;
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed)) {
          throw new Error('Your saved playlists could not be read.');
        }
        if (active) setPlaylists(parsed.filter(isPlaylist));
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Could not load playlists: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setPlaylistsReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      webObjectUrls.current.forEach((uri) => URL.revokeObjectURL(uri));
      webObjectUrls.current.clear();
    },
    [],
  );

  const visibleTracks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return tracks;
    return tracks.filter(
      (track) =>
        track.title.toLocaleLowerCase().includes(query) ||
        track.artist.toLocaleLowerCase().includes(query) ||
        track.album?.toLocaleLowerCase().includes(query) ||
        track.albumArtist?.toLocaleLowerCase().includes(query) ||
        track.composer?.toLocaleLowerCase().includes(query) ||
        track.genre?.toLocaleLowerCase().includes(query) ||
        track.aiTags?.some(({ category, label }) =>
          `${category} ${label}`.toLocaleLowerCase().includes(query),
        ) ||
        track.fileName.toLocaleLowerCase().includes(query) ||
        Object.entries(track.metadata ?? {}).some(([field, value]) =>
          `${field} ${value}`.toLocaleLowerCase().includes(query),
        ),
    );
  }, [search, tracks]);

  const tracksById = useMemo(
    () => new Map(tracks.map((track) => [track.id, track])),
    [tracks],
  );

  const unsortedGroups = useMemo(() => {
    if (browseMode === 'songs' || browseMode === 'playlists') return [];

    const groups = new Map<string, LibraryGroup>();
    for (const track of visibleTracks) {
      const details = groupDetails(track, browseMode);
      if (!details) continue;
      const existing = groups.get(details.id);
      if (existing) {
        existing.count += 1;
        existing.tracks.push(track);
        existing.newestAddedAt = Math.max(existing.newestAddedAt, track.addedAt);
        existing.oldestAddedAt = Math.min(existing.oldestAddedAt, track.addedAt);
        if (!existing.artworkUri && track.artworkUri) existing.artworkUri = track.artworkUri;
      } else {
        groups.set(details.id, {
          ...details,
          count: 1,
          tracks: [track],
          newestAddedAt: track.addedAt,
          oldestAddedAt: track.addedAt,
          metadata: track.metadata ?? {},
          artworkUri: track.artworkUri,
        });
      }
    }

    return [...groups.values()];
  }, [browseMode, visibleTracks]);

  const groupedLibrary = useMemo(
    () =>
      unsortedGroups
        .map((group) => ({
          group,
          sortValue: groupSortValue(group, sortMode, browseMode),
        }))
        .sort((first, second) => {
          const comparison =
            sortMode === 'dateAdded'
              ? first.group.newestAddedAt - second.group.newestAddedAt
              : compareMetadataValues(first.sortValue, second.sortValue);
          return comparison * (sortDirection === 'ascending' ? 1 : -1);
        })
        .map(({ group }) => group),
    [browseMode, sortDirection, sortMode, unsortedGroups],
  );

  const listingGroups =
    browseMode !== 'songs' && browseMode !== 'playlists' && selectedGroup === null;
  const tracksForList = useMemo(
    () => {
      if (selectedPlaylistId !== null) {
        const playlist = playlists.find((item) => item.id === selectedPlaylistId);
        if (!playlist) return [];
        const playlistTrackIds = new Set(playlist.trackIds);
        return visibleTracks.filter((track) => playlistTrackIds.has(track.id));
      }
      if (selectedGroup && browseMode !== 'songs' && browseMode !== 'playlists') {
        const collectionMode: CollectionMode = browseMode;
        return visibleTracks.filter(
          (track) => groupDetails(track, collectionMode)?.id === selectedGroup.id,
        );
      }
      return visibleTracks;
    },
    [browseMode, playlists, selectedGroup, selectedPlaylistId, visibleTracks],
  );
  const sortedTracks = useMemo(() => {
    return tracksForList
      .map((track) => ({
        track,
        sortValue: trackSortValue(track, sortMode),
      }))
      .sort((first, second) => {
        const comparison =
          sortMode === 'dateAdded'
            ? first.track.addedAt - second.track.addedAt
            : compareMetadataValues(first.sortValue, second.sortValue) ||
              compareMetadataValues(first.track.title, second.track.title);
        return comparison * (sortDirection === 'ascending' ? 1 : -1);
      })
      .map(({ track }) => track);
  }, [sortDirection, sortMode, tracksForList]);
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;
  const listingPlaylists = browseMode === 'playlists' && selectedPlaylist === null;
  const aiAnalyzedCount = tracks.filter(
    (track) => track.aiAnalyzedAt !== undefined && !track.aiError,
  ).length;
  const aiFailedCount = tracks.filter((track) => track.aiError !== undefined).length;
  const visiblePlaylists = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return playlists
      .filter((playlist) => !query || playlist.name.toLocaleLowerCase().includes(query))
      .sort((first, second) => {
        const comparison =
          sortMode === 'dateAdded'
            ? first.createdAt - second.createdAt
            : compareMetadataValues(first.name, second.name);
        return comparison * (sortDirection === 'ascending' ? 1 : -1);
      });
  }, [playlists, search, sortDirection, sortMode]);
  const libraryItems = useMemo<LibraryListItem[]>(
    () => {
      if (listingPlaylists) {
        return visiblePlaylists.map((playlist) => ({ kind: 'playlist', playlist }));
      }
      if (listingGroups) return groupedLibrary.map((group) => ({ kind: 'group', group }));
      return sortedTracks.map((track) => ({ kind: 'track', track }));
    },
    [groupedLibrary, listingGroups, listingPlaylists, sortedTracks, visiblePlaylists],
  );
  const pendingAiTrackIds = tracks
    .filter((track) => track.aiAnalyzedAt === undefined && !track.aiError)
    .map((track) => track.id)
    .join('|');

  useEffect(() => {
    if (!aiSettingsReady || Platform.OS === 'web') return;
    const updateBackgroundSchedule = aiEnabled && pendingAiTrackIds
      ? registerMusicAiBackgroundTask
      : unregisterMusicAiBackgroundTask;
    void updateBackgroundSchedule().catch((error: unknown) => {
      setNotice(`Could not update AI background scheduling: ${errorMessage(error)}`);
    });
  }, [aiEnabled, aiSettingsReady, pendingAiTrackIds]);

  useEffect(() => {
    let active = true;

    async function loadLibrary() {
      try {
        const saved = await AsyncStorage.getItem(LIBRARY_KEY);
        const parsed: unknown = saved ? JSON.parse(saved) : [];
        if (!Array.isArray(parsed)) {
          throw new Error('Your saved music library could not be read.');
        }

        const validTracks = parsed.filter(isTrack);
        const availableTracks: { track: Track; audio: Blob }[] = [];
        for (const track of validTracks) {
          if (Platform.OS === 'web') {
            if (!isWebTrackUri(track.uri)) continue;
            const audio = await loadWebAudio(track.id);
            if (audio) availableTracks.push({ track, audio });
            continue;
          }
          const file = new File(track.uri);
          if (file.exists) availableTracks.push({ track, audio: file });
        }
        const metadataReadFailures: string[] = [];
        const migratedTracks: Track[] = [];
        for (const { track, audio } of availableTracks) {
          let artworkUri = track.artworkUri;
          if (Platform.OS === 'web' && track.artworkUri === webArtworkUri(track.id)) {
            const artworkBlob = await loadWebArtwork(track.id);
            artworkUri = artworkBlob ? makeWebObjectUrl(artworkBlob) : undefined;
          }
          const playableTrack = {
            ...track,
            uri: Platform.OS === 'web' ? makeWebObjectUrl(audio) : track.uri,
            artworkUri,
          };
          if (
            track.metadataLoaded &&
            track.metadataVersion === TRACK_METADATA_VERSION
          ) {
            migratedTracks.push(playableTrack);
            continue;
          }
          try {
            const metadata = await readTrackMetadata(
              audio,
              track,
              track.id,
              makeWebObjectUrl,
            );
            migratedTracks.push({
              ...playableTrack,
              ...metadata,
              artworkUri: metadata.artworkUri ?? playableTrack.artworkUri,
            });
          } catch (error) {
            metadataReadFailures.push(track.fileName);
            console.warn(
              `Could not read audio tags for saved track ${track.fileName}: ${errorMessage(error)}`,
            );
            migratedTracks.push({
              ...playableTrack,
              metadata: track.metadata ?? fallbackTrackMetadata(audio, track).metadata,
              metadataVersion: TRACK_METADATA_VERSION,
              metadataLoaded: true,
            });
          }
        }
        if (active) {
          setTracks(migratedTracks);
          const libraryChanged = migratedTracks.some(
            (track) => {
              const savedTrack = parsed.find(
                (saved): saved is Track => isTrack(saved) && saved.id === track.id,
              );
              return (
                track.metadataVersion !== TRACK_METADATA_VERSION ||
                track.uri !== savedTrack?.uri ||
                savedTrack?.metadataVersion !== track.metadataVersion
              );
            },
          ) || migratedTracks.length !== parsed.length;
          if (libraryChanged) {
            await saveLibrary(migratedTracks);
          }
          const loadWarnings = [
            ...(migratedTracks.length !== parsed.length
              ? ['Some saved tracks were unavailable and have been removed from your library.']
              : []),
            ...(metadataReadFailures.length > 0
              ? [`Tags could not be read for ${metadataReadFailures.length} saved ${
                  metadataReadFailures.length === 1 ? 'song' : 'songs'
                }; filename details remain available.`]
              : []),
          ];
          if (loadWarnings.length > 0) {
            setNotice(loadWarnings.join(' '));
          }
          if (!active && Platform.OS === 'web') {
            migratedTracks.forEach((track) => revokeWebObjectUrl(track.uri));
          }
        }
      } catch (error) {
        if (active) setNotice(`Could not load your music library: ${errorMessage(error)}`);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadLibrary();
    return () => {
      active = false;
    };
  }, [makeWebObjectUrl, saveLibrary]);

  useEffect(() => {
    if (
      !aiEnabled ||
      !aiSettingsReady ||
      Platform.OS === 'web' ||
      isLoading ||
      !playlistsReady ||
      !pendingAiTrackIds
    ) {
      return;
    }

    let active = true;
    void Promise.resolve()
      .then(() => {
        if (!active) return undefined;
        setIsAiAnalyzing(true);
        return processPendingMusicAiTracks(1);
      })
      .then(async (result) => {
        if (!active || !result || result.processedCount === 0) return;
        const updatesById = new Map(result.tracks.map((track) => [track.id, track]));
        const updatedTracks = tracksRef.current.map((track) => {
          const analyzedTrack = updatesById.get(track.id);
          if (!analyzedTrack || analyzedTrack.aiAnalyzedAt === undefined) return track;
          const updatedTrack: Track = {
            ...track,
            aiTags: analyzedTrack.aiTags ?? [],
            aiAnalyzedAt: analyzedTrack.aiAnalyzedAt,
          };
          if (analyzedTrack.aiError) updatedTrack.aiError = analyzedTrack.aiError;
          else delete updatedTrack.aiError;
          return updatedTrack;
        });
        await saveLibrary(updatedTracks);
        if (!active) return;
        setTracks(updatedTracks);
        setPlaylists(result.playlists);
        if (result.failedCount > 0) {
          setNotice(
            `AI analysis could not read ${result.failedCount} audio ${
              result.failedCount === 1 ? 'file' : 'files'
            }. Other songs will continue to be analyzed.`,
          );
        }
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Could not analyze music: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setIsAiAnalyzing(false);
      });

    return () => {
      active = false;
    };
  }, [
    aiEnabled,
    aiSettingsReady,
    isLoading,
    pendingAiTrackIds,
    playlistsReady,
    saveLibrary,
  ]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void (async () => {
        const [savedLibrary, savedPlaylists] = await Promise.all([
          AsyncStorage.getItem(MUSIC_LIBRARY_KEY),
          AsyncStorage.getItem(MUSIC_PLAYLISTS_KEY),
        ]);
        const parsedLibrary: unknown = savedLibrary ? JSON.parse(savedLibrary) : [];
        const parsedPlaylists: unknown = savedPlaylists ? JSON.parse(savedPlaylists) : [];
        if (!Array.isArray(parsedLibrary) || !parsedLibrary.every(isTrack)) {
          throw new Error('The saved music library could not be refreshed.');
        }
        if (!Array.isArray(parsedPlaylists) || !parsedPlaylists.every(isPlaylist)) {
          throw new Error('The saved playlists could not be refreshed.');
        }
        if (!active) return;

        const savedTracksById = new Map(parsedLibrary.map((track) => [track.id, track]));
        setTracks((currentTracks) =>
          currentTracks.map((track) => {
            const savedTrack = savedTracksById.get(track.id);
            if (
              !savedTrack ||
              savedTrack.aiAnalyzedAt === undefined ||
              (track.aiAnalyzedAt !== undefined &&
                track.aiAnalyzedAt >= savedTrack.aiAnalyzedAt)
            ) {
              return track;
            }
            const refreshedTrack: Track = {
              ...track,
              aiTags: savedTrack.aiTags ?? [],
              aiAnalyzedAt: savedTrack.aiAnalyzedAt,
            };
            if (savedTrack.aiError) refreshedTrack.aiError = savedTrack.aiError;
            else delete refreshedTrack.aiError;
            return refreshedTrack;
          }),
        );
        setPlaylists((currentPlaylists) => [
          ...currentPlaylists.filter((playlist) => !playlist.generatedByAi),
          ...parsedPlaylists.filter((playlist) => playlist.generatedByAi),
        ]);
      })().catch((error: unknown) => {
        if (active) {
          setNotice(`Could not refresh background music analysis: ${errorMessage(error)}`);
        }
      });
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const changeEqualizerSettings = useCallback((settings: EqualizerSettings) => {
    try {
      equalizerFilters.current.forEach((filter, index) => {
        filter.gain.value = settings.enabled ? settings.bands[index] : 0;
      });
      setEqualizerSettings(settings);
    } catch (error) {
      setNotice(`Could not update equalizer output: ${errorMessage(error)}`);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(EQUALIZER_KEY)
      .then((saved) => {
        if (!active || saved === null) return;
        const parsed: unknown = JSON.parse(saved);
        if (!isEqualizerSettings(parsed)) {
          throw new Error('Saved equalizer settings are invalid.');
        }
        changeEqualizerSettings(parsed);
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Could not load equalizer settings: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setEqualizerLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [changeEqualizerSettings]);

  useEffect(() => {
    if (!equalizerLoaded) return;
    const timeout = setTimeout(() => {
      void AsyncStorage.setItem(EQUALIZER_KEY, JSON.stringify(equalizerSettings)).catch(
        (error: unknown) => setNotice(`Could not save equalizer settings: ${errorMessage(error)}`),
      );
    }, 300);
    return () => clearTimeout(timeout);
  }, [equalizerLoaded, equalizerSettings]);

  useEffect(
    () => () => {
      equalizerSource.current?.disconnect();
      equalizerFilters.current.forEach((filter) => filter.disconnect());
      if (audioContext) {
        void audioContext.close().catch((error: unknown) => {
          console.warn(`Could not close the audio context: ${errorMessage(error)}`);
        });
      }
    },
    [audioContext],
  );

  const updateNotification = useCallback(
    (state: 'playing' | 'paused', elapsedTime = 0) => {
      if (!currentTrack) return;
      void PlaybackNotificationManager.show({
        title: currentTrack.title,
        artist: currentTrack.artist,
        duration: playback.duration,
        elapsedTime,
        state,
        skipInterval: 15,
      }).catch((error: unknown) => {
        setNotice(`Could not update playback controls: ${errorMessage(error)}`);
      });
    },
    [currentTrack, playback.duration],
  );

  const playTrack = (track: Track, queue?: Track[]) => {
    if (queue) {
      const availableTracks = queue.filter((item) => item.id !== track.id);
      setPlaybackQueue(
        isShuffling
          ? [track, ...shuffleTracks(availableTracks)]
          : queue.some((item) => item.id === track.id)
            ? queue
            : [track, ...queue],
      );
    }
    if (currentTrack?.id === track.id) {
      try {
        audioRef.current?.seekToTime(0);
        audioRef.current?.play();
        updateNotification('playing', 0);
      } catch (error) {
        setNotice(`Could not restart this song: ${errorMessage(error)}`);
      }
      return;
    }
    currentTrackIdRef.current = track.id;
    setPlayback({ currentTime: 0, duration: 0, playing: false });
    setCurrentTrack(track);
    setNotice('');
  };

  const startShuffle = (queue: Track[]) => {
    if (queue.length === 0) return;
    const shuffledQueue = shuffleTracks(queue);
    setIsShuffling(true);
    playTrack(shuffledQueue[0], shuffledQueue);
  };

  const toggleShuffle = () => {
    if (isShuffling) {
      setIsShuffling(false);
      return;
    }

    const queue = playbackQueue.length > 0 ? playbackQueue : sortedTracks;
    const remainingTracks = queue.filter((track) => track.id !== currentTrack?.id);
    setPlaybackQueue(
      currentTrack
        ? [currentTrack, ...shuffleTracks(remainingTracks)]
        : shuffleTracks(queue),
    );
    setIsShuffling(true);
  };

  const addTracksToQueue = (tracksToAdd: Track[], label: string) => {
    const queuedIds = new Set(playbackQueue.map((track) => track.id));
    const additions = tracksToAdd.filter((track) => {
      if (queuedIds.has(track.id)) return false;
      queuedIds.add(track.id);
      return true;
    });
    if (additions.length === 0) {
      setNotice(`${label} is already in the playback queue.`);
      return;
    }
    setPlaybackQueue([...playbackQueue, ...additions]);
    setNotice(
      `${additions.length} ${additions.length === 1 ? 'song' : 'songs'} added to the playback queue.`,
    );
  };

  const moveQueueTrack = useCallback((trackId: string, targetIndex: number) => {
    const sourceIndex = playbackQueue.findIndex((track) => track.id === trackId);
    if (sourceIndex < 0 || playbackQueue.length < 2) return;
    const boundedTarget = Math.max(0, Math.min(targetIndex, playbackQueue.length - 1));
    if (sourceIndex === boundedTarget) return;
    const reordered = [...playbackQueue];
    const [movedTrack] = reordered.splice(sourceIndex, 1);
    reordered.splice(boundedTarget, 0, movedTrack);
    LayoutAnimation.configureNext({
      duration: 240,
      update: {
        type: LayoutAnimation.Types.spring,
        springDamping: 0.8,
      },
    });
    setPlaybackQueue(reordered);
  }, [playbackQueue]);

  const removeQueueTrack = (track: Track, index: number) => {
    const updatedQueue = playbackQueue.filter((item) => item.id !== track.id);
    setPlaybackQueue(updatedQueue);
    if (currentTrack?.id !== track.id) return;

    if (updatedQueue.length > 0) {
      playTrack(updatedQueue[Math.min(index, updatedQueue.length - 1)]);
      return;
    }

    audioRef.current?.pause();
    currentTrackIdRef.current = null;
    setCurrentTrack(null);
    setPlayback({ currentTime: 0, duration: 0, playing: false });
    void PlaybackNotificationManager.hide().catch((error: unknown) => {
      setNotice(`Could not close playback controls: ${errorMessage(error)}`);
    });
  };

  const changeVolume = (value: number) => {
    volumeChangeVersion.current += 1;
    setPlayerVolume(value);
    if (Platform.OS === 'web') {
      try {
        audioRef.current?.setVolume(value);
      } catch (error) {
        setNotice(`Could not change playback volume: ${errorMessage(error)}`);
      }
      return;
    }

    void VolumeManager.setVolume(value, {
      showUI: false,
      ...(Platform.OS === 'android' ? { type: 'music' as const } : {}),
    }).catch((error: unknown) => {
      setNotice(`Could not change system media volume: ${errorMessage(error)}`);
      void VolumeManager.getVolume()
        .then(({ volume }) => setPlayerVolume(volume))
        .catch((readError: unknown) => {
          setNotice(`Could not refresh system media volume: ${errorMessage(readError)}`);
        });
    });
  };

  const openPlayer = () => {
    if (Platform.OS === 'web') {
      setIsPlayerOpen(true);
      return;
    }

    const requestVersion = volumeChangeVersion.current;
    void VolumeManager.getVolume()
      .then(({ volume }) => {
        if (volumeChangeVersion.current === requestVersion) setPlayerVolume(volume);
        setIsPlayerOpen(true);
      })
      .catch((error: unknown) => {
        setNotice(`Could not read system media volume: ${errorMessage(error)}`);
        setIsPlayerOpen(true);
      });
  };

  const moveTrack = (direction: 1 | -1) => {
    if (playbackQueue.length === 0) return;
    const currentIndex = playbackQueue.findIndex((track) => track.id === currentTrack?.id);
    if (currentIndex < 0) {
      if (direction < 0) return;
      playTrack(playbackQueue[0]);
      return;
    }
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= playbackQueue.length) return;
    playTrack(playbackQueue[nextIndex]);
  };

  const togglePlayback = () => {
    if (!currentTrack) {
      const queue =
        isShuffling && playbackQueue.length > 0
          ? playbackQueue
          : sortedTracks.length > 0
            ? sortedTracks
            : tracks;
      if (queue[0]) playTrack(queue[0], queue);
      return;
    }
    if (playback.playing) {
      audioRef.current?.pause();
      updateNotification('paused', playback.currentTime);
    } else {
      audioRef.current?.play();
      updateNotification('playing', playback.currentTime);
    }
  };

  const seekTo = (position: number) => {
    try {
      audioRef.current?.seekToTime(position);
      updateNotification(playback.playing ? 'playing' : 'paused', position);
    } catch (error) {
      setNotice(`Could not change playback position: ${errorMessage(error)}`);
    }
  };

  const onAudioStatus = useCallback(
    (trackId: string, status: { currentTime: number; duration: number; playing: boolean }) => {
      if (currentTrackIdRef.current !== trackId) return;
      setPlayback(status);
    },
    [],
  );

  const onAudioLoad = useCallback((trackId: string) => {
    if (currentTrackIdRef.current !== trackId) return;
    const element = audioRef.current;
    if (!element) {
      setNotice('The audio player did not initialize correctly.');
      return;
    }

    try {
      if (Platform.OS === 'web') {
        element.setVolume(playerVolume);
        element.play();
        updateNotification('playing');
        return;
      }
      if (!audioContext) {
        throw new Error('The audio processing context is unavailable.');
      }

      if (Platform.OS === 'ios') {
        try {
          AudioManager.setSystemOptions({
            ios: {
              category: 'playback',
              mode: 'default',
              options: ['allowBluetoothA2DP', 'allowAirPlay'],
            },
          });
        } catch (error) {
          setNotice(`Could not configure Bluetooth audio playback: ${errorMessage(error)}`);
        }
      }

      let nextSource: MediaElementAudioSourceNode | null = null;
      const nextFilters: BiquadFilterNode[] = [];
      try {
        equalizerSource.current?.disconnect();
        equalizerFilters.current.forEach((filter) => filter.disconnect());
        nextSource = audioContext.createMediaElementSource(element);
        EQUALIZER_BANDS.forEach((band, index) => {
          const filter = audioContext.createBiquadFilter();
          filter.type = 'peaking';
          filter.frequency.value = band.frequency;
          filter.Q.value = 1;
          filter.gain.value = equalizerSettings.enabled ? equalizerSettings.bands[index] : 0;
          nextFilters.push(filter);
        });

        nextSource.connect(nextFilters[0]);
        for (let index = 0; index < nextFilters.length - 1; index += 1) {
          nextFilters[index].connect(nextFilters[index + 1]);
        }
        nextFilters[nextFilters.length - 1].connect(audioContext.destination);
        equalizerSource.current = nextSource;
        equalizerFilters.current = nextFilters;
      } catch (error) {
        nextSource?.disconnect();
        nextFilters.forEach((filter) => filter.disconnect());
        equalizerSource.current?.disconnect();
        equalizerFilters.current.forEach((filter) => filter.disconnect());
        equalizerSource.current = null;
        equalizerFilters.current = [];
        setNotice(`Equalizer unavailable; playing without processing: ${errorMessage(error)}`);
      }

      void (async () => {
        if (currentTrackIdRef.current !== trackId) return;
        if (Platform.OS === 'android' && !notificationPermissionRequested.current) {
          notificationPermissionRequested.current = true;
          try {
            const existingPermission = await AudioManager.checkNotificationPermissions();
            const permission =
              existingPermission === 'Granted'
                ? existingPermission
                : await AudioManager.requestNotificationPermissions();
            if (permission !== 'Granted') {
              setNotice('Allow notifications to use Android background playback controls.');
            }
          } catch (error) {
            setNotice(`Could not request playback notifications: ${errorMessage(error)}`);
          }
        }

        try {
          if (currentTrackIdRef.current !== trackId) return;
          await audioContext.resume();
          if (currentTrackIdRef.current !== trackId) return;
          element.play();
          updateNotification('playing');
        } catch (error) {
          setNotice(`Could not start audio playback: ${errorMessage(error)}`);
        }
      })();
    } catch (error) {
      setNotice(`Could not apply the equalizer: ${errorMessage(error)}`);
    }
  }, [audioContext, equalizerSettings, playerVolume, updateNotification]);

  const onAudioError = (trackId: string, error: Error) => {
    if (currentTrackIdRef.current !== trackId) return;
    setPlayback((status) => ({ ...status, playing: false }));
    setNotice(
      `Could not play this audio file. Its format may not be supported on this device: ${error.message}`,
    );
  };

  const onAudioPlay = (trackId: string) => {
    if (currentTrackIdRef.current !== trackId) return;
    setPlayback((status) => ({ ...status, playing: true }));
    updateNotification('playing', playback.currentTime);
  };

  const onAudioPause = (trackId: string) => {
    if (currentTrackIdRef.current !== trackId) return;
    setPlayback((status) => ({ ...status, playing: false }));
    updateNotification('paused', playback.currentTime);
  };

  const onAudioEnded = (trackId: string) => {
    if (currentTrackIdRef.current !== trackId) return;
    if (isRepeating) return;
    setPlayback((status) => ({ ...status, playing: false }));
    const currentIndex = playbackQueue.findIndex((track) => track.id === trackId);
    if (currentIndex >= 0 && currentIndex < playbackQueue.length - 1) {
      moveTrack(1);
    } else {
      updateNotification('paused', playback.duration);
    }
  };

  useEffect(() => {
    notificationActions.current = {
      play: () => audioRef.current?.play(),
      pause: () => audioRef.current?.pause(),
      next: () => moveTrack(1),
      previous: () => moveTrack(-1),
      seek: (seconds) => seekTo(seconds),
      stop: () => {
        audioRef.current?.pause();
        setPlayback((status) => ({ ...status, playing: false }));
      },
    };
  });

  useEffect(() => {
    const subscriptions = [
      PlaybackNotificationManager.addEventListener('playbackNotificationPlay', () =>
        notificationActions.current.play(),
      ),
      PlaybackNotificationManager.addEventListener('playbackNotificationPause', () =>
        notificationActions.current.pause(),
      ),
      PlaybackNotificationManager.addEventListener('playbackNotificationNextTrack', () =>
        notificationActions.current.next(),
      ),
      PlaybackNotificationManager.addEventListener('playbackNotificationPreviousTrack', () =>
        notificationActions.current.previous(),
      ),
      PlaybackNotificationManager.addEventListener('playbackNotificationSeekTo', (event) =>
        notificationActions.current.seek(event.value),
      ),
      PlaybackNotificationManager.addEventListener('playbackNotificationStop', () =>
        notificationActions.current.stop(),
      ),
      PlaybackNotificationManager.addEventListener('playbackNotificationDismissed', () =>
        notificationActions.current.stop(),
      ),
    ];

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  const importAudioFiles = useCallback(async (
    assets: ImportAudioAsset[],
    source: 'files' | 'folder',
    cleanup: {
      copiedFiles: File[];
      savedWebFiles: string[];
      createdWebUrls: string[];
    },
    {
      showNotice = true,
      copyToAppStorage = true,
      onProgress,
    }: {
      showNotice?: boolean;
      copyToAppStorage?: boolean;
      onProgress?: (processed: number, total: number) => void;
    } = {},
  ) => {
    const knownSourceUris = new Set(
      tracksRef.current.flatMap((track) => [track.sourceUri, track.uri].filter(Boolean) as string[]),
    );
    const audioAssets = assets.filter(
      (asset) =>
        isAudioAsset(asset) &&
        (!asset.sourceUri || !knownSourceUris.has(asset.sourceUri)),
    );
    if (audioAssets.length === 0) {
      if (showNotice) {
        setNotice(
          source === 'folder'
            ? 'No supported audio files were found in that folder.'
            : 'No supported audio files were selected.',
        );
      }
      return { importedCount: 0, failedCount: 0 };
    }

    const musicDirectory =
      Platform.OS === 'web' || !copyToAppStorage
        ? null
        : new Directory(Paths.document, MUSIC_FOLDER);
    musicDirectory?.create({ intermediates: true, idempotent: true });

    const importedTracks: Track[] = [];
    let metadataReadFailures = 0;
    let importFailures = 0;
    let firstImportError = '';
    let metadataPersistenceError = '';
    for (const [assetIndex, asset] of audioAssets.entries()) {
      const fallback = trackDetails(asset.name);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const addedAt = Date.now() + assetIndex;
      let savedWebAudioId: string | null = null;
      let createdWebUrl: string | null = null;
      let copiedFile: File | null = null;
      let importedTrack: Track;
      try {
        if (Platform.OS === 'web') {
          if (!asset.file) {
            throw new Error(`The browser could not access ${asset.name}. Please choose it again.`);
          }
          await saveWebAudio(id, asset.file);
          savedWebAudioId = id;
          const uri = makeWebObjectUrl(asset.file);
          createdWebUrl = uri;
          importedTrack = {
            id,
            uri,
            fileName: asset.name,
            ...fallbackTrackMetadata(asset.file, fallback),
            addedAt,
          };
        } else {
          if (!asset.uri) {
            throw new Error(`The selected audio file ${asset.name} is not available.`);
          }
          const sourceFile = new File(asset.uri);
          let trackUri = sourceFile.uri;
          if (copyToAppStorage) {
            const safeName = asset.name.replace(/[\\/:*?"<>|]/g, '_') || 'audio';
            const destination = new File(musicDirectory!, `${id}-${safeName}`);
            copiedFile = destination;
            await sourceFile.copy(destination);
            trackUri = destination.uri;
          }
          importedTrack = {
            id,
            uri: trackUri,
            fileName: asset.name,
            sourceUri: copyToAppStorage ? asset.sourceUri : sourceFile.uri,
            ...fallbackTrackMetadata(copyToAppStorage ? copiedFile! : sourceFile, fallback),
            addedAt,
          };
        }

        const updatedTracks = [...tracksRef.current, importedTrack];
        await saveLibrary(updatedTracks);
        tracksRef.current = updatedTracks;
        setTracks(updatedTracks);
        importedTracks.push(importedTrack);
        if (copiedFile) cleanup.copiedFiles.push(copiedFile);
        if (savedWebAudioId) cleanup.savedWebFiles.push(savedWebAudioId);
        if (createdWebUrl) cleanup.createdWebUrls.push(createdWebUrl);
      } catch (error) {
        importFailures += 1;
        firstImportError ||= `${asset.name}: ${errorMessage(error)}`;
        console.warn(`Could not add ${asset.name}: ${errorMessage(error)}`);
        if (createdWebUrl) revokeWebObjectUrl(createdWebUrl);
        if (savedWebAudioId) {
          try {
            await removeWebAudio(savedWebAudioId);
          } catch (cleanupError) {
            console.warn(
              `Could not clean up ${asset.name}: ${errorMessage(cleanupError)}`,
            );
          }
        }
        if (copiedFile?.exists) {
          try {
            copiedFile.delete();
          } catch (cleanupError) {
            console.warn(
              `Could not clean up ${asset.name}: ${errorMessage(cleanupError)}`,
            );
          }
        }
        onProgress?.(assetIndex + 1, audioAssets.length);
        continue;
      }

      const metadataFile = Platform.OS === 'web'
        ? asset.file
        : copiedFile ?? (asset.uri ? new File(asset.uri) : null);
      if (!metadataFile) {
        onProgress?.(assetIndex + 1, audioAssets.length);
        continue;
      }

      try {
        const metadata = await readTrackMetadata(
          metadataFile,
          fallback,
          id,
          makeWebObjectUrl,
          cleanup.copiedFiles,
        );
        const enrichedTrack = { ...importedTrack, ...metadata };
        const updatedTracks = tracksRef.current.map((track) =>
          track.id === id ? enrichedTrack : track,
        );
        tracksRef.current = updatedTracks;
        setTracks(updatedTracks);
        const importedIndex = importedTracks.findIndex((track) => track.id === id);
        if (importedIndex >= 0) importedTracks[importedIndex] = enrichedTrack;
      } catch (error) {
        metadataReadFailures += 1;
        console.warn(
          `Could not read audio tags for ${asset.name}: ${errorMessage(error)}`,
        );
      }
      onProgress?.(assetIndex + 1, audioAssets.length);
    }

    if (importedTracks.length > 0) {
      try {
        await saveLibrary(tracksRef.current);
      } catch (error) {
        metadataPersistenceError = errorMessage(error);
      }
    }

    if (importedTracks.length === 0 && importFailures > 0) {
      if (showNotice) setNotice(`Could not add songs: ${firstImportError}`);
      return { importedCount: 0, failedCount: importFailures };
    }

    const songCount = importedTracks.length;
    const importMessage =
      !copyToAppStorage
        ? `${songCount} ${songCount === 1 ? 'song was' : 'songs were'} added without copying audio into Soundroom.`
        : source === 'folder'
        ? `${songCount} ${songCount === 1 ? 'song' : 'songs'} imported from the folder.`
        : songCount === 1
          ? '1 song added to your offline library.'
          : `${songCount} songs added to your offline library.`;
    if (showNotice) {
      setNotice(
        [
          importMessage,
          importFailures > 0
            ? `${importFailures} ${importFailures === 1 ? 'file could not' : 'files could'} not be added${
                firstImportError ? ` (${firstImportError})` : ''
              }.`
            : '',
          metadataPersistenceError
            ? `Metadata changes could not be saved: ${metadataPersistenceError}`
            : '',
          metadataReadFailures > 0
            ? `Tags could not be read for ${metadataReadFailures} ${
                metadataReadFailures === 1 ? 'file' : 'files'
              }; filename details were used where possible.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
    return { importedCount: importedTracks.length, failedCount: importFailures };
  }, [makeWebObjectUrl, saveLibrary]);

  const toggleAiFeatures = async () => {
    if (!aiSettingsReady || Platform.OS === 'web') return;
    const enabled = !aiEnabled;
    try {
      await AsyncStorage.setItem(MUSIC_AI_ENABLED_KEY, enabled ? 'true' : 'false');
      setAiEnabled(enabled);
      if (!enabled) setIsAiAnalyzing(false);
      setNotice(enabled ? 'On-device music analysis enabled.' : 'AI music analysis disabled.');
    } catch (error) {
      setNotice(`Could not save AI feature setting: ${errorMessage(error)}`);
    }
  };

  const retryFailedAiAnalysis = async () => {
    if (!aiEnabled || aiFailedCount === 0) return;
    const retriedTracks = tracks.map((track) => {
      if (!track.aiError) return track;
      const updatedTrack = { ...track };
      delete updatedTrack.aiError;
      delete updatedTrack.aiTags;
      delete updatedTrack.aiAnalyzedAt;
      return updatedTrack;
    });
    try {
      await saveLibrary(retriedTracks);
      tracksRef.current = retriedTracks;
      setTracks(retriedTracks);
      setNotice(
        `Retrying AI analysis for ${aiFailedCount} ${
          aiFailedCount === 1 ? 'song' : 'songs'
        }.`,
      );
    } catch (error) {
      setNotice(`Could not retry AI analysis: ${errorMessage(error)}`);
    }
  };

  const importSongs = async () => {
    setIsImporting(true);
    setNotice('');
    const copiedFiles: File[] = [];
    const savedWebFiles: string[] = [];
    const createdWebUrls: string[] = [];

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      await importAudioFiles(
        result.assets.map(({ name, uri, file, mimeType }) => ({
          name,
          uri,
          file,
          mimeType,
        })),
        'files',
        { copiedFiles, savedWebFiles, createdWebUrls },
      );
    } catch (error) {
      let cleanupFailed = false;
      for (const id of savedWebFiles) {
        try {
          await removeWebAudio(id);
        } catch {
          cleanupFailed = true;
        }
      }
      createdWebUrls.forEach(revokeWebObjectUrl);
      for (const file of copiedFiles) {
        try {
          if (file.exists) file.delete();
        } catch {
          cleanupFailed = true;
        }
      }
      if (!isPickerCancelled(error)) {
        setNotice(
          cleanupFailed
            ? `Import failed and some copied files could not be cleaned up: ${errorMessage(error)}`
            : `Could not import songs: ${errorMessage(error)}`,
        );
      }
    } finally {
      setIsImporting(false);
    }
  };

  const importMusicFolder = async () => {
    setIsImporting(true);
    setNotice('');
    const copiedFiles: File[] = [];
    const savedWebFiles: string[] = [];
    const createdWebUrls: string[] = [];

    try {
      let assets: ImportAudioAsset[];
      if (Platform.OS === 'web') {
        const selectedAssets = await pickWebAudioFolder();
        if (!selectedAssets) return;
        assets = selectedAssets;
      } else {
        const selectedDirectory = await Directory.pickDirectoryAsync();
        const pendingDirectories = [selectedDirectory];
        assets = [];
        while (pendingDirectories.length > 0) {
          const directory = pendingDirectories.pop()!;
          for (const entry of directory.list()) {
            if (entry instanceof Directory) {
              pendingDirectories.push(entry);
            } else if (isAudioFileName(entry.name)) {
              assets.push({ name: entry.name, uri: entry.uri });
            }
          }
        }
      }

      await importAudioFiles(assets, 'folder', {
        copiedFiles,
        savedWebFiles,
        createdWebUrls,
      });
    } catch (error) {
      let cleanupFailed = false;
      for (const id of savedWebFiles) {
        try {
          await removeWebAudio(id);
        } catch {
          cleanupFailed = true;
        }
      }
      createdWebUrls.forEach(revokeWebObjectUrl);
      for (const file of copiedFiles) {
        try {
          if (file.exists) file.delete();
        } catch {
          cleanupFailed = true;
        }
      }
      if (!isPickerCancelled(error)) {
        setNotice(
          cleanupFailed
            ? `Folder import failed and some copied files could not be cleaned up: ${errorMessage(error)}`
            : `Could not import folder: ${errorMessage(error)}`,
        );
      }
    } finally {
      setIsImporting(false);
    }
  };

  const scanExistingMusicFolder = async () => {
    setIsScanningDropFolder(true);
    setNotice('');
    try {
      const selectedDirectory = await Directory.pickDirectoryAsync();
      const pendingDirectories = [selectedDirectory];
      const assets: ImportAudioAsset[] = [];
      const knownUris = new Set(ignoredDropSources);
      while (pendingDirectories.length > 0) {
        const directory = pendingDirectories.pop()!;
        for (const entry of directory.list()) {
          if (entry instanceof Directory) {
            pendingDirectories.push(entry);
          } else if (isAudioFileName(entry.name) && !knownUris.has(entry.uri)) {
            assets.push({
              name: entry.name,
              uri: entry.uri,
              sourceUri: entry.uri,
            });
            knownUris.add(entry.uri);
          }
        }
      }

      await importAudioFiles(
        assets,
        'folder',
        { copiedFiles: [], savedWebFiles: [], createdWebUrls: [] },
        { copyToAppStorage: false },
      );
    } catch (error) {
      if (!isPickerCancelled(error)) {
        setNotice(`Could not scan existing music folder: ${errorMessage(error)}`);
      }
    } finally {
      setIsScanningDropFolder(false);
    }
  };

  const chooseDropFolder = async () => {
    try {
      const directory = await Directory.pickDirectoryAsync(dropFolderUri ?? undefined);
      await AsyncStorage.setItem(DROP_FOLDER_KEY, directory.uri);
      setDropFolderUri(directory.uri);
      setNotice('Music folder connected. New songs copied there will be added when Soundroom opens.');
    } catch (error) {
      if (!isPickerCancelled(error)) {
        setNotice(`Could not connect music folder: ${errorMessage(error)}`);
      }
    }
  };

  useEffect(() => {
    if (Platform.OS === 'web' || isLoading || !dropFolderReady) return;

    const isManualScan = dropFolderScanRequest > handledDropFolderScanRequest.current;
    if (isManualScan) {
      handledDropFolderScanRequest.current = dropFolderScanRequest;
      setDropFolderScanProgress({ phase: 'scanning', found: 0, processed: 0 });
    }

    let active = true;
    const scanDropFolder = async () => {
      setIsScanningDropFolder(true);
      try {
        const root = Platform.OS === 'ios'
          ? new Directory(Paths.document)
          : dropFolderUri
            ? new Directory(dropFolderUri)
            : null;
        if (!root) return;

        const pendingDirectories = [root];
        const knownSourceUris = new Set(
          tracksRef.current.flatMap(
            (track) => [track.sourceUri, track.uri].filter(Boolean) as string[],
          ),
        );
        const ignoredSources = new Set(ignoredDropSources);
        let importedCount = 0;
        let failedCount = 0;
        let firstImportError = '';
        while (pendingDirectories.length > 0) {
          if (!active) return;
          const directory = pendingDirectories.pop()!;
          for (const entry of directory.list()) {
            if (entry instanceof Directory) {
              if (
                Platform.OS === 'ios' &&
                directory.uri === root.uri &&
                [MUSIC_FOLDER, ARTWORK_FOLDER].includes(entry.name)
              ) {
                continue;
              }
              pendingDirectories.push(entry);
            } else if (isAudioFileName(entry.name)) {
              if (
                knownSourceUris.has(entry.uri) ||
                ignoredSources.has(entry.uri)
              ) {
                continue;
              }
              knownSourceUris.add(entry.uri);
              if (isManualScan) {
                setDropFolderScanProgress((progress) =>
                  progress
                    ? { ...progress, found: progress.found + 1 }
                    : progress,
                );
              }

              const cleanup = {
                copiedFiles: [] as File[],
                savedWebFiles: [] as string[],
                createdWebUrls: [] as string[],
              };
              try {
                const result = await importAudioFiles(
                  [{
                    name: entry.name,
                    uri: entry.uri,
                    sourceUri: entry.uri,
                  }],
                  'folder',
                  cleanup,
                  {
                    showNotice: false,
                    onProgress: () => {
                      if (isManualScan) {
                        setDropFolderScanProgress((progress) =>
                          progress
                            ? {
                                ...progress,
                                phase: 'importing',
                                processed: progress.processed + 1,
                              }
                            : progress,
                        );
                      }
                    },
                  },
                );
                importedCount += result.importedCount;
                failedCount += result.failedCount;
              } catch (error) {
                failedCount += 1;
                firstImportError ||= `${entry.name}: ${errorMessage(error)}`;
                for (const file of cleanup.copiedFiles) {
                  if (file.exists) file.delete();
                }
                if (isManualScan) {
                  setDropFolderScanProgress((progress) =>
                    progress
                      ? {
                          ...progress,
                          phase: 'importing',
                          processed: progress.processed + 1,
                        }
                      : progress,
                  );
                }
                if (!active) return;
              }
            }
          }
        }

        if (active && (importedCount > 0 || failedCount > 0)) {
          setNotice(
            [
              isManualScan ? 'Folder scan complete.' : '',
              importedCount > 0
                ? `${importedCount} new ${
                    importedCount === 1 ? 'song was' : 'songs were'
                  } added from the connected folder.`
                : '',
              failedCount > 0
                ? `${failedCount} ${
                    failedCount === 1 ? 'file could' : 'files could'
                  } not be added${firstImportError ? ` (${firstImportError})` : ''}.`
                : '',
            ]
              .filter(Boolean)
              .join(' '),
          );
        } else if (active && isManualScan) {
          setNotice('Folder scan complete. No new audio files were found.');
        }
      } catch (error) {
        if (active) {
          setNotice(`Could not scan music drop folder: ${errorMessage(error)}`);
        }
      } finally {
        if (active) {
          setIsScanningDropFolder(false);
          if (isManualScan) setDropFolderScanProgress(null);
        }
      }
    };

    void scanDropFolder();
    return () => {
      active = false;
    };
  }, [
    dropFolderReady,
    dropFolderScanRequest,
    dropFolderUri,
    ignoredDropSources,
    importAudioFiles,
    isLoading,
  ]);

  const removeTrack = (track: Track) => {
    const removeFromLibrary = () => {
      void (async () => {
        const updatedTracks = tracks.filter((item) => item.id !== track.id);
        let playlistCleanupWarning: string | null = null;
        try {
          if (track.sourceUri) {
            const ignoredSources = [...new Set([...ignoredDropSources, track.sourceUri])];
            await AsyncStorage.setItem(
              IGNORED_DROP_SOURCES_KEY,
              JSON.stringify(ignoredSources),
            );
            setIgnoredDropSources(ignoredSources);
          }
          await saveLibrary(updatedTracks);
          const playlistsWithoutTrack = playlists.map((playlist) => ({
            ...playlist,
            trackIds: playlist.trackIds.filter((id) => id !== track.id),
          }));
          if (playlistsWithoutTrack.some((playlist, index) =>
            playlist.trackIds.length !== playlists[index].trackIds.length,
          )) {
            try {
              await savePlaylists(playlistsWithoutTrack);
              setPlaylists(playlistsWithoutTrack);
            } catch (error) {
              playlistCleanupWarning =
                `Song removed, but playlist membership could not be updated: ${errorMessage(error)}`;
            }
          }
          if (currentTrack?.id === track.id) {
            audioRef.current?.pause();
            currentTrackIdRef.current = null;
            setCurrentTrack(null);
            setPlayback({ currentTime: 0, duration: 0, playing: false });
            void PlaybackNotificationManager.hide().catch((error: unknown) => {
              setNotice(`Could not close playback controls: ${errorMessage(error)}`);
            });
          }
          setPlaybackQueue((queue) => queue.filter((item) => item.id !== track.id));
          setTracks(updatedTracks);
          try {
            if (Platform.OS === 'web') {
              await removeWebAudio(track.id);
              revokeWebObjectUrl(track.uri);
              if (track.artworkUri) revokeWebObjectUrl(track.artworkUri);
            } else {
              if (track.uri !== track.sourceUri) {
                const file = new File(track.uri);
                if (file.exists) file.delete();
              }
              if (track.artworkUri) {
                const artworkFile = new File(track.artworkUri);
                if (artworkFile.exists) artworkFile.delete();
              }
            }
          } catch (error) {
            setNotice(`Song removed, but its local file could not be deleted: ${errorMessage(error)}`);
            return;
          }
          setNotice(playlistCleanupWarning ?? 'Song removed from your offline library.');
        } catch (error) {
          setNotice(`Could not remove this song: ${errorMessage(error)}`);
        }
      })();
    };

    if (Platform.OS === 'web') {
      if (globalThis.confirm(`${track.title} will be removed from Soundroom.`)) {
        removeFromLibrary();
      }
      return;
    }

    Alert.alert('Remove this song?', `${track.title} will be removed from Soundroom.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: removeFromLibrary },
    ]);
  };

  const openPlaylistEditor = (playlist?: Playlist, trackId?: string) => {
    setPlaylistEditorId(playlist?.id ?? null);
    setPlaylistEditorTrackId(trackId ?? null);
    setPlaylistName(playlist?.name ?? '');
    setPlaylistFormError('');
    setPlaylistTrack(null);
    setIsPlaylistEditorOpen(true);
  };

  const savePlaylistEditor = async () => {
    const name = playlistName.trim();
    if (!name) {
      setPlaylistFormError('Enter a name for this playlist.');
      return;
    }
    if (
      playlists.some(
        (playlist) =>
          playlist.id !== playlistEditorId &&
          playlist.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setPlaylistFormError('A playlist with that name already exists.');
      return;
    }

    const now = Date.now();
    const editingPlaylist = playlists.find((playlist) => playlist.id === playlistEditorId);
    const updatedPlaylist: Playlist = editingPlaylist
      ? { ...editingPlaylist, name, updatedAt: now }
      : {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          trackIds: playlistEditorTrackId ? [playlistEditorTrackId] : [],
          createdAt: now,
          updatedAt: now,
        };
    const updatedPlaylists = editingPlaylist
      ? playlists.map((playlist) =>
          playlist.id === editingPlaylist.id ? updatedPlaylist : playlist,
        )
      : [...playlists, updatedPlaylist];

    try {
      await savePlaylists(updatedPlaylists);
      setPlaylists(updatedPlaylists);
      setIsPlaylistEditorOpen(false);
      setPlaylistEditorId(null);
      setPlaylistEditorTrackId(null);
      setPlaylistName('');
      setPlaylistFormError('');
      if (!editingPlaylist) setNotice(`Playlist “${name}” created.`);
    } catch (error) {
      setPlaylistFormError(`Could not save playlist: ${errorMessage(error)}`);
    }
  };

  const togglePlaylistTrack = async (
    playlist: Playlist,
    track: Track,
    updatedAt: number,
  ) => {
    const hasTrack = playlist.trackIds.includes(track.id);
    const updatedPlaylist: Playlist = {
      ...playlist,
      trackIds: hasTrack
        ? playlist.trackIds.filter((id) => id !== track.id)
        : [...playlist.trackIds, track.id],
      updatedAt,
    };
    const updatedPlaylists = playlists.map((item) =>
      item.id === playlist.id ? updatedPlaylist : item,
    );
    try {
      await savePlaylists(updatedPlaylists);
      setPlaylists(updatedPlaylists);
    } catch (error) {
      setNotice(`Could not update playlist: ${errorMessage(error)}`);
    }
  };

  const deletePlaylist = (playlist: Playlist) => {
    const confirmDelete = () => {
      void (async () => {
        const updatedPlaylists = playlists.filter((item) => item.id !== playlist.id);
        try {
          await savePlaylists(updatedPlaylists);
          setPlaylists(updatedPlaylists);
          if (selectedPlaylistId === playlist.id) setSelectedPlaylistId(null);
          setNotice(`Playlist “${playlist.name}” deleted.`);
        } catch (error) {
          setNotice(`Could not delete playlist: ${errorMessage(error)}`);
        }
      })();
    };
    const message = `Delete “${playlist.name}”? Your songs will remain in the library.`;
    if (Platform.OS === 'web') {
      if (globalThis.confirm(message)) confirmDelete();
      return;
    }
    Alert.alert('Delete playlist?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: confirmDelete },
    ]);
  };

  const renderTrack = ({ item, index }: { item: Track; index: number }) => {
    const isCurrent = currentTrack?.id === item.id;

    return (
      <GlassSurface
        light={isLightTheme}
        contentStyle={styles.trackRow}
        intensity={25}
        style={styles.trackCard}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Play ${item.title} by ${item.artist}`}
          onPress={() => playTrack(item, sortedTracks)}
          style={styles.trackMain}
        >
          <Text style={styles.trackNumber}>
            {isCurrent && playback.playing ? '♫' : String(index + 1).padStart(2, '0')}
          </Text>
          <Artwork seed={item.id} size={48} uri={item.artworkUri} styles={styles} />
          <View style={styles.trackInfo}>
            <Text numberOfLines={1} style={[styles.trackTitle, isCurrent && styles.activeTrackTitle]}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.trackArtist}>
              {item.artist}
            </Text>
          </View>
          <Text style={styles.trackTag}>LOCAL</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More options for ${item.title}`}
          onPress={() => setTrackOptionsTrack(item)}
          hitSlop={8}
          style={styles.trackOptionsButton}
        >
          <View style={styles.trackOptionsIcon}>
            {[0, 1, 2].map((dot) => (
              <View key={dot} style={styles.trackOptionsDot} />
            ))}
          </View>
        </Pressable>
      </GlassSurface>
    );
  };

  const renderGroup = (group: LibraryGroup) => {
    return (
      <GlassSurface
        light={isLightTheme}
        contentStyle={styles.trackRow}
        intensity={25}
        style={styles.trackCard}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${group.title}, ${group.count} songs`}
          onPress={() => setSelectedGroup(group)}
          style={styles.trackMain}
        >
          <Artwork seed={group.id} size={48} uri={group.artworkUri} styles={styles} />
          <View style={styles.trackInfo}>
            <Text numberOfLines={1} style={styles.trackTitle}>{group.title}</Text>
            <Text numberOfLines={1} style={styles.trackArtist}>
              {group.subtitle || `${group.count} ${group.count === 1 ? 'song' : 'songs'}`}
            </Text>
          </View>
          <Text style={styles.groupArrow}>›</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${group.title} songs to playback queue`}
          onPress={() => addTracksToQueue(group.tracks, group.title)}
          hitSlop={8}
          style={styles.groupQueueButton}
        >
          <Text style={styles.queueAddGlyph}>＋</Text>
        </Pressable>
        <Text style={styles.groupCount}>{group.count}</Text>
      </GlassSurface>
    );
  };

  const renderPlaylist = (playlist: Playlist) => {
    const playlistTracks = playlist.trackIds
      .map((id) => tracksById.get(id))
      .filter((track): track is Track => track !== undefined);
    return (
      <GlassSurface light={isLightTheme} contentStyle={styles.trackRow} intensity={25} style={styles.trackCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open playlist ${playlist.name}, ${playlistTracks.length} songs`}
          onPress={() => {
            setSelectedPlaylistId(playlist.id);
            setSelectedGroup(null);
          }}
          style={styles.trackMain}
        >
          <Artwork
            seed={playlist.id}
            size={48}
            uri={playlistTracks.find((track) => track.artworkUri)?.artworkUri}
            styles={styles}
          />
          <View style={styles.trackInfo}>
            <Text numberOfLines={1} style={styles.trackTitle}>{playlist.name}</Text>
            <Text numberOfLines={1} style={styles.trackArtist}>
              {playlist.generatedByAi ? 'AI-generated · ' : ''}
              {playlistTracks.length} {playlistTracks.length === 1 ? 'song' : 'songs'}
            </Text>
          </View>
          <Text style={styles.groupArrow}>›</Text>
        </Pressable>
        {!playlist.generatedByAi && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Rename playlist ${playlist.name}`}
              onPress={() => openPlaylistEditor(playlist)}
              hitSlop={8}
              style={styles.playlistManageButton}
            >
              <Text style={styles.playlistManageText}>✎</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete playlist ${playlist.name}`}
              onPress={() => deletePlaylist(playlist)}
              hitSlop={8}
              style={styles.removeButton}
            >
              <Text style={styles.removeButtonText}>×</Text>
            </Pressable>
          </>
        )}
      </GlassSurface>
    );
  };

  const activeModeLabel =
    selectedPlaylist?.name ??
    BROWSE_MODES.find((mode) => mode.id === browseMode)?.label ??
    'Songs';
  const activeBrowseMode =
    BROWSE_MODES.find((mode) => mode.id === browseMode) ?? BROWSE_MODES[0];
  const isBrowseSelected = !isSettingsOpen && browseMode !== 'playlists';
  const isPlaylistsSelected = !isSettingsOpen && browseMode === 'playlists';
  const currentCount = listingPlaylists
    ? visiblePlaylists.length
    : listingGroups
      ? groupedLibrary.length
      : tracksForList.length;
  const knownSortFields = new Set([
    'Title',
    'Artist',
    'Album',
    'Album artist',
    'Composer',
    'Genre',
    'Date',
    'Track',
    'Disc',
    'BPM',
  ]);
  const availableSortOptions = [
    ...SORT_OPTIONS,
    ...[...new Set(tracks.flatMap((track) => Object.keys(track.metadata ?? {})))]
      .filter((field) => !knownSortFields.has(field))
      .sort(compareMetadataValues)
      .map((field) => ({
        id: `metadata:${field}` as const,
        label: field,
      })),
  ];
  const sortOptionsForView = listingPlaylists
    ? SORT_OPTIONS.filter(
        (option) => option.id === 'name' || option.id === 'dateAdded',
      )
    : availableSortOptions;

  const listHeader = (
    <View>
      <View style={styles.topBar}>
        <View style={styles.brandLockup}>
          <View style={styles.brandIcon}>
            <Text style={styles.brandIconText}>♫</Text>
          </View>
          <Text style={styles.brandName}>SOUNDROOM</Text>
        </View>
      </View>

      <View style={styles.libraryHeading}>
        <View>
          {(selectedGroup || selectedPlaylist) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Back to ${
                browseMode === 'playlists' ? 'playlists' : activeModeLabel.toLowerCase()
              }`}
              onPress={() => {
                setSelectedGroup(null);
                setSelectedPlaylistId(null);
              }}
              style={styles.groupBack}
            >
              <Text style={styles.groupBackText}>
                ‹ {(browseMode === 'playlists' ? 'PLAYLISTS' : activeModeLabel).toUpperCase()}
              </Text>
            </Pressable>
          )}
          <Text style={styles.eyebrow}>YOUR COLLECTION</Text>
          <Text style={styles.sectionTitle}>
            {selectedGroup?.title ??
              selectedPlaylist?.name ??
              (browseMode === 'songs' ? 'All songs' : activeModeLabel)}
          </Text>
        </View>
        <View style={styles.libraryHeadingActions}>
          {browseMode === 'playlists' && !selectedPlaylist && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !playlistsReady }}
              disabled={!playlistsReady}
              onPress={() => openPlaylistEditor()}
              style={styles.newPlaylistButton}
            >
              <Text style={styles.newPlaylistButtonText}>＋ NEW</Text>
            </Pressable>
          )}
          {(browseMode === 'songs' || selectedPlaylist !== null) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Shuffle ${selectedPlaylist?.name ?? 'songs'}`}
              accessibilityState={{ disabled: sortedTracks.length === 0 }}
              disabled={sortedTracks.length === 0}
              onPress={() => startShuffle(sortedTracks)}
              style={[
                styles.shuffleButton,
                sortedTracks.length === 0 && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.shuffleButtonText}>⤨ SHUFFLE</Text>
            </Pressable>
          )}
          <View style={styles.songCount}>
            <Text style={styles.songCountNumber}>{currentCount}</Text>
            <Text style={styles.songCountLabel}>
              {listingPlaylists ? 'PLAYLISTS' : listingGroups ? 'GROUPS' : 'TRACKS'}
            </Text>
          </View>
        </View>
      </View>

      {(tracks.length > 0 || (listingPlaylists && playlists.length > 0)) && (
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>SORT BY</Text>
          <ScrollView
            contentContainerStyle={styles.sortOptions}
            horizontal
            style={styles.sortOptionsScroller}
            showsHorizontalScrollIndicator={false}
          >
            {sortOptionsForView.map((option) => {
              const selected = sortMode === option.id;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Sort by ${option.label}`}
                  accessibilityState={{ selected }}
                  key={option.id}
                  onPress={() => setSortMode(option.id)}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.sortChip,
                    selected && styles.sortChipSelected,
                    pressed && styles.sortChipPressed,
                  ]}
                >
                  <Text style={[styles.sortChipText, selected && styles.sortChipTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sort ${sortDirection}`}
            accessibilityHint="Changes the sort order between ascending and descending."
            onPress={() =>
              setSortDirection((direction) =>
                direction === 'ascending' ? 'descending' : 'ascending',
              )
            }
            style={({ pressed }) => [
              styles.sortDirectionButton,
              pressed && styles.sortChipPressed,
            ]}
          >
            <Text style={styles.sortDirectionArrow}>
              {sortDirection === 'ascending' ? '↑' : '↓'}
            </Text>
            <Text style={styles.sortDirectionText}>
              {sortDirection === 'ascending' ? 'ASC' : 'DESC'}
            </Text>
          </Pressable>
        </View>
      )}

      {(tracks.length > 0 || playlists.length > 0) && (
        <GlassSurface light={isLightTheme} contentStyle={styles.searchBoxContent} intensity={30} style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            accessibilityLabel={listingPlaylists ? 'Search playlists' : 'Search your songs'}
            autoCapitalize="none"
            onChangeText={setSearch}
            onSubmitEditing={Keyboard.dismiss}
            placeholder={listingPlaylists ? 'Search playlists...' : 'Search songs, albums, artists...'}
            placeholderTextColor={COLORS.muted}
            returnKeyType="search"
            selectionColor={COLORS.accent}
            style={styles.searchInput}
            value={search}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search">
              <Text style={styles.clearSearch}>×</Text>
            </Pressable>
          )}
        </GlassSurface>
      )}

      {notice.length > 0 && (
        <GlassSurface light={isLightTheme} contentStyle={styles.notice} intensity={28} style={styles.noticeGlass}>
          <Pressable onPress={() => setNotice('')} style={styles.noticeContent}>
            <Text style={styles.noticeText}>{notice}</Text>
            <Text style={styles.noticeClose}>×</Text>
          </Pressable>
        </GlassSurface>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style={isLightTheme ? 'dark' : 'light'} />
      {currentTrack && (
        <View pointerEvents="none" style={styles.audioHost}>
          <Audio
            key={currentTrack.id}
            autoPlay={false}
            context={audioContext ?? undefined}
            loop={isRepeating}
            onEnded={() => onAudioEnded(currentTrack.id)}
            onError={(error) => onAudioError(currentTrack.id, error)}
            onLoad={() => onAudioLoad(currentTrack.id)}
            onPause={() => onAudioPause(currentTrack.id)}
            onPlay={() => onAudioPlay(currentTrack.id)}
            ref={audioRef}
            source={currentTrack.uri}
          >
            <AudioStatusBridge onStatus={onAudioStatus} trackId={currentTrack.id} />
          </Audio>
        </View>
      )}
      <BlurTargetView ref={libraryBlurTarget} style={styles.libraryBlurTarget}>
        {isSettingsOpen ? (
          <ScrollView
            contentContainerStyle={[
              styles.settingsContent,
              { paddingBottom: (currentTrack ? 196 : 128) + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topBar}>
              <View style={styles.brandLockup}>
                <View style={styles.brandIcon}>
                  <Text style={styles.brandIconText}>♫</Text>
                </View>
                <Text style={styles.brandName}>SOUNDROOM</Text>
              </View>
            </View>
            <View style={styles.settingsHeading}>
              <Text style={styles.eyebrow}>PREFERENCES</Text>
              <Text style={styles.sectionTitle}>Settings</Text>
            </View>
            {notice.length > 0 && (
              <GlassSurface
                light={isLightTheme}
                contentStyle={styles.notice}
                intensity={28}
                style={styles.noticeGlass}
              >
                <Pressable onPress={() => setNotice('')} style={styles.noticeContent}>
                  <Text style={styles.noticeText}>{notice}</Text>
                  <Text style={styles.noticeClose}>×</Text>
                </Pressable>
              </GlassSurface>
            )}
            <GlassSurface
              light={isLightTheme}
              contentStyle={styles.settingsCardContent}
              intensity={28}
              style={styles.settingsCard}
            >
              <Text style={styles.eyebrow}>APPEARANCE</Text>
              <View style={styles.settingRow}>
                <View style={styles.settingCopy}>
                  <Text style={styles.settingTitle}>Theme</Text>
                  <Text style={styles.settingDescription}>Choose your preferred appearance.</Text>
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={`Switch to ${isLightTheme ? 'dark' : 'light'} mode`}
                  accessibilityState={{ checked: isLightTheme, disabled: !themeReady }}
                  disabled={!themeReady}
                  onPress={() => setTheme(isLightTheme ? 'dark' : 'light')}
                  style={[styles.themeToggle, !themeReady && styles.buttonDisabled]}
                >
                  <Text style={styles.themeToggleIcon}>{isLightTheme ? '☾' : '☼'}</Text>
                  <Text style={styles.themeToggleText}>{isLightTheme ? 'LIGHT' : 'DARK'}</Text>
                </Pressable>
              </View>
              <View style={styles.settingsDivider} />
              <Text style={styles.eyebrow}>FEATURES</Text>
              {Platform.OS === 'web' ? (
                <View style={styles.settingRow}>
                  <View style={styles.settingCopy}>
                    <Text style={styles.settingTitle}>AI features</Text>
                    <Text style={styles.settingDescription}>
                      On-device music analysis is available in the iOS and Android apps.
                    </Text>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel="AI features"
                  accessibilityState={{
                    checked: aiEnabled,
                    disabled: !aiSettingsReady,
                  }}
                  disabled={!aiSettingsReady}
                  onPress={() => void toggleAiFeatures()}
                  style={[styles.settingRow, !aiSettingsReady && styles.buttonDisabled]}
                >
                  <View style={styles.settingCopy}>
                    <Text style={styles.settingTitle}>AI features</Text>
                    <Text style={styles.settingDescription}>
                      On-device genre, mood, and theme suggestions.
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.settingSwitch,
                      { backgroundColor: aiEnabled ? COLORS.accent : COLORS.controlBorder },
                    ]}
                  >
                    <View
                      style={[
                        styles.settingSwitchKnob,
                        {
                          alignSelf: aiEnabled ? 'flex-end' : 'flex-start',
                          backgroundColor: aiEnabled ? COLORS.ink : COLORS.primaryText,
                        },
                      ]}
                    />
                  </View>
                </Pressable>
              )}
              {Platform.OS !== 'web' && (
                <Text style={styles.settingsNote}>
                  {aiEnabled
                    ? `${aiAnalyzedCount} of ${tracks.length} songs analyzed${
                        isAiAnalyzing ? ' · analyzing next song' : ''
                      }${aiFailedCount > 0 ? ` · ${aiFailedCount} could not be read` : ''}.`
                    : 'Off by default. Audio is analyzed on this device only.'}
                </Text>
              )}
              {Platform.OS !== 'web' && aiEnabled && aiFailedCount > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Retry analysis for ${aiFailedCount} failed songs`}
                  disabled={isAiAnalyzing}
                  onPress={() => void retryFailedAiAnalysis()}
                  style={({ pressed }) => [
                    styles.aiRetryButton,
                    pressed && styles.buttonPressed,
                    isAiAnalyzing && styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.aiRetryButtonText}>Retry failed songs</Text>
                </Pressable>
              )}
              {Platform.OS !== 'web' && aiEnabled && (
                <Text style={styles.settingsNote}>
                  OS background runs are best-effort. YAMNet provides general audio labels, not
                  definitive music metadata.
                </Text>
              )}
            </GlassSurface>
            <GlassSurface
              light={isLightTheme}
              contentStyle={styles.settingsCardContent}
              intensity={28}
              style={[styles.settingsCard, styles.settingsImportCard]}
            >
              <Text style={styles.eyebrow}>MUSIC LIBRARY</Text>
              <Text style={styles.settingDescription}>
                Add songs and folders to your library.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add music from files"
                accessibilityState={{ disabled: isImporting || isLoading }}
                disabled={isImporting || isLoading}
                onPress={() => void importSongs()}
                style={({ pressed }) => [
                  styles.addMenuOption,
                  pressed && styles.buttonPressed,
                  (isImporting || isLoading) && styles.buttonDisabled,
                ]}
              >
                <DockIcon name="files" color={COLORS.accent} />
                <Text style={styles.addMenuOptionText}>
                  {isImporting ? 'Adding music…' : 'Add music from files'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a music folder"
                accessibilityState={{ disabled: isImporting || isLoading }}
                disabled={isImporting || isLoading}
                onPress={() => void importMusicFolder()}
                style={({ pressed }) => [
                  styles.addMenuOption,
                  pressed && styles.buttonPressed,
                  (isImporting || isLoading) && styles.buttonDisabled,
                ]}
              >
                <DockIcon name="folder" color={COLORS.accent} />
                <Text style={styles.addMenuOptionText}>Import a music folder</Text>
              </Pressable>
              {Platform.OS !== 'web' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scan existing folder for music without copying"
                  accessibilityState={{
                    disabled: isImporting || isLoading || isScanningDropFolder,
                  }}
                  disabled={isImporting || isLoading || isScanningDropFolder}
                  onPress={() => void scanExistingMusicFolder()}
                  style={({ pressed }) => [
                    styles.addMenuOption,
                    pressed && styles.buttonPressed,
                    (isImporting || isLoading || isScanningDropFolder) &&
                      styles.buttonDisabled,
                  ]}
                >
                  <DockIcon name="folder" color={COLORS.accent} />
                  <View style={styles.settingCopy}>
                    <Text style={styles.addMenuOptionText}>
                      Scan existing folder for music
                    </Text>
                    <Text style={styles.settingDescription}>
                      Add tracks without copying audio into Soundroom.
                    </Text>
                  </View>
                </Pressable>
              )}
              {Platform.OS === 'android' && (
                <>
                  <View style={styles.addMenuDivider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      dropFolderUri ? 'Change music folder' : 'Set music folder'
                    }
                    accessibilityState={{
                      disabled: isImporting || isLoading || isScanningDropFolder,
                    }}
                    disabled={isImporting || isLoading || isScanningDropFolder}
                    onPress={() => void chooseDropFolder()}
                    style={({ pressed }) => [
                      styles.addMenuOption,
                      pressed && styles.buttonPressed,
                      (isImporting || isLoading || isScanningDropFolder) &&
                        styles.buttonDisabled,
                    ]}
                  >
                    <DockIcon name="folder" color={COLORS.accent} />
                    <Text style={styles.addMenuOptionText}>
                      {dropFolderUri ? 'Change music folder' : 'Set music folder'}
                    </Text>
                  </Pressable>
                  {dropFolderUri && (
                    <>
                      <Text numberOfLines={1} style={styles.addMenuStatus}>
                        {isScanningDropFolder
                          ? dropFolderScanProgress?.phase === 'importing'
                            ? `Adding songs · ${dropFolderScanProgress.processed} of ${dropFolderScanProgress.found}`
                            : dropFolderScanProgress
                              ? `Scanning folder · ${dropFolderScanProgress.found} new ${
                                  dropFolderScanProgress.found === 1
                                    ? 'audio file'
                                    : 'audio files'
                                } found`
                              : 'Scanning folder…'
                          : `Connected · ${new Directory(dropFolderUri).name}`}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Scan music folder now"
                        accessibilityState={{
                          disabled: isScanningDropFolder || isLoading,
                        }}
                        disabled={isScanningDropFolder || isLoading}
                        onPress={() => {
                          setDropFolderScanProgress({
                            phase: 'scanning',
                            found: 0,
                            processed: 0,
                          });
                          setDropFolderScanRequest((request) => request + 1);
                        }}
                        style={({ pressed }) => [
                          styles.addMenuOption,
                          pressed && styles.buttonPressed,
                          (isScanningDropFolder || isLoading) &&
                            styles.buttonDisabled,
                        ]}
                      >
                        {isScanningDropFolder ? (
                          <View style={styles.scanButtonContent}>
                            <ActivityIndicator size="small" color={COLORS.accent} />
                            <Text style={styles.addMenuOptionText}>
                              {dropFolderScanProgress?.phase === 'importing'
                                ? 'Adding songs…'
                                : 'Scanning…'}
                            </Text>
                          </View>
                        ) : (
                          <Text style={styles.addMenuOptionText}>Scan folder now</Text>
                        )}
                      </Pressable>
                    </>
                  )}
                </>
              )}
            </GlassSurface>
          </ScrollView>
        ) : (
          <FlatList
            data={libraryItems}
            keyExtractor={(item) =>
              item.kind === 'group'
                ? item.group.id
                : item.kind === 'playlist'
                  ? item.playlist.id
                  : item.track.id
            }
            renderItem={({ item, index }) =>
              item.kind === 'group'
                ? renderGroup(item.group)
                : item.kind === 'playlist'
                  ? renderPlaylist(item.playlist)
                  : renderTrack({ item: item.track, index })
            }
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              isLoading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator color={COLORS.accent} />
                  <Text style={styles.emptyCaption}>Opening your library…</Text>
                </View>
              ) : listingPlaylists && playlists.length === 0 ? (
                <View style={styles.emptyState}>
                  <View style={styles.emptyArtwork}>
                    <Text style={styles.emptyNote}>♫</Text>
                  </View>
                  <Text style={styles.emptyTitle}>Make it yours.</Text>
                  <Text style={styles.emptyCaption}>
                    Create a playlist, then add songs from your library.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !playlistsReady }}
                    disabled={!playlistsReady}
                    onPress={() => openPlaylistEditor()}
                    style={styles.emptyCreateButton}
                  >
                    <Text style={styles.newPlaylistButtonText}>＋ CREATE PLAYLIST</Text>
                  </Pressable>
                </View>
              ) : tracks.length === 0 && !selectedPlaylist && !listingPlaylists ? (
                <View style={styles.emptyState}>
                  <View style={styles.emptyArtwork}>
                    <Text style={styles.emptyNote}>♫</Text>
                  </View>
                  <Text style={styles.emptyTitle}>A little quiet in here.</Text>
                  <Text style={styles.emptyCaption}>
                    Add songs from your device and they’ll be ready whenever you are.
                  </Text>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>
                    {selectedPlaylist
                      ? 'This playlist is empty'
                      : listingGroups
                        ? `No ${activeModeLabel.toLowerCase()} found`
                        : 'No matches'}
                  </Text>
                  <Text style={styles.emptyCaption}>
                    {selectedPlaylist
                      ? 'Use the plus button beside a song to add it to this playlist.'
                      : listingGroups
                        ? 'Try another search or choose a different category.'
                        : 'Try a different search or category.'}
                  </Text>
                </View>
              )
            }
            contentContainerStyle={[
              styles.listContent,
              {
                paddingBottom:
                  (currentTrack ? 196 : 128) +
                  (isBrowseMenuOpen ? 260 : 0) +
                  insets.bottom,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}
      </BlurTargetView>

      <View style={styles.bottomDock}>
        <View
          style={[
            styles.dockContent,
            { paddingBottom: Math.max(insets.bottom, 14) },
          ]}
        >
          {currentTrack && (
            <GlassSurface
              blurTarget={libraryBlurTarget}
              light={isLightTheme}
              contentStyle={styles.miniPlayerContent}
              intensity={35}
              style={styles.miniPlayerGlass}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open player for ${currentTrack.title}`}
                onPress={openPlayer}
                style={styles.miniPlayer}
              >
                <Artwork seed={currentTrack.id} size={44} uri={currentTrack.artworkUri} styles={styles} />
                <View style={styles.miniInfo}>
                  <Text numberOfLines={1} style={styles.miniTitle}>{currentTrack.title}</Text>
                  <Text numberOfLines={1} style={styles.miniArtist}>{currentTrack.artist}</Text>
                  <ProgressBar
                    compact
                    currentTime={playback.currentTime}
                    duration={playback.duration}
                    onSeek={seekTo}
                    styles={styles}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={playback.playing ? 'Pause' : 'Play'}
                  onPress={(event) => {
                    event.stopPropagation();
                    togglePlayback();
                  }}
                  hitSlop={12}
                  style={styles.miniPlayButton}
                >
                  <DockIcon name={playback.playing ? 'pause' : 'play'} color={COLORS.ink} />
                </Pressable>
              </Pressable>
            </GlassSurface>
          )}
          {isBrowseMenuOpen && (
            <GlassSurface
              blurTarget={libraryBlurTarget}
              light={isLightTheme}
              contentStyle={styles.browseMenuContent}
              intensity={78}
              style={styles.browseMenu}
            >
              {BROWSE_MENU_MODES.map((mode) => {
                const selected = browseMode === mode.id;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={mode.label}
                    accessibilityState={{ selected }}
                    key={mode.id}
                    onPress={() => {
                      setBrowseMode(mode.id);
                      setSelectedGroup(null);
                      setSelectedPlaylistId(null);
                      setIsBrowseMenuOpen(false);
                      setIsSettingsOpen(false);
                    }}
                    style={[
                      styles.addMenuOption,
                      selected && styles.browseTabSelected,
                    ]}
                  >
                    <DockIcon
                      name={mode.icon}
                      color={selected ? COLORS.accent : COLORS.secondaryText}
                    />
                    <Text
                      style={[
                        styles.addMenuOptionText,
                        selected && styles.browseTabTextSelected,
                      ]}
                    >
                      {mode.label}
                    </Text>
                  </Pressable>
                );
              })}
            </GlassSurface>
          )}
          <GlassSurface
            blurTarget={libraryBlurTarget}
            light={isLightTheme}
            contentStyle={styles.navigationBarContent}
            intensity={78}
            style={styles.navigationBar}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Browse categories, current category ${activeBrowseMode.label}`}
              accessibilityState={{ expanded: isBrowseMenuOpen }}
              onPress={() => {
                setIsBrowseMenuOpen((isOpen) => !isOpen);
              }}
              style={[
                styles.browseTab,
                isBrowseSelected && styles.browseTabSelected,
              ]}
            >
              <DockIcon
                name={activeBrowseMode.icon}
                color={isBrowseSelected ? COLORS.accent : COLORS.secondaryText}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.browseTabText,
                  isBrowseSelected && styles.browseTabTextSelected,
                ]}
              >
                {isBrowseSelected ? activeBrowseMode.label : 'Browse'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Playlists"
              accessibilityState={{ selected: isPlaylistsSelected }}
              onPress={() => {
                setIsBrowseMenuOpen(false);
                setIsSettingsOpen(false);
                setBrowseMode('playlists');
                setSelectedGroup(null);
                setSelectedPlaylistId(null);
              }}
              style={[
                styles.browseTab,
                isPlaylistsSelected && styles.browseTabSelected,
              ]}
            >
              <DockIcon
                name="playlists"
                color={
                  isPlaylistsSelected ? COLORS.accent : COLORS.secondaryText
                }
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.browseTabText,
                  isPlaylistsSelected && styles.browseTabTextSelected,
                ]}
              >
                Playlists
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              accessibilityState={{ selected: isSettingsOpen }}
              onPress={() => {
                setIsBrowseMenuOpen(false);
                setIsSettingsOpen(true);
              }}
              style={[
                styles.browseTab,
                isSettingsOpen && styles.browseTabSelected,
              ]}
            >
              <DockIcon
                name="settings"
                color={isSettingsOpen ? COLORS.accent : COLORS.secondaryText}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.browseTabText,
                  isSettingsOpen && styles.browseTabTextSelected,
                ]}
              >
                Settings
              </Text>
            </Pressable>
          </GlassSurface>
        </View>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsPlayerOpen(false)}
        presentationStyle="fullScreen"
        visible={isPlayerOpen && currentTrack !== null}
      >
        <SafeAreaView style={styles.playerScreen}>
          <View style={styles.playerTopBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close player"
              onPress={() => setIsPlayerOpen(false)}
              hitSlop={12}
            >
              <Text style={styles.closePlayer}>⌄</Text>
            </Pressable>
            <View style={styles.playerTopCopy}>
              <Text style={styles.eyebrow}>NOW PLAYING</Text>
              <Text style={styles.playerTopTitle}>FROM YOUR LIBRARY</Text>
            </View>
            <View style={styles.playerTopActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open queue, ${playbackQueue.length} songs`}
                onPress={() => {
                  setIsAddingQueueTracks(false);
                  setIsQueueOpen(true);
                }}
                style={styles.queueButton}
              >
                <Text style={styles.equalizerButtonIcon}>☷</Text>
                <Text style={styles.queueButtonCount}>{playbackQueue.length}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  Platform.OS === 'web'
                    ? 'Equalizer is unavailable in the web player'
                    : 'Open equalizer'
                }
                accessibilityState={{ disabled: !equalizerLoaded }}
                disabled={!equalizerLoaded}
                onPress={() => {
                  if (Platform.OS === 'web') {
                    setNotice('Equalizer processing is available in the iOS and Android apps.');
                    return;
                  }
                  setIsEqualizerOpen(true);
                }}
                style={styles.equalizerButton}
              >
                <Text style={styles.equalizerButtonIcon}>♫</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.playerContent}
            showsVerticalScrollIndicator={false}
          >
            {currentTrack && (
              <GlassSurface light={isLightTheme} contentStyle={styles.artworkFrameContent} intensity={30} style={styles.artworkFrame}>
                <Artwork
                  seed={currentTrack.id}
                  size={playerArtworkSize - 18}
                  uri={currentTrack.artworkUri}
                  styles={styles}
                />
              </GlassSurface>
            )}
            <View style={styles.nowPlayingInfo}>
              <Text numberOfLines={2} style={styles.nowPlayingTitle}>
                {currentTrack?.title}
              </Text>
              <Text numberOfLines={1} style={styles.nowPlayingArtist}>
                {currentTrack?.artist}
              </Text>
            </View>

            <GlassSurface light={isLightTheme} contentStyle={styles.playerProgress} intensity={26} style={styles.progressGlass}>
              <ProgressBar
                currentTime={playback.currentTime}
                duration={playback.duration}
                draggable
                onSeek={seekTo}
                styles={styles}
              />
            </GlassSurface>
            <View style={styles.volumeControl}>
              <Text style={styles.volumeIcon}>−</Text>
              <Slider
                accessibilityLabel={
                  Platform.OS === 'web' ? 'Playback volume' : 'System media volume'
                }
                maximumTrackTintColor={COLORS.border}
                maximumValue={1}
                minimumTrackTintColor={COLORS.accent}
                minimumValue={0}
                onValueChange={changeVolume}
                style={styles.volumeSlider}
                value={playerVolume}
              />
              <Text style={styles.volumeValue}>{Math.round(playerVolume * 100)}%</Text>
            </View>

            <GlassSurface light={isLightTheme} contentStyle={styles.controls} intensity={30} style={styles.controlsGlass}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Toggle shuffle"
                accessibilityState={{ checked: isShuffling }}
                onPress={toggleShuffle}
                style={styles.sideControl}
              >
                <Text style={[styles.controlGlyph, isShuffling && styles.selectedControl]}>⤨</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous song"
                onPress={() => moveTrack(-1)}
                style={styles.skipButton}
              >
                <Text style={styles.skipGlyph}>|◀</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={playback.playing ? 'Pause' : 'Play'}
                onPress={togglePlayback}
                style={styles.mainPlayButton}
              >
                <Text style={styles.mainPlayGlyph}>{playback.playing ? 'Ⅱ' : '▶'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next song"
                onPress={() => moveTrack(1)}
                style={styles.skipButton}
              >
                <Text style={styles.skipGlyph}>▶|</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Toggle repeat"
                onPress={() => setIsRepeating((value) => !value)}
                style={styles.sideControl}
              >
                <Text style={[styles.controlGlyph, isRepeating && styles.selectedControl]}>↻</Text>
              </Pressable>
            </GlassSurface>

            <View style={styles.playerFooter}>
              <Text style={styles.localFileGlyph}>▣</Text>
              <Text style={styles.localFileText}>PLAYING FROM THIS DEVICE</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => setIsQueueOpen(false)}
        transparent
        visible={isQueueOpen}
      >
        <View style={styles.detailsBackdrop}>
          <Pressable
            accessible={false}
            onPress={() => setIsQueueOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={[styles.detailsSheet, styles.queueSheet]}>
            <View style={styles.detailsHeader}>
              <View style={styles.detailsHeading}>
                <Text style={styles.eyebrow}>{isAddingQueueTracks ? 'YOUR LIBRARY' : 'PLAYBACK QUEUE'}</Text>
                <Text style={styles.detailsTitle}>
                  {isAddingQueueTracks ? 'Add songs' : `Up next · ${playbackQueue.length}`}
                </Text>
                {!isAddingQueueTracks && (
                  <Text style={styles.queueHint}>Drag ⠿ to rearrange</Text>
                )}
              </View>
              <View style={styles.queueHeaderActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isAddingQueueTracks ? 'Back to queue' : 'Add songs to queue'}
                  onPress={() => setIsAddingQueueTracks((value) => !value)}
                  style={styles.queueAddButton}
                >
                  <Text style={styles.queueAddButtonText}>{isAddingQueueTracks ? 'QUEUE' : '＋ ADD'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close playback queue"
                  onPress={() => setIsQueueOpen(false)}
                  hitSlop={10}
                >
                  <Text style={styles.detailsClose}>×</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView
              contentContainerStyle={styles.queueList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {isAddingQueueTracks ? (
                tracks.filter((track) => !playbackQueue.some((item) => item.id === track.id)).length === 0 ? (
                  <Text style={styles.playlistEmptyHint}>Every library song is already in the queue.</Text>
                ) : (
                  tracks
                    .filter((track) => !playbackQueue.some((item) => item.id === track.id))
                    .map((track) => (
                      <View
                        key={track.id}
                        style={[
                          styles.queueRow,
                          draggingQueueTrackId === track.id && styles.queueRowDragging,
                        ]}
                      >
                        <Artwork seed={track.id} size={42} uri={track.artworkUri} styles={styles} />
                        <View style={styles.queueTrackCopy}>
                          <Text numberOfLines={1} style={styles.queueTrackTitle}>{track.title}</Text>
                          <Text numberOfLines={1} style={styles.queueTrackArtist}>{track.artist}</Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${track.title} to queue`}
                          onPress={() => addTracksToQueue([track], track.title)}
                          style={styles.queueActionButton}
                        >
                          <Text style={styles.queueAddButtonText}>＋</Text>
                        </Pressable>
                      </View>
                    ))
                )
              ) : playbackQueue.length === 0 ? (
                <Text style={styles.playlistEmptyHint}>The playback queue is empty.</Text>
              ) : (
                playbackQueue.map((track, index) => (
                  <View
                    key={track.id}
                    style={[
                      styles.queueRow,
                      draggingQueueTrackId === track.id && styles.queueRowDragging,
                    ]}
                  >
                    <Artwork seed={track.id} size={42} uri={track.artworkUri} styles={styles} />
                    <QueueDragHandle
                      id={track.id}
                      index={index}
                      onDragStateChange={setDraggingQueueTrackId}
                      onMove={moveQueueTrack}
                      styles={styles}
                      title={track.title}
                    />
                    <View style={styles.queueTrackCopy}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.queueTrackTitle,
                          currentTrack?.id === track.id && styles.activeTrackTitle,
                        ]}
                      >
                        {currentTrack?.id === track.id ? '♫  ' : ''}{track.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.queueTrackArtist}>{track.artist}</Text>
                    </View>
                    <View style={styles.queueActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${track.title} from queue`}
                        onPress={() => removeQueueTrack(track, index)}
                        style={styles.queueActionButton}
                      >
                        <Text style={styles.removeButtonText}>×</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setTrackOptionsTrack(null)}
        transparent
        visible={trackOptionsTrack !== null}
      >
        <View style={styles.detailsBackdrop}>
          <Pressable
            accessible={false}
            onPress={() => setTrackOptionsTrack(null)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={[styles.detailsSheet, styles.trackOptionsSheet]}>
            <View style={styles.detailsHeader}>
              <View style={styles.detailsHeading}>
                <Text style={styles.eyebrow}>SONG OPTIONS</Text>
                <Text numberOfLines={1} style={styles.detailsTitle}>
                  {trackOptionsTrack?.title}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close song options"
                onPress={() => setTrackOptionsTrack(null)}
                hitSlop={10}
              >
                <Text style={styles.detailsClose}>×</Text>
              </Pressable>
            </View>
            <View style={styles.trackOptionsList}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${trackOptionsTrack?.title ?? 'song'} to playback queue`}
                onPress={() => {
                  if (trackOptionsTrack) {
                    addTracksToQueue([trackOptionsTrack], trackOptionsTrack.title);
                  }
                  setTrackOptionsTrack(null);
                }}
                style={({ pressed }) => [
                  styles.trackOption,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.trackOptionText}>Add to queue</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Manage playlists for ${trackOptionsTrack?.title ?? 'song'}`}
                accessibilityState={{ disabled: !playlistsReady }}
                disabled={!playlistsReady}
                onPress={() => {
                  if (trackOptionsTrack) setPlaylistTrack(trackOptionsTrack);
                  setTrackOptionsTrack(null);
                }}
                style={({ pressed }) => [
                  styles.trackOption,
                  pressed && styles.buttonPressed,
                  !playlistsReady && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.trackOptionText}>Manage playlists</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View tags for ${trackOptionsTrack?.title ?? 'song'}`}
                onPress={() => {
                  if (trackOptionsTrack) setDetailsTrack(trackOptionsTrack);
                  setTrackOptionsTrack(null);
                }}
                style={({ pressed }) => [
                  styles.trackOption,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.trackOptionText}>View information</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${trackOptionsTrack?.title ?? 'song'} from library`}
                onPress={() => {
                  if (trackOptionsTrack) removeTrack(trackOptionsTrack);
                  setTrackOptionsTrack(null);
                }}
                style={({ pressed }) => [
                  styles.trackOption,
                  styles.trackOptionDestructive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.trackOptionDestructiveText}>Remove from library</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setDetailsTrack(null)}
        transparent
        visible={detailsTrack !== null}
      >
        <View style={styles.detailsBackdrop}>
          <Pressable
            accessible={false}
            onPress={() => setDetailsTrack(null)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={styles.detailsSheet}>
            <View style={styles.detailsHeader}>
              <View style={styles.detailsHeading}>
                <Text style={styles.eyebrow}>TRACK INFORMATION</Text>
                <Text numberOfLines={1} style={styles.detailsTitle}>
                  {detailsTrack?.title}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close song details"
                onPress={() => setDetailsTrack(null)}
                hitSlop={10}
              >
                <Text style={styles.detailsClose}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.detailsList}
              showsVerticalScrollIndicator={false}
            >
              {Object.entries(detailsTrack?.metadata ?? {})
                .sort(([first], [second]) =>
                  first === 'Title' ? -1 : second === 'Title' ? 1 :
                    first === 'Artist' ? -1 : second === 'Artist' ? 1 :
                      compareMetadataValues(first, second),
                )
                .map(([field, value]) => (
                  <View key={field} style={styles.metadataRow}>
                    <Text style={styles.metadataLabel}>{field}</Text>
                    <Text selectable style={styles.metadataValue}>{value}</Text>
                  </View>
                ))}
              {detailsTrack?.aiAnalyzedAt !== undefined && (
                <View style={styles.metadataRow}>
                  <Text style={styles.metadataLabel}>AI tags</Text>
                  <Text selectable style={styles.metadataValue}>
                    {detailsTrack.aiError
                      ? 'Could not analyze this audio file.'
                      : detailsTrack.aiTags?.length
                        ? detailsTrack.aiTags
                            .map(({ category, label }) => `${category}: ${label}`)
                            .join(' · ')
                        : 'No confident tags found.'}
                  </Text>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => setPlaylistTrack(null)}
        transparent
        visible={playlistTrack !== null}
      >
        <View style={styles.detailsBackdrop}>
          <Pressable
            accessible={false}
            onPress={() => setPlaylistTrack(null)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={styles.detailsSheet}>
            <View style={styles.detailsHeader}>
              <View style={styles.detailsHeading}>
                <Text style={styles.eyebrow}>PLAYLISTS</Text>
                <Text numberOfLines={1} style={styles.detailsTitle}>
                  {playlistTrack?.title}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close playlist manager"
                onPress={() => setPlaylistTrack(null)}
                hitSlop={10}
              >
                <Text style={styles.detailsClose}>×</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !playlistsReady }}
              disabled={!playlistsReady}
              onPress={() =>
                playlistTrack && openPlaylistEditor(undefined, playlistTrack.id)
              }
              style={styles.createPlaylistRow}
            >
              <Text style={styles.playlistAddText}>＋</Text>
              <Text style={styles.createPlaylistText}>Create playlist with this song</Text>
            </Pressable>
            <ScrollView
              contentContainerStyle={styles.detailsList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {playlists.every((playlist) => playlist.generatedByAi) ? (
                <Text style={styles.playlistEmptyHint}>
                  Create a playlist to keep songs together. AI-generated playlists update
                  automatically.
                </Text>
              ) : (
                playlists.filter((playlist) => !playlist.generatedByAi).map((playlist) => {
                  const containsTrack = playlist.trackIds.includes(playlistTrack?.id ?? '');
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: containsTrack }}
                      key={playlist.id}
                      onPress={() => {
                        if (playlistTrack) {
                          void togglePlaylistTrack(playlist, playlistTrack, Date.now());
                        }
                      }}
                      style={styles.playlistChoice}
                    >
                      <View style={styles.playlistChoiceCopy}>
                        <Text numberOfLines={1} style={styles.playlistChoiceName}>
                          {playlist.name}
                        </Text>
                        <Text style={styles.playlistChoiceCount}>
                          {playlist.trackIds.length} {playlist.trackIds.length === 1 ? 'song' : 'songs'}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.playlistCheckbox,
                          containsTrack && styles.playlistCheckboxSelected,
                        ]}
                      >
                        {containsTrack && <Text style={styles.playlistCheckboxMark}>✓</Text>}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setIsPlaylistEditorOpen(false)}
        transparent
        visible={isPlaylistEditorOpen}
      >
        <View style={styles.detailsBackdrop}>
          <Pressable
            accessible={false}
            onPress={() => setIsPlaylistEditorOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={[styles.detailsSheet, styles.playlistEditorSheet]}>
            <View style={styles.detailsHeader}>
              <View style={styles.detailsHeading}>
                <Text style={styles.eyebrow}>
                  {playlistEditorId ? 'EDIT PLAYLIST' : 'NEW PLAYLIST'}
                </Text>
                <Text style={styles.detailsTitle}>
                  {playlistEditorId ? 'Rename playlist' : 'Create a playlist'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel playlist editing"
                onPress={() => setIsPlaylistEditorOpen(false)}
                hitSlop={10}
              >
                <Text style={styles.detailsClose}>×</Text>
              </Pressable>
            </View>
            <View style={styles.playlistEditorContent}>
              <TextInput
                accessibilityLabel="Playlist name"
                autoCapitalize="sentences"
                maxLength={60}
                onChangeText={(name) => {
                  setPlaylistName(name);
                  setPlaylistFormError('');
                }}
                onSubmitEditing={() => void savePlaylistEditor()}
                placeholder="Playlist name"
                placeholderTextColor={COLORS.muted}
                returnKeyType="done"
                selectionColor={COLORS.accent}
                style={styles.playlistNameInput}
                value={playlistName}
              />
              {playlistFormError.length > 0 && (
                <Text accessibilityRole="alert" style={styles.playlistFormError}>
                  {playlistFormError}
                </Text>
              )}
              <View style={styles.playlistEditorActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsPlaylistEditorOpen(false)}
                  style={styles.playlistCancelButton}
                >
                  <Text style={styles.playlistCancelText}>CANCEL</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void savePlaylistEditor()}
                  style={styles.playlistSaveButton}
                >
                  <Text style={styles.playlistSaveText}>
                    {playlistEditorId ? 'SAVE' : 'CREATE'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
      <EqualizerSheet
        light={isLightTheme}
        onChange={changeEqualizerSettings}
        onClose={() => setIsEqualizerOpen(false)}
        settings={equalizerSettings}
        visible={isEqualizerOpen}
      />
    </SafeAreaView>
  );
}

function createStyles(COLORS: ThemeColors, isLight: boolean) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  libraryBlurTarget: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 22,
  },
  settingsContent: {
    paddingHorizontal: 22,
  },
  audioHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  queueSheet: {
    maxHeight: '88%',
    minHeight: 320,
  },
  queueHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueAddButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: COLORS.selectedSurface,
    borderWidth: 1,
    borderColor: COLORS.selectedBorder,
  },
  queueAddButtonText: {
    color: COLORS.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  queueList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 7,
  },
  queueRow: {
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: COLORS.rowSurface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  queueRowDragging: {
    backgroundColor: COLORS.selectedSurface,
    borderWidth: 1,
    borderColor: COLORS.selectedBorder,
  },
  queueHint: {
    color: COLORS.muted,
    fontSize: 9,
    marginTop: 1,
  },
  queueDragHandle: {
    width: 28,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueDragGlyph: {
    color: COLORS.secondaryText,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
  },
  queueTrackCopy: {
    flex: 1,
    minWidth: 0,
  },
  queueTrackTitle: {
    color: COLORS.primaryText,
    fontSize: 11,
    fontWeight: '700',
  },
  queueTrackArtist: {
    color: COLORS.secondaryText,
    fontSize: 9,
    marginTop: 4,
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  queueActionButton: {
    width: 30,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeToggle: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: COLORS.controlSurface,
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
  },
  themeToggleIcon: {
    color: COLORS.accent,
    fontSize: 15,
    lineHeight: 18,
  },
  themeToggleText: {
    color: COLORS.primaryText,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  settingsHeading: {
    marginTop: 20,
    marginBottom: 17,
  },
  settingsCard: {
    borderRadius: 22,
  },
  settingsCardContent: {
    padding: 18,
  },
  settingRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  settingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  settingTitle: {
    color: COLORS.primaryText,
    fontSize: 13,
    fontWeight: '700',
  },
  settingDescription: {
    color: COLORS.secondaryText,
    fontSize: 10,
    lineHeight: 15,
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.controlBorder,
    marginVertical: 13,
  },
  settingSwitch: {
    width: 44,
    height: 26,
    padding: 3,
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: COLORS.controlBorder,
  },
  settingSwitchKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primaryText,
  },
  settingsNote: {
    color: COLORS.muted,
    fontSize: 9,
    lineHeight: 14,
    marginTop: -4,
  },
  aiRetryButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: COLORS.selectedSurface,
  },
  aiRetryButtonText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
  },
  brandIconText: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  brandName: {
    color: COLORS.primaryText,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
  },
  eyebrow: {
    color: COLORS.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  navigationBar: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 540,
    borderRadius: 23,
  },
  navigationBarContent: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
  },
  browseMenu: {
    borderRadius: 19,
  },
  browseMenuContent: {
    padding: 8,
    gap: 3,
  },
  settingsImportCard: {
    marginTop: 14,
  },
  addMenuOption: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  addMenuOptionText: {
    color: COLORS.primaryText,
    fontSize: 12,
    fontWeight: '600',
  },
  addMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.controlBorder,
    marginHorizontal: 12,
    marginVertical: 3,
  },
  addMenuStatus: {
    color: COLORS.secondaryText,
    fontSize: 10,
    paddingHorizontal: 12,
    paddingBottom: 3,
  },
  scanButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  browseTab: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 18,
  },
  browseTabSelected: {
    backgroundColor: COLORS.selectedSurface,
  },
  browseTabText: {
    color: COLORS.secondaryText,
    fontSize: 8,
    fontWeight: '700',
  },
  browseTabTextSelected: {
    color: COLORS.accent,
  },
  libraryHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 17,
  },
  groupBack: {
    marginBottom: 8,
  },
  groupBackText: {
    color: COLORS.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  sectionTitle: {
    color: COLORS.primaryText,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginTop: 6,
  },
  songCount: {
    alignItems: 'flex-end',
  },
  libraryHeadingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  shuffleButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: COLORS.selectedSurface,
    borderWidth: 1,
    borderColor: COLORS.selectedBorder,
  },
  shuffleButtonText: {
    color: COLORS.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  newPlaylistButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: COLORS.selectedSurface,
    borderWidth: 1,
    borderColor: COLORS.selectedBorder,
  },
  newPlaylistButtonText: {
    color: COLORS.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  songCountNumber: {
    color: COLORS.primaryText,
    fontSize: 18,
    fontWeight: '700',
  },
  songCountLabel: {
    color: COLORS.muted,
    fontSize: 8,
    letterSpacing: 1.3,
    marginTop: 2,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -7,
    marginBottom: 12,
    marginHorizontal: -22,
  },
  sortLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.1,
    paddingLeft: 22,
    paddingRight: 9,
  },
  sortOptions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 22,
  },
  sortOptionsScroller: {
    flex: 1,
    minWidth: 0,
  },
  sortDirectionButton: {
    minHeight: 29,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginRight: 12,
    paddingHorizontal: 9,
    borderRadius: 15,
    backgroundColor: COLORS.selectedSurface,
    borderWidth: 1,
    borderColor: COLORS.selectedBorder,
  },
  sortDirectionArrow: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  sortDirectionText: {
    color: COLORS.accent,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  sortChip: {
    minHeight: 29,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 15,
    backgroundColor: COLORS.controlSurface,
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
  },
  sortChipSelected: {
    backgroundColor: COLORS.selectedSurface,
    borderColor: COLORS.selectedBorder,
  },
  sortChipPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  sortChipText: {
    color: COLORS.secondaryText,
    fontSize: 9,
    fontWeight: '700',
  },
  sortChipTextSelected: {
    color: COLORS.accent,
  },
  searchBox: {
    height: 44,
    borderRadius: 12,
    marginBottom: 10,
  },
  searchBoxContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    height: '100%',
  },
  searchIcon: {
    color: COLORS.secondaryText,
    fontSize: 23,
    marginRight: 8,
    marginTop: -4,
  },
  searchInput: {
    flex: 1,
    color: COLORS.primaryText,
    fontSize: 12,
    paddingVertical: 0,
  },
  clearSearch: {
    color: COLORS.secondaryText,
    fontSize: 22,
    paddingLeft: 8,
  },
  noticeGlass: {
    borderRadius: 12,
    marginBottom: 9,
  },
  notice: {
    minHeight: 38,
  },
  noticeContent: {
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  noticeText: {
    flex: 1,
    color: COLORS.noticeText,
    fontSize: 11,
    lineHeight: 16,
  },
  noticeClose: {
    color: COLORS.secondaryText,
    fontSize: 20,
    marginLeft: 8,
  },
  trackCard: {
    borderRadius: 17,
    marginBottom: 8,
  },
  trackRow: {
    minHeight: 70,
    paddingHorizontal: 10,
    backgroundColor: COLORS.rowSurface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackNumber: {
    width: 25,
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  artwork: {
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkOrb: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: COLORS.artworkOrb,
    left: -8,
    top: -12,
  },
  artworkNote: {
    color: COLORS.artworkNote,
    fontWeight: '900',
    marginTop: -3,
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
    marginLeft: 11,
    marginRight: 6,
  },
  trackTitle: {
    color: COLORS.primaryText,
    fontSize: 12,
    fontWeight: '700',
  },
  activeTrackTitle: {
    color: COLORS.accent,
  },
  trackArtist: {
    color: COLORS.secondaryText,
    fontSize: 10,
    marginTop: 5,
  },
  trackTag: {
    color: COLORS.muted,
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  groupArrow: {
    color: COLORS.secondaryText,
    fontSize: 25,
    lineHeight: 28,
    marginLeft: 8,
  },
  groupCount: {
    position: 'absolute',
    top: 8,
    right: 12,
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '700',
  },
  removeButton: {
    width: 28,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  trackOptionsButton: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  trackOptionsIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  trackOptionsDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: COLORS.secondaryText,
  },
  playlistAddText: {
    color: COLORS.accent,
    fontSize: 21,
    lineHeight: 24,
    fontWeight: '500',
  },
  queueAddGlyph: {
    color: COLORS.accent,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
  },
  groupQueueButton: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 3,
  },
  playlistManageButton: {
    width: 30,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  playlistManageText: {
    color: COLORS.secondaryText,
    fontSize: 17,
  },
  removeButtonText: {
    color: COLORS.muted,
    fontSize: 20,
    lineHeight: 22,
  },
  detailsBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: COLORS.backdrop,
  },
  detailsSheet: {
    maxHeight: '82%',
    minHeight: 280,
    backgroundColor: COLORS.sheet,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
    overflow: 'hidden',
  },
  trackOptionsSheet: {
    minHeight: 0,
  },
  trackOptionsList: {
    padding: 14,
    gap: 8,
  },
  trackOption: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: 13,
    backgroundColor: COLORS.controlSurface,
  },
  trackOptionText: {
    color: COLORS.primaryText,
    fontSize: 13,
    fontWeight: '600',
  },
  trackOptionDestructive: {
    backgroundColor: 'transparent',
  },
  trackOptionDestructiveText: {
    color: COLORS.error,
    fontSize: 13,
    fontWeight: '600',
  },
  detailsHeader: {
    minHeight: 76,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailsHeading: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  detailsTitle: {
    color: COLORS.primaryText,
    fontSize: 17,
    fontWeight: '700',
  },
  detailsClose: {
    color: COLORS.secondaryText,
    fontSize: 27,
    marginLeft: 12,
  },
  detailsList: {
    paddingHorizontal: 22,
    paddingBottom: 24,
  },
  createPlaylistRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  createPlaylistText: {
    color: COLORS.primaryText,
    fontSize: 12,
    fontWeight: '700',
  },
  playlistEmptyHint: {
    color: COLORS.secondaryText,
    fontSize: 11,
    paddingVertical: 18,
  },
  playlistChoice: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.controlBorder,
  },
  playlistChoiceCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
    paddingRight: 12,
  },
  playlistChoiceName: {
    color: COLORS.primaryText,
    fontSize: 12,
    fontWeight: '700',
  },
  playlistChoiceCount: {
    color: COLORS.muted,
    fontSize: 9,
  },
  playlistCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: COLORS.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistCheckboxSelected: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  playlistCheckboxMark: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  playlistEditorSheet: {
    minHeight: 260,
  },
  playlistEditorContent: {
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  playlistNameInput: {
    height: 48,
    color: COLORS.primaryText,
    fontSize: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.controlSurface,
  },
  playlistFormError: {
    color: COLORS.error,
    fontSize: 10,
    marginTop: 8,
  },
  playlistEditorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  playlistCancelButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  playlistCancelText: {
    color: COLORS.secondaryText,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  playlistSaveButton: {
    minHeight: 42,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 13,
    backgroundColor: COLORS.accent,
  },
  playlistSaveText: {
    color: COLORS.ink,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  metadataRow: {
    minHeight: 48,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.controlBorder,
    gap: 5,
  },
  metadataLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  metadataValue: {
    color: COLORS.primaryText,
    fontSize: 12,
    lineHeight: 18,
  },
  emptyState: {
    minHeight: 205,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  emptyArtwork: {
    height: 58,
    width: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceRaised,
    marginBottom: 16,
  },
  emptyNote: {
    color: COLORS.accent,
    fontSize: 28,
    fontWeight: '800',
  },
  emptyTitle: {
    color: COLORS.primaryText,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyCaption: {
    color: COLORS.secondaryText,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 7,
  },
  emptyCreateButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 17,
    marginTop: 17,
    borderRadius: 14,
    backgroundColor: COLORS.selectedSurface,
    borderWidth: 1,
    borderColor: COLORS.selectedBorder,
  },
  bottomDock: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
  },
  dockContent: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 540,
    gap: 8,
  },
  miniPlayerGlass: {
    borderRadius: 16,
  },
  miniPlayerContent: {
    minHeight: 58,
  },
  miniPlayer: {
    minHeight: 58,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  miniInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 2,
  },
  miniTitle: {
    color: COLORS.primaryText,
    fontSize: 11,
    fontWeight: '700',
  },
  miniArtist: {
    color: COLORS.secondaryText,
    fontSize: 9,
    marginBottom: 4,
  },
  progressTrack: {
    height: 4,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: COLORS.border,
    justifyContent: 'center',
  },
  progressTrackCompact: {
    height: 2,
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: COLORS.accent,
  },
  seekSlider: {
    width: '100%',
    height: 34,
    marginVertical: -8,
  },
  miniPlayButton: {
    height: 39,
    width: 39,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  playerTopBar: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  closePlayer: {
    color: COLORS.primaryText,
    fontSize: 29,
    fontWeight: '300',
    paddingHorizontal: 4,
  },
  playerTopCopy: {
    alignItems: 'center',
    gap: 5,
  },
  playerTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  queueButton: {
    height: 36,
    minWidth: 42,
    paddingHorizontal: 7,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
    backgroundColor: COLORS.controlSurface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  queueButtonCount: {
    color: COLORS.accent,
    fontSize: 9,
    fontWeight: '800',
  },
  playerTopTitle: {
    color: COLORS.secondaryText,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  equalizerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  equalizerButtonIcon: {
    color: COLORS.accent,
    fontSize: 23,
    lineHeight: 25,
    fontWeight: '700',
  },
  playerContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingTop: 20,
    paddingBottom: 32,
  },
  artworkFrame: {
    borderRadius: 29,
    padding: 8,
    shadowColor: COLORS.accent,
    shadowOpacity: 0.16,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 7,
  },
  artworkFrameContent: {
    borderRadius: 21,
    overflow: 'hidden',
  },
  nowPlayingInfo: {
    width: '100%',
    marginTop: 31,
  },
  nowPlayingTitle: {
    color: COLORS.primaryText,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.7,
    textAlign: 'center',
  },
  nowPlayingArtist: {
    color: COLORS.secondaryText,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  progressGlass: {
    width: '100%',
    borderRadius: 17,
    marginTop: 24,
  },
  playerProgress: {
    padding: 15,
  },
  volumeControl: {
    width: '100%',
    height: 38,
    marginTop: 9,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  volumeIcon: {
    width: 18,
    textAlign: 'center',
    color: COLORS.secondaryText,
    fontSize: 18,
    fontWeight: '700',
  },
  volumeSlider: {
    flex: 1,
    height: 34,
  },
  volumeValue: {
    width: 38,
    textAlign: 'right',
    color: COLORS.secondaryText,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  timeText: {
    color: COLORS.muted,
    fontSize: 9,
    fontVariant: ['tabular-nums'],
  },
  controlsGlass: {
    width: '100%',
    borderRadius: 26,
    marginTop: 17,
  },
  controls: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  sideControl: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlGlyph: {
    color: COLORS.secondaryText,
    fontSize: 20,
  },
  selectedControl: {
    color: COLORS.accent,
  },
  skipButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipGlyph: {
    color: COLORS.primaryText,
    fontSize: 20,
    fontWeight: '700',
  },
  mainPlayButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainPlayGlyph: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: '900',
  },
  playerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 35,
  },
  localFileGlyph: {
    color: COLORS.accent,
    fontSize: 11,
  },
  localFileText: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  });
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MusicPlayer />
    </SafeAreaProvider>
  );
}
