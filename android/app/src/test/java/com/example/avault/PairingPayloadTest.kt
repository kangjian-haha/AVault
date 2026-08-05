package com.example.avault

import com.example.avault.data.parsePairingPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.Instant

class PairingPayloadTest {
    @Test fun parsesValidUnexpiredPayload() {
        val request = parsePairingPayload("""{"version":1,"serverId":"server-1","host":"192.168.1.8","port":42831,"nonce":"1234567890abcdef","expiresAt":"2026-08-03T00:00:00Z"}""", Instant.parse("2026-08-02T00:00:00Z"))
        assertEquals("http://192.168.1.8:42831", request.baseUrl)
    }

    @Test fun rejectsExpiredOrUnsupportedPayload() {
        assertThrows(IllegalArgumentException::class.java) { parsePairingPayload("""{"version":1,"serverId":"server-1","host":"192.168.1.8","port":42831,"nonce":"1234567890abcdef","expiresAt":"2026-08-01T00:00:00Z"}""", Instant.parse("2026-08-02T00:00:00Z")) }
        assertThrows(IllegalArgumentException::class.java) { parsePairingPayload("""{"version":2,"serverId":"server-1","host":"192.168.1.8","port":42831,"nonce":"1234567890abcdef","expiresAt":"2026-08-03T00:00:00Z"}""") }
    }
}
