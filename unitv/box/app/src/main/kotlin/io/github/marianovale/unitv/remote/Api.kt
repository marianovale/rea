package io.github.marianovale.unitv.remote

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.security.MessageDigest

// The same HTTP API as unitv/remote/server.mjs, so the same phone page works
// against either server. Every /api call needs the per-install token.
class Api(
    private val device: Device,
    private val token: () -> String,
    private val html: () -> ByteArray,
) {
    class Response(val status: Int, val contentType: String, val body: ByteArray)

    private val routes: Map<String, (JSONObject) -> Any> = mapOf(
        "GET /api/status" to { _ -> JSONObject(device.status()) },
        "GET /api/apps" to { _ -> JSONObject().put("apps", JSONArray(device.apps())) },
        // The box always drives itself; this just restarts its adb session.
        "POST /api/connect" to { _ -> JSONObject().put("message", device.reconnect()) },
        "POST /api/key" to { body -> device.key(body.string("key")); OK },
        "POST /api/text" to { body -> device.text(body.string("text")); OK },
        "POST /api/launch" to { body -> device.launch(body.string("package")); OK },
    )

    fun handle(method: String, path: String, headers: Map<String, String>, body: ByteArray): Response {
        if (method == "GET" && path == "/") {
            return Response(200, "text/html; charset=utf-8", html())
        }
        val route = routes["$method $path"] ?: return json(404, failure("not found"))
        if (!sameToken(headers["x-token"], token())) return json(401, failure("invalid token"))

        val parsed = try {
            if (body.isEmpty()) JSONObject() else JSONObject(String(body, Charsets.UTF_8))
        } catch (_: JSONException) {
            return json(400, failure("invalid JSON"))
        }
        return try {
            json(200, route(parsed))
        } catch (error: IllegalArgumentException) {
            json(400, failure(error.message ?: "invalid request"))
        } catch (error: Exception) {
            json(502, failure(error.message ?: error.javaClass.simpleName))
        }
    }

    private fun json(status: Int, body: Any) =
        Response(status, "application/json; charset=utf-8", body.toString().toByteArray(Charsets.UTF_8))

    private fun failure(message: String) = JSONObject().put("error", message)

    private fun JSONObject.string(name: String): String? = opt(name) as? String

    private companion object {
        val OK = JSONObject().put("ok", true)

        fun sameToken(given: String?, expected: String): Boolean =
            given != null && MessageDigest.isEqual(given.toByteArray(), expected.toByteArray())
    }
}
