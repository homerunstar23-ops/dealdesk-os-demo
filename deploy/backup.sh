#!/usr/bin/env bash
# Consistent SQLite snapshot + uploads archive, encrypted with `age` to a public key you control.
# Usage: AGE_RECIPIENT=age1... ./deploy/backup.sh      (keeps the last 30 backups in ./backups)
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%Y%m%d-%H%M%S); OUT=backups; mkdir -p "$OUT"; chmod 700 "$OUT"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
node -e "const D=require('better-sqlite3');const db=new D(process.argv[1],{readonly:true});db.backup(process.argv[2]).then(()=>db.close())" "${DB_FILE:-data/dealdesk.db}" "$TMP/dealdesk.db"
tar -C "$TMP" -cf "$TMP/bundle.tar" dealdesk.db
[ -d "${UPLOAD_DIR:-data/uploads}" ] && tar -C "$(dirname "${UPLOAD_DIR:-data/uploads}")" -rf "$TMP/bundle.tar" "$(basename "${UPLOAD_DIR:-data/uploads}")"
if [ -n "${AGE_RECIPIENT:-}" ] && command -v age >/dev/null; then
  gzip -c "$TMP/bundle.tar" | age -r "$AGE_RECIPIENT" > "$OUT/dealdesk-$STAMP.tar.gz.age"
else
  echo "WARNING: AGE_RECIPIENT not set or 'age' not installed — writing an UNENCRYPTED backup (chmod 600)." >&2
  gzip -c "$TMP/bundle.tar" > "$OUT/dealdesk-$STAMP.tar.gz"
fi
chmod 600 "$OUT"/dealdesk-"$STAMP".*
ls -1t "$OUT"/dealdesk-* | tail -n +31 | xargs -r rm -f
echo "Backup written: $(ls -1t "$OUT"/dealdesk-* | head -1)"
