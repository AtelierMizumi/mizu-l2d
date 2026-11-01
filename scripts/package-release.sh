#!/usr/bin/env bash
# Packages a clean distribution archive of mizu-l2d for GitHub Releases and AUR.

set -euo pipefail

VERSION="${1:-${GITHUB_REF_NAME:-v0.2.0}}"
VERSION_CLEAN="${VERSION#v}"
DIST_DIR="dist"
ARCHIVE_NAME="mizu-l2d-${VERSION_CLEAN}.tar.gz"

echo "[package] Packaging mizu-l2d version: ${VERSION} (${ARCHIVE_NAME})"

mkdir -p "${DIST_DIR}"
TMP_PKG="/tmp/mizu-l2d-package-${VERSION_CLEAN}"
rm -rf "${TMP_PKG}"
mkdir -p "${TMP_PKG}"

# Export repository using git archive to ensure no dev artifacts or caches leak
git archive --format=tar HEAD | tar -x -C "${TMP_PKG}"

# Exclude unnecessary internal assets or temporary test files from release bundle
rm -rf "${TMP_PKG}/.github" \
       "${TMP_PKG}/tests/probe" \
       "${TMP_PKG}/.gitignore" \
       "${TMP_PKG}/.agents"

# Create compressed release tarball
tar -czf "${DIST_DIR}/${ARCHIVE_NAME}" -C "/tmp" "mizu-l2d-package-${VERSION_CLEAN}"

# Compute SHA-256 checksum
(cd "${DIST_DIR}" && sha256sum "${ARCHIVE_NAME}" > "${ARCHIVE_NAME}.sha256")

# Clean up temporary staging directory
rm -rf "${TMP_PKG}"

echo "[package] Successfully generated release artifacts:"
ls -lh "${DIST_DIR}/${ARCHIVE_NAME}"*
cat "${DIST_DIR}/${ARCHIVE_NAME}.sha256"
