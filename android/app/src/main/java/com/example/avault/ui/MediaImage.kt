package com.example.avault.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.example.avault.data.Pairing

@Composable
fun AuthenticatedMediaImage(url: String?, pairing: Pairing, description: String, modifier: Modifier = Modifier, alignment: Alignment = Alignment.Center) {
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        Icon(Icons.Default.Movie, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .45f))
        if (url != null) AsyncImage(
            model = ImageRequest.Builder(androidx.compose.ui.platform.LocalContext.current)
                .data(if (url.startsWith("http")) url else pairing.baseUrl.trimEnd('/') + url)
                .addHeader("Authorization", "Bearer ${pairing.token}")
                .crossfade(true)
                .build(),
            contentDescription = description,
            modifier = Modifier.fillMaxSize(),
            contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            alignment = alignment
        )
    }
}
