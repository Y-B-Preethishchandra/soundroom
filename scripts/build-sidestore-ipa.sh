#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build/sidestore"
DERIVED_DATA="$BUILD_DIR/DerivedData"
WORKSPACE="$PROJECT_ROOT/ios/Soundroom.xcworkspace"
APP_PATH="$DERIVED_DATA/Build/Products/Release-iphoneos/Soundroom.app"
IPA_PATH="$BUILD_DIR/Soundroom-SideStore.ipa"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This build requires macOS and Xcode." >&2
  exit 1
fi

if [[ ! -x "$PROJECT_ROOT/node_modules/.bin/expo" ]]; then
  echo "Expo is not installed locally. Run npm install first." >&2
  exit 1
fi

for tool in xcodebuild ditto zip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required tool not found: $tool" >&2
    exit 1
  fi
done

mkdir -p "$BUILD_DIR"

echo "Generating the iOS project..."
cd "$PROJECT_ROOT"
npx expo prebuild --platform ios

if [[ ! -d "$WORKSPACE" ]]; then
  echo "Expected Xcode workspace was not generated: $WORKSPACE" >&2
  exit 1
fi

echo "Building an unsigned iPhone app..."
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme Soundroom \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

if [[ ! -d "$APP_PATH" ]]; then
  echo "Xcode completed without producing the expected app: $APP_PATH" >&2
  exit 1
fi

PACKAGE_DIR="$(mktemp -d "$BUILD_DIR/package.XXXXXX")"
TEMP_IPA="$BUILD_DIR/.Soundroom-SideStore.$$.ipa"
trap 'rm -rf "$PACKAGE_DIR"; rm -f "$TEMP_IPA"' EXIT

mkdir -p "$PACKAGE_DIR/Payload"
ditto "$APP_PATH" "$PACKAGE_DIR/Payload/Soundroom.app"
(cd "$PACKAGE_DIR" && zip -qryXy "$TEMP_IPA" Payload)
mv -f "$TEMP_IPA" "$IPA_PATH"

echo
echo "Created: $IPA_PATH"
echo "Transfer the IPA to your iPhone, open it in SideStore, and install it."
echo "With a free Apple ID, refresh the app in SideStore at least every 7 days."
