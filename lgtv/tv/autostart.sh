#!/bin/sh
# Homebrew Channel runs the scripts in /var/lib/webosbrew/init.d/ at boot.
# install.sh copies this one there only with --autostart. It:
#   1. re-applies root to the service and opens Minha TV once the TV's UI
#      is up (a full boot);
#   2. keeps running and, each time the TV wakes up from standby, opens
#      Minha TV over the input the TV resumed. With Quick Start+ the TV
#      only sleeps ("Suspend") when turned off, so step 1 does not run
#      again; and LG honours its own "home auto launch" setting only on a
#      full boot. This makes that setting work on wake-ups too.
# On a wake it acts only when LG's homeAutoLaunch is on and the home app is
# Minha TV (install.sh --home), and never when an HDMI device turned the TV
# on through HDMI-CEC (e.g. a console): then that device's picture wins.
# It never touches the stock LG home app.

APP_ID=io.github.marianovale.lgtv
ELEVATE=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service
# Seconds to wait after a wake; the tests set them to 0.
WAKE_SETTLE=${MINHA_TV_WAKE_SETTLE:-1}
WAKE_RECHECK=${MINHA_TV_WAKE_RECHECK:-3}

# One luna call. stdin from /dev/null so it never eats the power-event
# stream that detect_wakes reads.
ls1() {
  luna-send -n 1 "$@" </dev/null 2>/dev/null
}

foreground() {
  ls1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' \
    | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p'
}

open_app() {
  ls1 luna://com.webos.applicationManager/launch "{\"id\":\"$APP_ID\"}" >/dev/null
}

# Waits up to $1 seconds for some app to be in front.
wait_foreground() {
  i=0
  while [ "$i" -lt "$1" ]; do
    [ -n "$(foreground)" ] && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# $1 is the powerOnReason the TV reported (e.g. "remoteKey").
wants_home() {
  case "$1" in
    *[Cc][Ee][Cc]* | *[Hh][Dd][Mm][Ii]* | *[Ss][Ii][Mm][Pp][Ll][Ii][Nn][Kk]*) return 1 ;;
  esac
  ls1 luna://com.webos.settingsservice/getSystemSettings '{"category":"general","key":"homeAutoLaunch"}' \
    | grep -q '"homeAutoLaunch": *"on"' || return 1
  ls1 luna://com.webos.settingsservice/getSystemSettings '{"category":"general","key":"defaultApps"}' \
    | grep -q "\"home\": *\"$APP_ID\""
}

# The TV restores the last input about two seconds after waking (seen on a
# UM7520: Active at :31, input in front at :33). Open Minha TV after that,
# and once more if the input still won.
open_after_wake() {
  wait_foreground 15
  sleep "$WAKE_SETTLE"
  open_app
  sleep "$WAKE_RECHECK"
  [ "$(foreground)" = "$APP_ID" ] || open_app
}

on_wake() {
  if wants_home "$1"; then open_after_wake; fi
}

# Reads tvpower getPowerState events on stdin and calls on_wake with the
# power-on reason each time the TV goes from standby/suspend back to Active.
detect_wakes() {
  asleep=no
  reason=
  while read -r line; do
    r=$(printf '%s\n' "$line" | sed -n 's/.*"powerOnReason": *"\([^"]*\)".*/\1/p')
    [ -n "$r" ] && reason=$r
    state=$(printf '%s\n' "$line" | sed -n 's/.*"state": *"\([^"]*\)".*/\1/p')
    case "$state" in
      "Active Standby" | Suspend) asleep=yes ;;
      Active)
        if [ "$asleep" = yes ]; then
          on_wake "$reason"
          asleep=no
          reason=
        fi
        ;;
    esac
  done
}

watch_power() {
  while true; do
    luna-send -i luna://com.webos.service.tvpower/power/getPowerState '{"subscribe":true}' </dev/null 2>/dev/null \
      | detect_wakes
    sleep 5 # the subscription ended (e.g. the service restarted): subscribe again
  done
}

# The tests load the functions above without starting anything.
if [ "${MINHA_TV_SOURCE_ONLY:-}" = 1 ]; then
  return 0 2>/dev/null || exit 0
fi

(
  if [ -x "$ELEVATE" ]; then
    "$ELEVATE" "$APP_ID.service" >/dev/null 2>&1
  fi
  wait_foreground 90
  open_app
  watch_power
) </dev/null >/dev/null 2>&1 &
