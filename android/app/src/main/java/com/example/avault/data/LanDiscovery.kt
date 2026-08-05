package com.example.avault.data

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

suspend fun discoverServer(context: Context, serverId: String): Pairing? = suspendCancellableCoroutine { continuation ->
    val manager = context.getSystemService(NsdManager::class.java)
    lateinit var listener: NsdManager.DiscoveryListener
    listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) = Unit
        override fun onDiscoveryStopped(serviceType: String) = Unit
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { if (continuation.isActive) continuation.resume(null) }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
        override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
            if (serviceInfo.serviceType != "_avault._tcp.") return
            manager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
                override fun onServiceResolved(resolved: NsdServiceInfo) {
                    val advertisedId = resolved.attributes["serverId"]?.toString(Charsets.UTF_8)
                    if (advertisedId != serverId || !continuation.isActive) return
                    val host = resolved.host?.hostAddress ?: return
                    runCatching { manager.stopServiceDiscovery(listener) }
                    continuation.resume(Pairing(serverId, "http://$host:${resolved.port}", ""))
                }
            })
        }
    }
    manager.discoverServices("_avault._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
    continuation.invokeOnCancellation { runCatching { manager.stopServiceDiscovery(listener) } }
}
