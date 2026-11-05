# Soundroom

Soundroom is a React Native music player for audio files already on your iOS or Android device. It plays imported songs locally and does not use cloud streaming or require an account.

## Run the app

```sh
npm install
npm run android
```

The native audio engine and equalizer require a development build; Expo Go does not include these native modules. The first `npm run android` builds and installs Soundroom's Android development app and starts Metro. For later sessions, use `npm run start` and open its QR code with the installed Soundroom development app, not Expo Go. `npm run ios` builds and installs the iOS development app on a Mac with Xcode.

For local Android builds, install Android Studio and its Android SDK (including SDK Platform, Build-Tools, and Platform-Tools). Connect an Android device with USB debugging enabled, or start an emulator, before running `npm run android`. On macOS, the default SDK location is `$HOME/Library/Android/sdk`; set `ANDROID_HOME` to that directory and add its `platform-tools` directory to `PATH` if the installer does not configure them.

Background playback and lock-screen playback controls use native configuration, so rebuild the app after changing the audio plugin settings or adding native modules. Android may ask for notification permission when you start playback so its background controls can appear.

## Build installable files

These commands use Expo Application Services (EAS) to build in the cloud, so a local Android SDK or Xcode installation is not needed:

```sh
npx eas-cli@latest login
npm run eas:init
npm run build:apk
npm run build:ipa
```

`npm run build:apk` creates an Android APK for direct installation. `npm run build:ipa` creates an iOS IPA for internal distribution. EAS prints a build page and download link when each build completes. iOS internal builds require Apple Developer signing credentials and the target device must be registered with the provisioning profile.

### Build an Android APK locally

To build without uploading the project to Expo, install a JDK and Android SDK, then run:

```sh
npm install
npm run build:apk:local
```

This generates the Android project with Expo and builds a standalone release APK locally at `build/local-apk/Soundroom.apk`. The APK is signed with the generated project's default debug key and can be installed directly on a device; it is intended for personal testing, not Play Store distribution. Set `ANDROID_HOME` or `ANDROID_SDK_ROOT` if your SDK is not in its standard location. This does not use EAS or upload the project to Expo.

### Install on iPhone with SideStore (free Apple ID)

On a Mac with Xcode installed, run:

```sh
npm install
npm run build:sidestore
```

This generates the iOS project with Expo, builds an unsigned device app locally, and packages it as `build/sidestore/Soundroom-SideStore.ipa`. Transfer that IPA to your iPhone (for example, with AirDrop), open it in SideStore, and install it. SideStore handles signing with your Apple ID; a paid Apple Developer account is not needed. Apps signed with a free account expire after 7 days, so refresh Soundroom in SideStore regularly. This local workflow does not use EAS cloud signing.

## Add music

Open **Settings → Music Library** to choose **Add music from files** or **Import a music folder**. Soundroom accepts common formats including MP3, AAC/M4A/M4B, FLAC, WAV, AIFF, CAF, AMR, 3GP, Ogg Vorbis, and Opus. Audio MIME types reported by the file picker are also accepted, so additional formats can be imported. Actual playback depends on the codecs available in the device OS or browser; protected or unsupported files may not play. These import actions copy selected songs into private app storage so they remain available in the library; the originals are not moved or deleted. Folder selection is supported on Android and iOS, and in browsers that support directory uploads. Remove a song from the library with the × button beside it.

The app only requests access to files the user selects. It does not scan the device, upload music, or contact a streaming service.

On web, imported audio is stored locally in the browser's IndexedDB for that site. Clearing the browser's site data removes that web library.

## Copy music into the app

On iOS, Soundroom exposes its Documents folder in the Files app. Copy audio files into **On My iPhone → Soundroom**; Soundroom scans that folder and its subfolders when it opens. The files are then added to the library and copied into Soundroom's managed audio storage.

On Android, open **Settings → Music Library → Set music folder** and choose a folder using the system picker (for example, a folder under Music). Copy audio files there and tap **Scan folder now**, or reopen Soundroom to discover them. A scan shows its progress and reports how many new songs were added, or that no new audio files were found. Android remembers the folder permission. Newly discovered files are copied into Soundroom's managed storage; the originals in the drop folder are left untouched. If access to the selected folder is revoked, choose it again.

