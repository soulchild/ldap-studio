#!/bin/sh
# Installs the Linux packages in a clean Debian container and launches each (task 14.1).
# Usage: sh test/package/linux-check.sh [arm64|amd64]   (run from the repository root)
set -eu
arch="${1:-arm64}"
case "$arch" in
  arm64) appimage=arm64 ;;
  amd64) appimage=x86_64 ;;
  *) echo "unknown architecture: $arch" >&2; exit 2 ;;
esac
docker run --rm --platform "linux/$arch" -v "$PWD:/repo:ro" -w /repo node:24-bookworm sh -euc "
  apt-get update -qq >/dev/null
  apt-get install -y -qq xvfb xauth ./dist/ldap-studio-0.1.0-$arch.deb >/dev/null 2>&1
  echo \"java: \$(command -v java || echo none)\"
  # Root in a container has no user namespaces for Chromium's sandbox.
  xvfb-run -a node test/package/launch.mjs /opt/LDAP\ Studio/ldap-studio --no-sandbox
  cp dist/ldap-studio-0.1.0-$appimage.AppImage /tmp/app.AppImage
  APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a node test/package/launch.mjs /tmp/app.AppImage --no-sandbox
"
