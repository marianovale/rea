#!/bin/sh
# Installs Minha TV on a rooted LG TV (Homebrew Channel) over SSH.
#
#   ./lgtv/install.sh IP-DA-TV              instala ou atualiza
#   ./lgtv/install.sh IP-DA-TV --autostart  e abre a Minha TV quando a TV liga
#   ./lgtv/install.sh IP-DA-TV --home       e faz o botão Home abrir a Minha TV
#   ./lgtv/install.sh IP-DA-TV --uninstall  remove tudo e devolve o Home à LG
#
# --autostart e --home podem ir juntos. The stock LG home app is never
# changed: Minha TV is a separate app, and --home only changes a setting.
set -eu

APP_ID=io.github.marianovale.lgtv
INITD=/var/lib/webosbrew/init.d/minha-tv
ELEVATE=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service

if [ $# -lt 1 ]; then
  sed -n '4,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
TV=$1
shift
AUTOSTART=no
HOME_BUTTON=no
UNINSTALL=no
for opt in "$@"; do
  case "$opt" in
    --autostart) AUTOSTART=yes ;;
    --home) HOME_BUTTON=yes ;;
    --uninstall) UNINSTALL=yes ;;
    *) echo "Opção desconhecida: $opt" >&2; exit 2 ;;
  esac
done

here=$(cd "$(dirname "$0")" && pwd)
control_dir=$(mktemp -d)
trap 'ssh -O exit -o ControlPath="$control_dir/s" "root@$TV" 2>/dev/null || true; rm -rf "$control_dir"' EXIT

# One SSH connection for every step, so the password is asked only once.
# webOS TVs only offer the older ssh-rsa algorithm, which recent OpenSSH
# disables by default; the two options below allow it.
tv() {
  ssh -o ControlMaster=auto -o ControlPath="$control_dir/s" -o ControlPersist=120 \
    -o ConnectTimeout=10 \
    -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa \
    "root@$TV" "$@"
}

# Stops the watcher a previous --autostart left running (tv/autostart.sh stays
# up to catch wake-ups). The [x] patterns keep pkill from matching this very
# command, whose own command line holds the pattern.
# Also stops the phone server it runs (the shells first, so nothing restarts it).
stop_watcher() {
  tv "pkill -f '[w]ebosbrew/init.d/minha-tv'; pkill -f '[t]vpower/power/getPowerState'; pkill -f '[i]o.github.marianovale.lgtv.service/server.js'; true"
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

if [ "$UNINSTALL" = yes ]; then
  # Give the Home button back first, so it never points at a removed app.
  tv "sh -s restore" < "$here/tv/home.sh"
  stop_watcher
  # The settings and access code of the phone page go too.
  tv "rm -f $INITD; rm -rf /var/lib/webosbrew/minha-tv; luna-send -n 1 luna://com.webos.appInstallService/dev/remove '{\"id\":\"$APP_ID\"}'"
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

if [ "$AUTOSTART" = yes ]; then
  tv "mkdir -p /var/lib/webosbrew/init.d && cat > $INITD && chmod 755 $INITD" < "$here/tv/autostart.sh"
  # Restart it now, so the new version runs without rebooting the TV.
  stop_watcher
  tv "nohup sh $INITD >/dev/null 2>&1 </dev/null &"
  echo "A Minha TV vai abrir sozinha quando a TV ligar (e quando acordar do modo de espera)."

  # The phone page: needs Node.js on the TV; its server creates the access code.
  if ! tv "command -v node >/dev/null 2>&1"; then
    echo "Aviso: a TV não tem Node.js, então a página do celular não vai rodar." >&2
  else
    code=
    i=0
    while [ -z "$code" ] && [ "$i" -lt 15 ]; do
      code=$(tv "cat /var/lib/webosbrew/minha-tv/token 2>/dev/null" || true)
      [ -n "$code" ] || sleep 1
      i=$((i + 1))
    done
    if [ -n "$code" ]; then
      echo "Pelo celular (mesmo Wi-Fi): http://$TV:8787/#t=$code"
    else
      echo "Aviso: a página do celular não respondeu; veja a aba Temas na TV depois." >&2
    fi
  fi
fi

if [ "$HOME_BUTTON" = yes ]; then
  # The app is installed either way, so a failure here still reopens it.
  if ! tv "sh -s set" < "$here/tv/home.sh"; then
    echo "Aviso: o botão Home não mudou. O app está instalado; rode de novo com --home." >&2
  fi
fi

tv "luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"$APP_ID\"}' >/dev/null"
echo "Pronto: a Minha TV está aberta na TV."
