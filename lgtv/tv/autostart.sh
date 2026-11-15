#!/bin/sh
# Homebrew Channel runs the scripts in /var/lib/webosbrew/init.d/ at boot.
# install.sh copies this one there only with --autostart. It re-applies root
# to the service and opens Minha TV once the TV's own UI is up.
# It never touches the stock LG home app.

APP_ID=io.github.marianovale.lgtv
ELEVATE=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service

(
  if [ -x "$ELEVATE" ]; then
    "$ELEVATE" "$APP_ID.service" >/dev/null 2>&1
  fi

  # Wait up to 90 s for something to be in the foreground (the stock UI).
  i=0
  while [ "$i" -lt 90 ]; do
    if luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null \
        | grep -qE '"appId": ?"[^"]'; then
      break
    fi
    sleep 1
    i=$((i + 1))
  done

  luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1
) </dev/null >/dev/null 2>&1 &
