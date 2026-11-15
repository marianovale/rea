#!/bin/sh
# Installs Minha TV with LG's official CLI (ares-cli) on a TV in Developer
# Mode. No root needed. See lgtv/README.md, "Sem root".
#
#   ./lgtv/install-dev.sh            instala ou atualiza na TV "tv"
#   ./lgtv/install-dev.sh OUTRA-TV   usa outro nome de aparelho do ares
#
# Prepare the device once with ares-setup-device and ares-novacom (README).
set -eu

APP_ID=io.github.marianovale.lgtv
DEVICE=${1:-tv}
here=$(cd "$(dirname "$0")" && pwd)

if ! command -v ares-install >/dev/null 2>&1; then
  echo "Falta o ares-cli da LG. Instale com:" >&2
  echo "  npm install -g @webos-tools/cli" >&2
  exit 1
fi

ipk=$(node "$here/build.mjs" | tail -1 | sed 's/ (.*//')
echo "Pacote: $ipk"

echo "Instalando na TV \"$DEVICE\"..."
ares-install --device "$DEVICE" "$ipk"
ares-launch --device "$DEVICE" "$APP_ID"
echo "Pronto: a Minha TV está aberta na TV."
echo "Lembre de estender o Modo Desenvolvedor no app da LG a cada poucos dias."
