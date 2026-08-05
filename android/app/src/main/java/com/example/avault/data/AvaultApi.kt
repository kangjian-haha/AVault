package com.example.avault.data

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.io.IOException

data class Pairing(val serverId: String, val baseUrl: String, val token: String)
data class MediaInfo(val videoCodec: String?, val container: String?)
data class RemoteFile(val id: String, val name: String, val versionLabel: String?, val available: Boolean, val mediaInfo: MediaInfo?)
data class RemoteMovie(val id: String, val code: String?, val title: String, val description: String, val releaseDate: String?, val durationMinutes: Int?, val actors: List<String>, val tags: List<String>, val coverUrl: String?, val watchStatus: String, val progressSeconds: Long, val files: List<RemoteFile>)
data class Page(val items: List<RemoteMovie>, val page: Int, val total: Int)
data class Actor(val name: String, val avatarUrl: String?, val category: String?, val aliases: List<String>, val socialLinks: List<SocialLink>)
data class SocialLink(val platform: String, val url: String)
data class Tag(val name: String, val movieCount: Int)

class UnauthorizedException : IllegalStateException("设备未配对或授权已撤销")
class ServerUnavailableException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)

class AvaultApi(private val pairing: Pairing) {
    private fun url(path: String) = URL(pairing.baseUrl.trimEnd('/') + path)
    private fun open(path: String, method: String = "GET", authenticated: Boolean = true): HttpURLConnection = (url(path).openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 8_000
        readTimeout = 15_000
        if (authenticated) setRequestProperty("Authorization", "Bearer ${pairing.token}")
    }
    private fun <T> networkRequest(block: () -> T): T = try {
        block()
    } catch (error: UnauthorizedException) {
        throw error
    } catch (error: SocketTimeoutException) {
        throw ServerUnavailableException("连接电脑超时，请确认电脑已打开 AVault 且位于同一局域网", error)
    } catch (error: IOException) {
        throw ServerUnavailableException("无法连接电脑，请检查 AVault 是否运行及网络连接", error)
    }
    private fun request(path: String, method: String = "GET", body: JSONObject? = null, authenticated: Boolean = true): JSONObject = networkRequest {
        val connection = open(path, method, authenticated)
        try {
            if (body != null) { connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json"); connection.outputStream.use { it.write(body.toString().toByteArray()) } }
            if (connection.responseCode == 401 || connection.responseCode == 403) throw UnauthorizedException()
            val text = (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.readText().orEmpty()
            if (connection.responseCode !in 200..299) throw IllegalStateException(JSONObject(text.ifBlank { "{}" }).optString("error", "服务器返回 HTTP ${connection.responseCode}"))
            JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }
    fun health(): String = request("/api/v1/health", authenticated = false).getString("serverId")
    fun movies(page: Int = 1, query: String = "", status: String? = null, sourcePartition: String? = null, sort: String = "added-desc", actor: String? = null, tag: String? = null): Page {
        val parameters = listOf("page=$page", "pageSize=30", "q=${enc(query)}", "sort=$sort") + listOfNotNull(status?.let { "status=$it" }, sourcePartition?.let { "sourcePartition=$it" }, actor?.let { "actor=${enc(it)}" }, tag?.let { "tag=${enc(it)}" })
        val root = request("/api/v1/movies?${parameters.joinToString("&")}")
        val items = root.getJSONArray("items").toObjects { parseMovie(it as JSONObject) }
        return Page(items, root.getInt("page"), root.getInt("total"))
    }
    fun movie(id: String) = parseMovie(request("/api/v1/movies/${enc(id)}"))
    fun actors(): List<Actor> = requestArray("/api/v1/actors").toObjects { parseActor(it as JSONObject) }
    fun actor(name: String): Actor = parseActor(request("/api/v1/actors/${enc(name)}"))
    fun tags(): List<Tag> = requestArray("/api/v1/tags").toObjects { value -> val item = value as JSONObject; Tag(item.getString("name"), item.getInt("movieCount")) }
    fun updateProgress(id: String, position: Long, duration: Long, status: String) { request("/api/v1/movies/${enc(id)}/progress", "PUT", JSONObject().put("progressSeconds", position / 1000.0).put("durationSeconds", duration / 1000.0).put("status", status)) }
    fun absolute(path: String?) = path?.let { if (it.startsWith("http")) it else pairing.baseUrl.trimEnd('/') + it }
    private fun requestArray(path: String): JSONArray = networkRequest {
        val connection = open(path)
        try {
            if (connection.responseCode == 401 || connection.responseCode == 403) throw UnauthorizedException()
            if (connection.responseCode !in 200..299) throw IllegalStateException("服务器返回 HTTP ${connection.responseCode}")
            JSONArray(connection.inputStream.bufferedReader().readText())
        } finally {
            connection.disconnect()
        }
    }
    private fun parseMovie(value: JSONObject): RemoteMovie = RemoteMovie(value.getString("id"), value.optString("code").ifBlank { null }, value.optString("title"), value.optString("description"), value.optString("releaseDate").ifBlank { null }, value.optInt("durationMinutes").takeIf { value.has("durationMinutes") }, value.optJSONArray("actors").strings(), value.optJSONArray("tags").strings(), value.optString("coverUrl").ifBlank { null }, value.optString("watchStatus", "unwatched"), value.optLong("progressSeconds"), value.getJSONArray("files").toObjects { raw -> val file = raw as JSONObject; val info = file.optJSONObject("mediaInfo"); RemoteFile(file.getString("id"), file.getString("name"), file.optionalString("versionLabel"), file.optBoolean("available"), info?.let { MediaInfo(it.optString("videoCodec").ifBlank { null }, it.optString("container").ifBlank { null }) }) })
    private fun parseActor(value: JSONObject) = Actor(value.getString("name"), value.optString("avatarUrl").ifBlank { null }, value.optString("category").ifBlank { null }, value.optJSONArray("aliases").strings(), value.optJSONArray("socialLinks").toObjects { raw -> val link = raw as JSONObject; SocialLink(link.getString("platform"), link.getString("url")) })
    private fun enc(value: String) = java.net.URLEncoder.encode(value, "UTF-8")
}
private fun JSONArray?.strings() = this?.toObjects { it as String } ?: emptyList()
private fun <T> JSONArray?.toObjects(map: (Any) -> T): List<T> = if (this == null) emptyList() else (0 until length()).map { map(get(it)) }
private fun JSONObject.optionalString(name: String): String? = if (!has(name) || isNull(name)) null else optString(name).takeUnless { it.isBlank() || it.equals("null", ignoreCase = true) }
