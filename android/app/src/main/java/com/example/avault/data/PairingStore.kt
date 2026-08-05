package com.example.avault.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class PairingRequest(val serverId: String, val baseUrl: String, val nonce: String)

class PairingStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(context, "avault.secure", MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(), EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    fun get(): Pairing? { val id = preferences.getString("serverId", null) ?: return null; val url = preferences.getString("baseUrl", null) ?: return null; val token = preferences.getString("token", null) ?: return null; return Pairing(id, url, token) }
    fun save(pairing: Pairing) { preferences.edit().putString("serverId", pairing.serverId).putString("baseUrl", pairing.baseUrl.trimEnd('/')).putString("token", pairing.token).apply() }
    fun clear() { preferences.edit().clear().apply() }
}

fun pairFromQr(payload: String, deviceName: String): Pairing {
    val request = parsePairingPayload(payload)
    val connection = URL("${request.baseUrl}/api/v1/pair").openConnection() as HttpURLConnection
    connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
    connection.outputStream.use { it.write(JSONObject().put("nonce", request.nonce).put("deviceName", deviceName).toString().toByteArray()) }
    val response = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
    val result = JSONObject(response?.bufferedReader()?.readText().orEmpty())
    if (connection.responseCode !in 200..299) throw IllegalStateException(result.optString("error", "配对失败"))
    require(result.getString("serverId") == request.serverId) { "配对服务器身份不匹配" }
    return Pairing(request.serverId, request.baseUrl, result.getString("token"))
}

fun parsePairingPayload(payload: String, now: java.time.Instant = java.time.Instant.now()): PairingRequest {
    val qr = JSONObject(payload)
    require(qr.getInt("version") == 1) { "不支持的配对二维码" }
    val serverId = qr.getString("serverId").trim()
    val host = qr.getString("host").trim()
    val port = qr.getInt("port")
    val nonce = qr.getString("nonce").trim()
    require(serverId.isNotEmpty() && host.isNotEmpty() && nonce.length >= 16 && port in 1..65535) { "配对二维码内容无效" }
    require(java.time.Instant.parse(qr.getString("expiresAt")).isAfter(now)) { "配对二维码已失效" }
    return PairingRequest(serverId, "http://$host:$port", nonce)
}