To play music directly from an existing folder without copying its audio into Soundroom, use **Settings → Music Library → Scan existing folder for music** and select the folder. Soundroom stores references to the selected audio files, so they remain available only while the app can access that folder and its files. If access is unavailable after reopening the app, the saved library and playlist entries are retained; scan the folder again after restoring access. Removing one of these songs from the library does not delete the original.

The iOS Files integration requires a new native build after updating the app configuration.

## Appearance

Open **Settings** to switch between light and dark mode. The choice is saved locally and applies across the library, player, metadata and playlist sheets, glass panels, and equalizer.

## Browse your library

Use the liquid-glass bottom tab bar on web, iOS, and Android to browse Songs, Albums, Artists, Composers, Genres, and Playlists. On iOS and Android, enabling **Settings → AI features** also adds AI-tagged Moods and Themes to Browse. Soundroom reads embedded tags from MP3 (ID3), MP4/M4A, and FLAC files, including recognized fields such as title, artist, album, composer, genre, dates, track/disc numbers, BPM, lyrics, comments, and credits. Embedded JPEG, PNG, GIF, or WebP album art is shown on song rows, collection groups, and the player; tracks without readable cover art use the app’s placeholder. Other readable text frames are retained and shown too. Other audio formats are still importable and playable when supported by the device, but may use filename-based details. When tags are unavailable or unsupported, it uses the filename for the title and artist and places unavailable album, composer, or genre values in an “Unknown” group. Existing library entries are updated with tags the next time the app opens.

Tap the information button on a song row to inspect all parsed text tags and file details. Search matches metadata and any AI labels. Sort controls include common fields and additional tag fields found in your library, with a separate ascending/descending order toggle. Date added sorting orders tracks and playlists chronologically; grouped lists use the newest song in each group as the date.

## On-device music AI

On iOS and Android, enable **Settings → AI features** to analyze newly added and previously imported songs with the first five minutes of audio using [YAMNet](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet), an open-source audio model distributed under Apache 2.0 (see [model license](./assets/ai/LICENSE-YAMNET)). Longer files remain playable and are analyzed using only that initial five-minute segment. Audio stays on the device. Soundroom stores confident genre, mood, and theme labels, shows them in song information, and updates AI Recommendations and matching playlists as tracks are analyzed. Failed tracks can be retried from Settings while AI is enabled. The model provides general audio labels, not definitive music metadata. Disable the setting at any time to stop analysis and background scheduling. OS background execution is best-effort and may be deferred by battery state or platform scheduling; analysis continues while the app is open. AI analysis is not available in the web build.

## Playlists

Open **Playlists** to create, rename, and delete playlists. Use the plus button beside any song to add it to or remove it from one or more playlists, or create a new playlist with that song. Playlist data is saved locally on the device; deleting a playlist does not delete its songs.

Use **Shuffle** in the Songs tab or inside a playlist to create and start a randomized play queue for that list. Use the song options menu or the queue button beside an album/artist/composer/genre group to add tracks to the queue. Open the queue from the player to add songs from your library, remove songs, or drag tracks to reorder them. The player’s shuffle control randomizes the remaining queue while keeping the current song in place. Drag the playback slider to seek. On iOS and Android, the volume slider changes system media volume; in web browsers, it adjusts this player’s playback volume.

## Equalizer

In the iOS and Android apps, open the player and tap the equalizer control to choose Flat, Bass, Vocal, Treble, Rock, Jazz, Classical, or Electronic, or adjust the five frequency bands yourself. Choosing a preset enables the equalizer, and changes apply to the live audio output during playback and are saved on the device. Audio routes through the system-selected output, including connected Bluetooth media devices. The web player uses browser audio playback; equalizer processing is available in the native apps.

The interface uses translucent glass panels with native blur on iOS and Android 12+. Older Android versions keep the same translucent styling without native blur.
