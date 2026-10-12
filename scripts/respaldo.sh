#!/usr/bin/env bash
# Respaldo diario de la base. Programar en el VPS con:
#   crontab -e  →  30 3 * * * /ruta/PanemaSpa-Back/scripts/respaldo.sh >> /var/log/panema-respaldo.log 2>&1
# Después de generarlo, copiarlo FUERA del VPS (rclone a Backblaze B2 / Cloudflare R2):
#   RCLONE_DESTINO=b2:panema-respaldos
set -euo pipefail

cd "$(dirname "$0")/.."
DESTINO=./respaldos
mkdir -p "$DESTINO"
ARCHIVO="$DESTINO/panema-$(date +%F_%H%M).dump"

docker compose exec -T db pg_dump -U panema -d panema -Fc > "$ARCHIVO"
echo "$(date -Is) respaldo creado: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

if [ -n "${RCLONE_DESTINO:-}" ]; then
  rclone copy "$ARCHIVO" "$RCLONE_DESTINO"
  echo "$(date -Is) copiado a $RCLONE_DESTINO"
fi

# Retener 14 días en el VPS (el externo maneja su propia retención)
find "$DESTINO" -name 'panema-*.dump' -mtime +14 -delete

# Restaurar (probar al menos una vez):
#   docker compose exec -T db pg_restore -U panema -d panema --clean --if-exists < respaldos/archivo.dump
