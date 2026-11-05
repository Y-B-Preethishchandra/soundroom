#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build/local-apk"
APK_PATH="$PROJECT_ROOT/android/app/build/outputs/apk/release/app-release.apk"
OUTPUT_PATH="$BUILD_DIR/Soundroom.apk"

if [[ ! -x "$PROJECT_ROOT/node_modules/.bin/expo" ]]; then
  echo "Expo is not installed locally. Run npm install first." >&2
  exit 1
fi

if ! command -v java >/dev/null 2>&1; then
  echo "Java is required. Install a JDK supported by this Expo SDK." >&2
  exit 1
fi

ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$ANDROID_SDK" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    ANDROID_SDK="$HOME/Library/Android/sdk"
  else
    ANDROID_SDK="$HOME/Android/Sdk"
  fi
fi

if [[ ! -d "$ANDROID_SDK" ]]; then
  echo "Android SDK not found at: $ANDROID_SDK" >&2
  echo "Install the Android SDK and set ANDROID_HOME or ANDROID_SDK_ROOT." >&2
  exit 1
fi

export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"

mkdir -p "$BUILD_DIR"

echo "Generating the Android project..."
cd "$PROJECT_ROOT"
npx expo prebuild --platform android

if [[ ! -f "$PROJECT_ROOT/android/gradlew" ]]; then
  echo "Expected Gradle wrapper was not generated in android/." >&2
  exit 1
fi

echo "Building a standalone, locally signed release APK..."
(cd "$PROJECT_ROOT/android" && bash ./gradlew --no-daemon --console=plain assembleRelease)

if [[ ! -f "$APK_PATH" ]]; then
  echo "Gradle completed without producing the expected APK: $APK_PATH" >&2
  exit 1
fi

cp "$APK_PATH" "$OUTPUT_PATH"

echo
echo "Created: $OUTPUT_PATH"
echo "This release APK is signed with the generated project's default debug key for local installation."
