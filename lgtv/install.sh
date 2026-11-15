#!/bin/sh
# Installs Minha TV on a rooted LG TV (Homebrew Channel) over SSH.
#
#   ./lgtv/install.sh IP-DA-TV              instala ou atualiza
#   ./lgtv/install.sh IP-DA-TV --autostart  e abre a Minha TV quando a TV liga
#   ./lgtv/install.sh IP-DA-TV --uninstall  remove tudo o que este script pôs
#
# The stock LG home app is never changed: Minha TV is a separate app.
set -eu

APP_ID=io.github.marianovale.lgtv
INITD=/var/lib/webosbrew/init.d/minha-tv
ELEVATE=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service

if [ $# -lt 1 ]; then
  sed -n '4,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
TV=$1
MODE=${2:-}
case "$MODE" in ""|--autostart|--uninstall) ;; *) echo "Opção desconhecida: $MODE" >&2; exit 2 ;; esac

here=$(cd "$(dirname "$0")" && pwd)
control_dir=$(mktemp -d)
trap 'ssh -O exit -o ControlPath="$control_dir/s" "root@$TV" 2>/dev/null || true; rm -rf "$control_dir"' EXIT

# One SSH connection for every step, so the password is asked only once.
tv() {
  ssh -o ControlMaster=auto -o ControlPath="$control_dir/s" -o ControlPersist=120 \
    -o ConnectTimeout=10 "root@$TV" "$@"
}

status=0
tv "test -x $ELEVATE" || status=$?
if [ "$status" = 255 ]; then
  echo "Não consegui entrar por SSH em root@$TV. Confira o IP e se o SSH está ligado no Homebrew Channel." >&2
  exit 1
elif [ "$status" != 0 ]; then
  echo "A TV em $TV não tem o Homebrew Channel com root (faltou $ELEVATE)." >&2
  echo "Veja lgtv/README.md, seção 1." >&2
  exit 1
fi

if [ "$MODE" = "--uninstall" ]; then
  tv "rm -f $INITD; luna-send -n 1 luna://com.webos.appInstallService/dev/remove '{\"id\":\"$APP_ID\"}'"
  echo "Minha TV removida. A tela inicial da LG continua como sempre foi."
  exit 0
fi

ipk=$(node "$here/build.mjs" | tail -1 | sed 's/ (.*//')
echo "Pacote: $ipk"

echo "Enviando para a TV..."
tv "cat > /tmp/minha-tv.ipk" < "$ipk"

echo "Instalando..."
# appInstallService answers several times while it works; wait for the
# final state instead of a fixed time.
tv "sh -s" <<EOF
log=/tmp/minha-tv-install.log
rm -f "\$log"
luna-send -i luna://com.webos.appInstallService/dev/install \
  '{"id":"$APP_ID","ipkUrl":"/tmp/minha-tv.ipk","subscribe":true}' > "\$log" 2>&1 &
pid=\$!
i=0
result=timeout
while [ \$i -lt 120 ]; do
  if grep -qE '"state": ?"installed"' "\$log"; then result=ok; break; fi
  if grep -qiE 'fail|"returnValue": ?false' "\$log"; then result=failed; break; fi
  sleep 1
  i=\$((i + 1))
done
kill \$pid 2>/dev/null
rm -f /tmp/minha-tv.ipk
if [ \$result != ok ]; then
  echo "A instalação não terminou (\$result):"
  cat "\$log"
  exit 1
fi
$ELEVATE $APP_ID.service >/dev/null
echo "Instalado e com root."
EOF

if [ "$MODE" = "--autostart" ]; then
  tv "mkdir -p /var/lib/webosbrew/init.d && cat > $INITD && chmod 755 $INITD" < "$here/tv/autostart.sh"
  echo "A Minha TV vai abrir sozinha quando a TV ligar."
fi

tv "luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"$APP_ID\"}' >/dev/null"
echo "Pronto: a Minha TV está aberta na TV."
