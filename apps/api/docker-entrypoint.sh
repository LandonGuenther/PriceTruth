#!/bin/sh
# Ensure the archive volume mount is writable by the non-root app user.
set -eu
if [ -d /data ]; then
  mkdir -p /data/archive
  # Volume mounts are often root-owned; chown when we can (entrypoint runs as root).
  if [ "$(id -u)" = "0" ]; then
    chown -R app:app /data || true
  fi
fi
if [ "$(id -u)" = "0" ]; then
  exec su-exec app "$@"
fi
exec "$@"
