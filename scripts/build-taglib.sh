#!/usr/bin/env bash

cat << 'DESCRIPTION' >/dev/null
Build TagLib from source as static libraries for distribution.
Installs to vendor/taglib/ relative to the project root.

Usage:
	scripts/build-taglib.sh              # Build for current architecture
	scripts/build-taglib.sh --force      # Rebuild even if already built
	scripts/build-taglib.sh --arch arm64 # Build for specific architecture
DESCRIPTION

set -euo pipefail

TAGLIB_VERSION="${TAGLIB_VERSION:-2.0.2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENDOR_DIR="${PROJECT_ROOT}/vendor/taglib"
BUILD_DIR="/tmp/taglib-${TAGLIB_VERSION}-static-build"

FORCE=0
ARCH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force) FORCE=1; shift ;;
        --arch)  ARCH="$2"; shift 2 ;;
        *)       echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Skip if already built (unless --force)
if [[ -f "${VENDOR_DIR}/lib/libtag.a" && -f "${VENDOR_DIR}/lib/libtag_c.a" && ${FORCE} -eq 0 ]]; then
    echo "TagLib static libraries already exist at ${VENDOR_DIR}/lib/"
    echo "Use --force to rebuild"
    exit 0
fi

# Detect architecture
if [[ -z "${ARCH}" ]]; then
    ARCH="$(uname -m)"
fi

# Map architecture names
case "${ARCH}" in
    arm64|aarch64) CMAKE_ARCH="arm64" ;;
    x86_64|x64)    CMAKE_ARCH="x86_64" ;;
    *)             CMAKE_ARCH="${ARCH}" ;;
esac

echo "Building TagLib ${TAGLIB_VERSION} static libraries (${CMAKE_ARCH})..."

# Download source if not cached
SOURCE_TAR="/tmp/taglib-${TAGLIB_VERSION}.tar.gz"
SOURCE_DIR="/tmp/taglib-${TAGLIB_VERSION}"

if [[ ! -f "${SOURCE_TAR}" ]]; then
    echo "Downloading TagLib ${TAGLIB_VERSION} source..."
    curl -sL "https://github.com/taglib/taglib/releases/download/v${TAGLIB_VERSION}/taglib-${TAGLIB_VERSION}.tar.gz" \
        -o "${SOURCE_TAR}"
fi

# Always re-extract to ensure complete source tree
echo "Extracting source..."
rm -rf "${SOURCE_DIR}"
tar xzf "${SOURCE_TAR}" -C /tmp

# Verify CMakeLists.txt exists
if [[ ! -f "${SOURCE_DIR}/CMakeLists.txt" ]]; then
    echo "ERROR: CMakeLists.txt not found after extraction" >&2
    echo "Expected at: ${SOURCE_DIR}/CMakeLists.txt" >&2
    exit 1
fi

# Clean previous build
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

# Configure with CMake
echo "Configuring CMake..."
CMAKE_EXTRA_ARGS=()
if [[ "$(uname -s)" == "Darwin" ]]; then
    CMAKE_EXTRA_ARGS+=("-DCMAKE_OSX_ARCHITECTURES=${CMAKE_ARCH}")
fi

if [[ "${CMAKE_ARCH}" == "x86_64" ]]; then
    CMAKE_EXTRA_ARGS+=("-DCMAKE_C_FLAGS=-march=x86-64" "-DCMAKE_CXX_FLAGS=-march=x86-64")
fi

cmake -S "${SOURCE_DIR}" -B "${BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_TESTING=OFF \
    -DBUILD_EXAMPLES=OFF \
    -DBUILD_BINDINGS=ON \
    -DCMAKE_INSTALL_PREFIX="${VENDOR_DIR}" \
    "${CMAKE_EXTRA_ARGS[@]}"

# Build
echo "Compiling..."
cmake --build "${BUILD_DIR}" --parallel "$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"

# Install to vendor directory
echo "Installing to ${VENDOR_DIR}/"
rm -rf "${VENDOR_DIR}"
cmake --install "${BUILD_DIR}"

# Verify
if [[ -f "${VENDOR_DIR}/lib/libtag.a" && -f "${VENDOR_DIR}/lib/libtag_c.a" ]]; then
    TAG_SIZE=$(wc -c < "${VENDOR_DIR}/lib/libtag.a" | tr -d ' ')
    TAG_C_SIZE=$(wc -c < "${VENDOR_DIR}/lib/libtag_c.a" | tr -d ' ')
    echo "Success: libtag.a (${TAG_SIZE} bytes), libtag_c.a (${TAG_C_SIZE} bytes)"
else
    echo "ERROR: Static libraries not found after build" >&2
    exit 1
fi

# Clean up build directory
rm -rf "${BUILD_DIR}"
echo "Done."
