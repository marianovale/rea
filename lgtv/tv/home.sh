#!/bin/sh
# Points the TV's Home button at Minha TV through the system setting
# general.defaultApps.home, which LG itself uses to pick its home app
# (see /etc/init.d/home_launcher.sh on the TV). No LG file is changed.
#
#   sh home.sh set      save the current home app, then use Minha TV
#   sh home.sh restore  put the saved home app back
#
# The saved value lives on /var (writable) and survives reboots; a reboot
# does not undo the setting, "restore" does. The two MINHA_TV_* variables
# exist only so the tests can run this off the TV.

APP_ID=io.github.marianovale.lgtv
SAVED=${MINHA_TV_HOME_SAVED:-/var/lib/webosbrew/minha-tv-home.orig}
APPS_DIR=${MINHA_TV_APPS_DIR:-/usr/palm/applications}
SETTINGS=luna://com.webos.settingsservice

# stdin from /dev/null: this script itself arrives on stdin ("sh -s"), and
# luna-send must not touch it. stderr is kept, so errors show up.
lunasend() {
  luna-send -n 1 "$@" </dev/null 2>&1
}

current_home() {
  lunasend "$SETTINGS/getSystemSettings" '{"category":"general","key":"defaultApps"}' \
    | sed -n 's/.*"home": *"\([^"]*\)".*/\1/p'
}

# The reply's format varies (it even came back empty over SSH on a real
# UM7520), so success is judged by reading the setting back.
set_home() {
  out=$(lunasend "$SETTINGS/setSystemSettings" \
    "{\"category\":\"general\",\"settings\":{\"defaultApps\":{\"home\":\"$1\"}}}")
  tries=0
  while [ "$tries" -lt 3 ]; do
    if [ "$(current_home)" = "$1" ]; then return 0; fi
    tries=$((tries + 1))
    sleep 1
  done
  echo "A TV não aceitou a mudança (resposta: ${out:-vazia}; valor atual: $(current_home))." >&2
  return 1
}

case "${1:-}" in
  set)
    now=$(current_home)
    # Keep the first original across reinstalls: never save our own id.
    if [ ! -s "$SAVED" ] && [ -n "$now" ] && [ "$now" != "$APP_ID" ]; then
      mkdir -p "$(dirname "$SAVED")"
      printf '%s\n' "$now" > "$SAVED"
    fi
    set_home "$APP_ID" || exit 1
    echo "Botão Home -> Minha TV (antes: $(cat "$SAVED" 2>/dev/null || echo desconhecido))."
    ;;
  restore)
    now=$(current_home)
    if [ -s "$SAVED" ]; then
      orig=$(cat "$SAVED")
    elif [ "$now" = "$APP_ID" ]; then
      # Nothing saved (set by hand): fall back to an LG home that exists.
      if [ -d "$APPS_DIR/com.webos.app.fullhome" ]; then
        orig=com.webos.app.fullhome
      else
        orig=com.webos.app.home
      fi
    else
      echo "O botão Home já é da LG ($now)."
      exit 0
    fi
    set_home "$orig" || exit 1
    rm -f "$SAVED"
    echo "Botão Home devolvido para $orig."
    ;;
  *)
    echo "uso: home.sh set|restore" >&2
    exit 2
    ;;
esac
