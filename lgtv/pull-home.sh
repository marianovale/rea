#!/bin/sh
# Copies the stock LG home screen and related system facts from a rooted TV
# to this computer, for reverse engineering. READ-ONLY on the TV: it only
# reads files and asks services for lists; nothing is written there.
#
#   ./lgtv/pull-home.sh IP-DA-TV
#
# Output: lgtv/re/<data>/ (ignored by git: these are LG's files, keep them
# out of the repository).
set -eu

if [ $# -ne 1 ]; then
  sed -n '6p' "$0" | sed 's/^# *//'
  exit 2
fi
TV=$1
here=$(cd "$(dirname "$0")" && pwd)
out="$here/re/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
control_dir=$(mktemp -d)
trap 'ssh -O exit -o ControlPath="$control_dir/s" "root@$TV" 2>/dev/null || true; rm -rf "$control_dir"' EXIT

tv() {
  ssh -o ControlMaster=auto -o ControlPath="$control_dir/s" -o ControlPersist=120 \
    -o ConnectTimeout=10 "root@$TV" "$@"
}

echo "Lendo informações do sistema..."
tv 'cat /var/run/nyx/os_info.json 2>/dev/null || nyx-cmd OSInfo query --format=json 2>/dev/null' \
  > "$out/os_info.json" || true
tv 'cat /etc/starfish-release 2>/dev/null; uname -a' > "$out/release.txt" || true
tv "luna-send -n 1 luna://com.webos.applicationManager/listLaunchPoints '{}'" \
  > "$out/launch-points.json" || true
tv "luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}'" \
  > "$out/foreground.json" || true
tv 'ls -1 /usr/palm/applications/' > "$out/system-apps.txt" || true

# The stock home app id changed across webOS versions.
home=$(tv 'for id in com.webos.app.home com.webos.app.launcher; do
  [ -d /usr/palm/applications/$id ] && { echo $id; break; }; done' || true)
if [ -z "$home" ]; then
  echo "Não achei o app de tela inicial da LG; veja system-apps.txt." >&2
else
  echo "Copiando $home..."
  tv "tar -czf - -C /usr/palm/applications $home" > "$out/$home.tar.gz"
fi

# Who handles the Home key, and what the home app is allowed to call.
echo "Copiando permissões e configuração da tela..."
tv 'cd / && tar -czf - \
  $(ls -d usr/share/luna-service2/roles.d/*webos.app.home* \
          usr/share/luna-service2/roles.d/*webos.app.launcher* \
          usr/share/luna-service2/client-permissions.d/*webos.app.home* \
          usr/share/luna-service2/client-permissions.d/*webos.app.launcher* \
          usr/share/luna-service2/manifests.d/*webos.app.home* \
          etc/surface-manager.d 2>/dev/null)' > "$out/system-config.tar.gz" || true

echo
echo "Pronto: $out"
echo "Nada foi alterado na TV."
