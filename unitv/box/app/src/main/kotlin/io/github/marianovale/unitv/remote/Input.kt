package io.github.marianovale.unitv.remote

import java.text.Normalizer

// Friendly button names the phone UI sends, mapped to Android key codes.
// Same table as unitv/remote/adb.mjs, so both servers accept the same page.
val KEYS: Map<String, String> = mapOf(
    "up" to "KEYCODE_DPAD_UP",
    "down" to "KEYCODE_DPAD_DOWN",
    "left" to "KEYCODE_DPAD_LEFT",
    "right" to "KEYCODE_DPAD_RIGHT",
    "ok" to "KEYCODE_DPAD_CENTER",
    "back" to "KEYCODE_BACK",
    "home" to "KEYCODE_HOME",
    "menu" to "KEYCODE_MENU",
    "recents" to "KEYCODE_APP_SWITCH",
    "settings" to "KEYCODE_SETTINGS",
    "search" to "KEYCODE_SEARCH",
    "info" to "KEYCODE_INFO",
    "guide" to "KEYCODE_GUIDE",
    "power" to "KEYCODE_POWER",
    // Screen off and on without toggling, so a voice command cannot invert it.
    "sleep" to "KEYCODE_SLEEP",
    "wakeup" to "KEYCODE_WAKEUP",
    "volup" to "KEYCODE_VOLUME_UP",
    "voldown" to "KEYCODE_VOLUME_DOWN",
    "mute" to "KEYCODE_VOLUME_MUTE",
    "chup" to "KEYCODE_CHANNEL_UP",
    "chdown" to "KEYCODE_CHANNEL_DOWN",
    "playpause" to "KEYCODE_MEDIA_PLAY_PAUSE",
    "rewind" to "KEYCODE_MEDIA_REWIND",
    "forward" to "KEYCODE_MEDIA_FAST_FORWARD",
    "prev" to "KEYCODE_MEDIA_PREVIOUS",
    "next" to "KEYCODE_MEDIA_NEXT",
    "enter" to "KEYCODE_ENTER",
    "del" to "KEYCODE_DEL",
)

private val PACKAGE_RE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")
private const val MAX_TEXT = 200

fun isValidPackage(name: String?): Boolean =
    name != null && name.length <= 255 && PACKAGE_RE.matches(name)

// `input text` only types ASCII, so accents are stripped first.
private fun toAsciiText(text: String?): String {
    requireNotNull(text) { "text must be a string" }
    val ascii = Normalizer.normalize(text, Normalizer.Form.NFD)
        .replace(Regex("[\\u0300-\\u036f]"), "")
        .replace(Regex("[^\\x20-\\x7e]"), "")
        .take(MAX_TEXT)
    require(ascii.isNotBlank()) { "text is empty" }
    return ascii
}

// The command runs in the box's shell, so the text is single-quoted for it.
// `input text` reads "%s" as a space.
fun toInputTextCommand(text: String?): String {
    val quoted = toAsciiText(text).replace(" ", "%s").replace("'", "'\\''")
    return "input text '$quoted'"
}

// Monkey's `type` takes one space-free word per command and its parser
// treats quotes specially, so words are sent one by one with SPACE presses
// between them, and text with quotes or backslashes returns null so the
// caller uses `input text` instead.
fun toMonkeyTypeCommands(text: String?): List<String>? {
    val ascii = toAsciiText(text)
    if (ascii.any { it == '"' || it == '\'' || it == '\\' }) return null
    val commands = mutableListOf<String>()
    ascii.split(" ").forEachIndexed { index, word ->
        if (index > 0) commands += "press KEYCODE_SPACE"
        if (word.isNotEmpty()) commands += "type $word"
    }
    return commands
}

// Collects package names from `cmd package query-activities` output, which
// lists components as "pkg/.Activity" or as "packageName=pkg" lines.
fun parseActivityPackages(output: String): List<String> {
    val found = sortedSetOf<String>()
    Regex("([A-Za-z]\\w*(?:\\.\\w+)+)/[\\w.$]+").findAll(output)
        .forEach { found += it.groupValues[1] }
    Regex("packageName=([\\w.]+)").findAll(output)
        .forEach { found += it.groupValues[1] }
    return found.filter(::isValidPackage)
}

fun parsePackageList(output: String): List<String> =
    output.lines()
        .map { it.trim().removePrefix("package:") }
        .filter(::isValidPackage)
        .sorted()
