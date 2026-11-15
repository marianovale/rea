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

current_home() {
  luna-send -n 1 "$SETTINGS/getSystemSettings" '{"category":"general","key":"defaultApps"}' \
    | sed -n 's/.*"home": *"\([^"]*\)".*/\1/p'
}

set_home() {
  out=$(luna-send -n 1 "$SETTINGS/setSystemSettings" \
    "{\"category\":\"general\",\"settings\":{\"defaultApps\":{\"home\":\"$1\"}}}")
  case "$out" in
    *'"returnValue":true'* | *'"returnValue": true'*) return 0 ;;
  esac
  echo "A TV recusou a mudança: $out" >&2
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
