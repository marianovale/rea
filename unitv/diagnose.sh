#!/usr/bin/env bash
# Read-only health report for an Android TV box reachable over adb.
# Nothing on the device is changed. Usage:
#   ./diagnose.sh 192.168.0.50          # connects over the network
#   ./diagnose.sh                       # uses the only connected device
set -u

ADB="${ADB:-adb}"
target=()

if [ "$#" -ge 1 ]; then
  host="$1"
  case "$host" in *:*) ;; *) host="$host:5555" ;; esac
  "$ADB" connect "$host" >/dev/null 2>&1
  target=(-s "$host")
fi

if ! "$ADB" ${target[@]+"${target[@]}"} get-state >/dev/null 2>&1; then
  echo "Could not reach the device. Check that network debugging is on and" >&2
  echo "accept the authorization prompt on the TV, then run this again." >&2
  exit 1
fi

out="unitv-diagnostico-$(date +%Y%m%d-%H%M%S).txt"

sh_on() { "$ADB" ${target[@]+"${target[@]}"} shell "$1" 2>&1 | tr -d '\r'; }

section() {
  printf '\n===== %s =====\n' "$1"
  sh_on "$2"
}

{
  echo "UniTV diagnostic report — $(date)"

  section "Device" 'for p in ro.product.manufacturer ro.product.brand ro.product.model ro.product.device ro.board.platform ro.hardware ro.build.version.release ro.build.version.sdk ro.build.display.id ro.build.fingerprint ro.product.cpu.abi; do echo "$p=$(getprop $p)"; done'
  section "Uptime and load" 'uptime; cat /proc/loadavg'
  section "CPU" 'grep -E "^(processor|Hardware|model name)" /proc/cpuinfo | sort | uniq -c; for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq; do echo "$f: $(cat $f 2>/dev/null)"; done'
  section "Temperature" 'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type 2>/dev/null): $(cat $z/temp 2>/dev/null)"; done'
  section "Memory" 'head -n 8 /proc/meminfo'
  section "Memory by process (top)" 'dumpsys meminfo | sed -n "/Total PSS by process/,/Total PSS by OOM/p" | head -n 40'
  section "Top processes" '(top -b -n 1 2>/dev/null || top -n 1 -m 20) | head -n 30'
  section "CPU usage since boot" 'dumpsys cpuinfo | head -n 30'
  section "Storage" 'df -h /data /system /cache 2>/dev/null || df /data'
  section "Animation scales" 'for k in window_animation_scale transition_animation_scale animator_duration_scale; do echo "$k=$(settings get global $k)"; done'
  section "Current launcher (HOME)" 'cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME 2>/dev/null || pm resolve-activity -a android.intent.action.MAIN -c android.intent.category.HOME'
  section "Installed apps (user)" 'pm list packages -3 -i'
  section "Disabled apps" 'pm list packages -d'
  section "System app count" 'pm list packages -s | wc -l'
  section "Apps that start on boot" 'cmd package query-receivers --brief -a android.intent.action.BOOT_COMPLETED 2>/dev/null | grep "/" | sed "s#/.*##" | sort -u'
  section "Running services" 'dumpsys activity services | grep -E "ServiceRecord\{" | sed -E "s/.* ([a-zA-Z0-9_.]+)\/.*/\1/" | sort | uniq -c | sort -rn | head -n 40'
  section "Recent crashes and ANRs" 'dumpsys dropbox 2>/dev/null | grep -E "^[0-9-]+ [0-9:]+ (data_app_crash|data_app_anr|system_app_crash|system_app_anr|SYSTEM_TOMBSTONE)" | tail -n 30'
  section "Network" 'ip -4 addr show 2>/dev/null | grep inet; getprop net.dns1; getprop net.dns2'
} >"$out"

echo "Report saved to $out"
