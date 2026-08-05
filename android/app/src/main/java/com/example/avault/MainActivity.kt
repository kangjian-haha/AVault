package com.example.avault

import android.Manifest
import android.app.Activity
import android.media.AudioManager
import android.content.pm.PackageManager
import android.content.pm.ActivityInfo
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.activity.compose.BackHandler
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CollectionsBookmark
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.ViewList
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.media3.common.MediaItem
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.example.avault.data.*
import com.example.avault.ui.QrScanner
import com.example.avault.ui.AuthenticatedMediaImage
import com.example.avault.ui.theme.AVaultTheme
import kotlinx.coroutines.*
import org.json.JSONArray
import kotlin.math.abs
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); enableEdgeToEdge(); setContent { AVaultTheme(darkTheme = true, dynamicColor = false) { AVaultApp() } } }
}

private fun RemoteFile.displayLabel(movieCode: String? = null): String {
    val primaryLabel = movieCode?.takeIf { it.isNotBlank() }
        ?: name.substringAfterLast('@').substringBeforeLast('.').ifBlank { "本地版本" }
    return listOfNotNull(primaryLabel, versionLabel?.takeIf { it.isNotBlank() }).joinToString(" · ")
}
private fun watchStatusLabel(status: String) = when (status) { "watching" -> "观看中"; "watched" -> "已看完"; else -> "未观看" }

@Composable private fun AVaultApp() {
    val context = LocalContext.current; val store = remember { PairingStore(context) }; val scope = rememberCoroutineScope()
    var pairing by remember { mutableStateOf(store.get()) }; var screen by remember { mutableStateOf("library") }; var searching by remember { mutableStateOf(false) }; var selected by remember { mutableStateOf<RemoteMovie?>(null) }; var playing by remember { mutableStateOf(false) }; var playFileId by remember { mutableStateOf<String?>(null) }; var related by remember { mutableStateOf<Pair<String, String>?>(null) }; var error by remember { mutableStateOf<String?>(null) }
    fun connect() = scope.launch { val current = pairing ?: return@launch; try { withContext(Dispatchers.IO) { check(AvaultApi(current).health() == current.serverId) }; error = null } catch (e: UnauthorizedException) { store.clear(); pairing = null } catch (_: Exception) { val found = withContext(Dispatchers.IO) { withTimeoutOrNull(6_000) { discoverServer(context, current.serverId) } }; if (found != null) { val updated = found.copy(token = current.token); try { withContext(Dispatchers.IO) { check(AvaultApi(updated).health() == updated.serverId) }; store.save(updated); pairing = updated; error = null } catch (e: Exception) { error = e.message ?: "电脑离线" } } else error = "无法连接电脑，请确认位于同一局域网" } }
    fun openMovie(summary: RemoteMovie) = scope.launch {
        val current = pairing ?: return@launch
        selected = try {
            withContext(Dispatchers.IO) { AvaultApi(current).movie(summary.id) }
        } catch (e: UnauthorizedException) {
            store.clear()
            pairing = null
            null
        } catch (_: Exception) {
            // The library card remains usable when a refresh temporarily fails.
            summary
        }
    }
    LaunchedEffect(pairing) { if (pairing != null) connect() }
    BackHandler(enabled = pairing != null && (playing || selected != null || related != null || searching)) { when { playing -> playing = false; selected != null -> selected = null; related != null -> related = null; searching -> searching = false } }
    if (pairing == null) ConnectPage(onPaired = { store.save(it); pairing = it }, error = error) else Box(Modifier.fillMaxSize()) {
        val tabs = remember { listOf("library", "actors", "settings") }
        val pagerState = rememberPagerState(initialPage = tabs.indexOf(screen).coerceAtLeast(0), pageCount = { tabs.size })
        LaunchedEffect(screen) { val target = tabs.indexOf(screen); if (target >= 0 && pagerState.currentPage != target) pagerState.animateScrollToPage(target) }
        LaunchedEffect(pagerState.currentPage) { screen = tabs[pagerState.currentPage] }
        Scaffold(bottomBar = {
            // Reserve the system gesture area separately so labels never sit beneath the handle.
            val navigationInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
            NavigationBar(modifier = Modifier.height(64.dp + navigationInset), windowInsets = WindowInsets.navigationBars) {
                listOf("library" to "媒体库", "actors" to "演员库", "settings" to "设置").forEach { (id, label) ->
                    NavigationBarItem(
                        selected = screen == id,
                        onClick = { screen = id },
                        icon = { when (id) { "library" -> Icon(Icons.Default.CollectionsBookmark, label); "actors" -> Icon(Icons.Default.Person, label); else -> Icon(Icons.Default.Settings, label) } },
                        label = { Text(label) },
                        alwaysShowLabel = true
                    )
                }
            }
        }) { padding ->
            HorizontalPager(state = pagerState, modifier = Modifier.padding(padding), beyondViewportPageCount = 2) { page -> when (tabs[page]) { "library" -> LibraryPage(pairing!!, ::openMovie, { store.clear(); pairing = null }, Modifier.fillMaxSize(), onSearch = { searching = true }); "actors" -> ActorLibraryPage(pairing!!, { related = "actor" to it }, { store.clear(); pairing = null }, Modifier.fillMaxSize()); else -> SettingsPage(pairing!!, error, { connect() }, { store.clear(); pairing = null }, Modifier.fillMaxSize()) } }
        }
        if (searching) Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { SearchPage(pairing!!, { searching = false }, ::openMovie, { store.clear(); pairing = null }) }
        when { selected != null && playing -> Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { PlayerPage(selected!!, pairing!!, playFileId, onBack = { playing = false }, onUnauthorized = { store.clear(); pairing = null }) }
            selected != null -> MovieDetailPage(selected!!, pairing!!, onBack = { selected = null }, onPlay = { playFileId = it.id; playing = true }, onActor = { selected = null; related = "actor" to it }, onTag = { selected = null; related = "tag" to it }, onWatchStatusChange = { status -> selected = selected?.copy(watchStatus = status) })
            related != null -> Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { RelatedMoviesPage(pairing!!, related!!.first, related!!.second, { related = null; openMovie(it) }, { related = null }, { store.clear(); pairing = null }) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MovieDetailPage(movie: RemoteMovie, pairing: Pairing, onBack: () -> Unit, onPlay: (RemoteFile) -> Unit, onActor: (String) -> Unit, onTag: (String) -> Unit, onWatchStatusChange: (String) -> Unit) = Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
    val visibleTags = movie.tags.filterNot { it in movie.actors }.distinct()
    val scope = rememberCoroutineScope()
    var watchStatus by remember(movie.id, movie.watchStatus) { mutableStateOf(movie.watchStatus) }
    var watchStatusExpanded by remember { mutableStateOf(false) }
    var updatingWatchStatus by remember { mutableStateOf(false) }
    var watchStatusError by remember { mutableStateOf<String?>(null) }
    fun updateWatchStatus(next: String) {
        if (next == watchStatus || updatingWatchStatus) return
        val previous = watchStatus
        watchStatus = next
        onWatchStatusChange(next)
        updatingWatchStatus = true
        watchStatusError = null
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                AvaultApi(pairing).updateProgress(
                    movie.id,
                    movie.progressSeconds * 1_000,
                    (movie.durationMinutes?.toLong() ?: 0L) * 60_000,
                    next
                )
            } catch (error: Exception) {
                withContext(Dispatchers.Main.immediate) {
                    if (watchStatus == next) {
                        watchStatus = previous
                        onWatchStatusChange(previous)
                        watchStatusError = error.message ?: "观看状态更新失败"
                    }
                }
            } finally {
                withContext(Dispatchers.Main.immediate) { updatingWatchStatus = false }
            }
        }
    }
    Column(
        Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        AuthenticatedMediaImage(movie.coverUrl, pairing, movie.title, Modifier.fillMaxWidth().height(220.dp))
        Text(movie.title, style = MaterialTheme.typography.titleLarge)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            movie.code?.let { Text("番号：$it", style = MaterialTheme.typography.bodyLarge) }
            Box {
                OutlinedButton(onClick = { watchStatusExpanded = true }, enabled = !updatingWatchStatus, modifier = Modifier.height(36.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)) { Text(watchStatusLabel(watchStatus)); Spacer(Modifier.width(4.dp)); Icon(Icons.Default.KeyboardArrowDown, null, modifier = Modifier.size(16.dp)) }
                DropdownMenu(expanded = watchStatusExpanded, onDismissRequest = { watchStatusExpanded = false }) {
                    listOf("unwatched", "watching", "watched").forEach { value ->
                        DropdownMenuItem(text = { Text(watchStatusLabel(value)) }, leadingIcon = { if (watchStatus == value) Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp)) }, onClick = { watchStatusExpanded = false; updateWatchStatus(value) })
                    }
                }
            }
        }
        watchStatusError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        movie.releaseDate?.let { Text("发行日期：$it", style = MaterialTheme.typography.bodyLarge) }
        movie.durationMinutes?.let { Text("时长：$it 分钟", style = MaterialTheme.typography.bodyLarge) }
        if (movie.actors.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Text("演员", style = MaterialTheme.typography.titleMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                movie.actors.distinct().forEach { actor -> AssistChip(modifier = Modifier.height(30.dp), onClick = { onActor(actor) }, label = { Text(actor) }) }
            }
        }
        if (visibleTags.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Text("标签", style = MaterialTheme.typography.titleMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                visibleTags.forEach { tag -> AssistChip(modifier = Modifier.height(30.dp), onClick = { onTag(tag) }, label = { Text(tag) }) }
            }
        }
        if (movie.description.isNotBlank()) Text(movie.description, style = MaterialTheme.typography.bodyMedium)
        Text("选择播放版本", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
        movie.files.filter { it.available }.forEach { file -> Button(onClick = { onPlay(file) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(8.dp)); Column { Text(file.displayLabel(movie.code)); file.mediaInfo?.let { Text(listOfNotNull(it.videoCodec, it.container).joinToString(" · "), style = MaterialTheme.typography.labelSmall) } } } }
        if (movie.files.none { it.available }) Text("没有可播放的本地版本", color = MaterialTheme.colorScheme.error)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun RelatedMoviesPage(pairing: Pairing, kind: String, name: String, onOpen: (RemoteMovie) -> Unit, onBack: () -> Unit, onUnauthorized: () -> Unit) {
    val context = LocalContext.current
    var movies by remember { mutableStateOf<List<RemoteMovie>>(emptyList()) }
    var actor by remember { mutableStateOf<Actor?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(kind, name) {
        try {
            val api = AvaultApi(pairing)
            movies = withContext(Dispatchers.IO) { if (kind == "actor") api.movies(actor = name).items else api.movies(tag = name).items }
            if (kind == "actor") actor = withContext(Dispatchers.IO) { api.actor(name) }
        } catch (e: UnauthorizedException) { onUnauthorized() } catch (e: Exception) { error = e.message }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (kind == "actor") {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                AuthenticatedMediaImage(actor?.avatarUrl, pairing, name, Modifier.size(88.dp))
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(name, style = MaterialTheme.typography.headlineSmall)
                    actor?.category?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    actor?.aliases?.takeIf { it.isNotEmpty() }?.let { Text("别名：${it.joinToString(" · ")}", style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
                }
            }
            actor?.socialLinks?.distinctBy { it.platform.trim().lowercase() }?.takeIf { it.isNotEmpty() }?.let { links ->
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    links.forEach { link -> AssistChip(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link.url))) }, label = { Text("${link.platform} ↗") }) }
                }
            }
            Text("作品（${movies.size}）", style = MaterialTheme.typography.titleMedium)
        } else Text("标签：$name", style = MaterialTheme.typography.headlineSmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(movies, key = { it.id }) { movie ->
                Card(Modifier.fillMaxWidth().clickable { onOpen(movie) }) {
                    Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AuthenticatedMediaImage(movie.coverUrl, pairing, movie.title, Modifier.width(128.dp).aspectRatio(840f / 568f))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(movie.code ?: "未识别", style = MaterialTheme.typography.titleMedium)
                            Text(movie.title, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun ConnectPage(onPaired: (Pairing) -> Unit, error: String?) {
    val context = LocalContext.current; var cameraAllowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }; var busy by remember { mutableStateOf(false) }; var message by remember { mutableStateOf<String?>(error) }; var debugPayload by remember { mutableStateOf("") }
    val permission = androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { cameraAllowed = it; if (!it) message = "需要相机权限才能扫描配对二维码" }
    fun pair(payload: String) { if (busy) return; busy = true; CoroutineScope(Dispatchers.Main).launch { try { onPaired(withContext(Dispatchers.IO) { pairFromQr(payload, Build.MODEL) }) } catch (e: Exception) { message = e.message ?: "配对失败" } finally { busy = false } } }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { Text("连接 AVault", style = MaterialTheme.typography.headlineMedium); Text("扫描电脑端“连接手机”页面生成的二维码。")
        if (cameraAllowed) QrScanner(::pair, { message = it }, Modifier.fillMaxWidth().weight(1f)) else Button(onClick = { permission.launch(Manifest.permission.CAMERA) }, Modifier.fillMaxWidth()) { Text("允许相机并扫码") }
        if (BuildConfig.DEBUG) { OutlinedTextField(debugPayload, { debugPayload = it }, label = { Text("调试：配对 JSON") }, modifier = Modifier.fillMaxWidth(), minLines = 2); TextButton(onClick = { pair(debugPayload) }) { Text("使用调试配对信息") } }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth()); message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable private fun ActorLibraryPage(pairing: Pairing, onOpen: (String) -> Unit, onUnauthorized: () -> Unit, modifier: Modifier) {
    val scope = rememberCoroutineScope(); var actors by remember { mutableStateOf<List<Actor>>(emptyList()) }; var loading by remember { mutableStateOf(true) }; var error by remember { mutableStateOf<String?>(null) }
    fun load() = scope.launch { loading = true; try { actors = withContext(Dispatchers.IO) { AvaultApi(pairing).actors() }; error = null } catch (e: UnauthorizedException) { onUnauthorized() } catch (e: Exception) { error = e.message } finally { loading = false } }
    LaunchedEffect(pairing) { load() }
    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text("演员库", style = MaterialTheme.typography.titleLarge)
            IconButton(modifier = Modifier.size(36.dp), onClick = { load() }) { Icon(Icons.Default.Refresh, "刷新") }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
        LazyVerticalGrid(GridCells.Fixed(3), Modifier.fillMaxSize().padding(start = 10.dp, top = 4.dp, end = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            gridItems(actors, key = { it.name }) { actor ->
                Card(Modifier.fillMaxWidth().clickable { onOpen(actor.name) }) {
                    Column {
                        AuthenticatedMediaImage(actor.avatarUrl, pairing, actor.name, Modifier.fillMaxWidth().aspectRatio(1f))
                        Text(actor.name, modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun SearchPage(pairing: Pairing, onClose: () -> Unit, onOpen: (RemoteMovie) -> Unit, onUnauthorized: () -> Unit) {
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    val preferences = remember { context.getSharedPreferences("avault-search-history", android.content.Context.MODE_PRIVATE) }
    val uiPreferences = remember { context.getSharedPreferences("avault-ui", android.content.Context.MODE_PRIVATE) }
    val scope = rememberCoroutineScope()
    var query by rememberSaveable { mutableStateOf("") }
    var submitted by rememberSaveable { mutableStateOf(false) }
    var history by remember { mutableStateOf(readSearchHistory(preferences)) }
    var movies by remember { mutableStateOf<List<RemoteMovie>>(emptyList()) }
    var page by remember { mutableIntStateOf(1) }
    var total by remember { mutableIntStateOf(0) }
    var sort by rememberSaveable { mutableStateOf("added-desc") }
    var status by rememberSaveable { mutableStateOf<String?>(null) }
    var sourcePartition by rememberSaveable { mutableStateOf<String?>(uiPreferences.getString("movieSourcePartition", null)) }
    val grid = remember { uiPreferences.getBoolean("movieGrid", true) }
    val gridState = rememberSaveable(saver = LazyGridState.Saver) { LazyGridState() }
    val listState = rememberSaveable(saver = LazyListState.Saver) { LazyListState() }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun saveHistory(value: String) {
        history = (listOf(value) + history.filterNot { it.equals(value, ignoreCase = true) }).take(10)
        val serialized = JSONArray().also { array -> history.forEach(array::put) }.toString()
        preferences.edit().putString("recent", serialized).apply()
    }
    fun request(reset: Boolean = true, queryValue: String = query, sortValue: String = sort, statusValue: String? = status, sourcePartitionValue: String? = sourcePartition) = scope.launch {
        loading = true
        val target = if (reset) 1 else page + 1
        try {
            val result = withContext(Dispatchers.IO) { AvaultApi(pairing).movies(page = target, query = queryValue, status = statusValue, sourcePartition = sourcePartitionValue, sort = sortValue) }
            movies = if (reset) result.items else movies + result.items
            page = result.page
            total = result.total
            error = null
        } catch (e: UnauthorizedException) { onUnauthorized() } catch (e: Exception) { error = e.message } finally { loading = false }
    }
    fun submit(value: String = query) {
        val normalized = value.trim()
        if (normalized.isEmpty()) return
        query = normalized
        submitted = true
        saveHistory(normalized)
        focusManager.clearFocus()
        request(queryValue = normalized)
    }
    fun selectSort(value: String) { sort = value; request(queryValue = query, sortValue = value) }
    fun selectStatus(value: String?) { status = value; request(queryValue = query, statusValue = value) }
    fun selectSourcePartition(value: String?) { sourcePartition = value; uiPreferences.edit().putString("movieSourcePartition", value).apply(); request(queryValue = query, sourcePartitionValue = value) }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            IconButton(modifier = Modifier.size(40.dp), onClick = onClose) { Icon(Icons.Default.ArrowBack, "返回") }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("番号、标题、演员或标签") },
                singleLine = true,
                modifier = Modifier.weight(1f).height(44.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { submit() })
            )
            TextButton(onClick = { submit() }, enabled = query.isNotBlank()) { Text("搜索") }
        }
        if (!submitted) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text("历史搜索", style = MaterialTheme.typography.titleSmall)
                    if (history.isNotEmpty()) IconButton(modifier = Modifier.size(36.dp), onClick = { history = emptyList(); preferences.edit().remove("recent").apply() }) { Icon(Icons.Default.DeleteOutline, "清空历史") }
                }
                if (history.isEmpty()) Text("暂无搜索历史", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { history.forEach { item -> AssistChip(onClick = { submit(item) }, label = { Text(item, maxLines = 1) }) } }
            }
        } else {
            MovieFilterDropdowns(sourcePartition, status, sort, ::selectSourcePartition, ::selectStatus, ::selectSort)
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
            if (!loading && error == null && movies.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) { Text("没有找到相关影片") }
            else if (grid) LazyVerticalGrid(GridCells.Fixed(3), Modifier.fillMaxSize().padding(start = 10.dp, top = 4.dp, end = 10.dp), state = gridState, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                gridItems(movies, key = { it.id }) { movie -> Card(Modifier.fillMaxWidth().clickable { onOpen(movie) }) { Column { AuthenticatedMediaImage(movie.coverUrl, pairing, movie.title, Modifier.fillMaxWidth().aspectRatio(442f / 568f), alignment = androidx.compose.ui.Alignment.CenterEnd); Text(movie.code ?: "未识别", modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) } } }
                if (movies.size < total) item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.fillMaxWidth(), contentAlignment = androidx.compose.ui.Alignment.Center) { OutlinedButton(onClick = { request(false) }, enabled = !loading) { Text("加载更多") } } }
            } else LazyColumn(Modifier.fillMaxSize().padding(start = 12.dp, top = 8.dp, end = 12.dp), state = listState, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(movies, key = { it.id }) { movie -> Card(Modifier.fillMaxWidth().clickable { onOpen(movie) }) { Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) { AuthenticatedMediaImage(movie.coverUrl, pairing, movie.title, Modifier.width(150.dp).aspectRatio(840f / 568f)); Column(Modifier.weight(1f)) { Text(movie.code ?: "未识别", style = MaterialTheme.typography.titleMedium); Text(movie.title, maxLines = 2, style = MaterialTheme.typography.bodyMedium) } } } }
                if (movies.size < total) item { Box(Modifier.fillMaxWidth(), contentAlignment = androidx.compose.ui.Alignment.Center) { OutlinedButton(onClick = { request(false) }, enabled = !loading) { Text("加载更多") } } }
            }
        }
    }
}

private fun readSearchHistory(preferences: android.content.SharedPreferences): List<String> = runCatching {
    val values = JSONArray(preferences.getString("recent", "[]"))
    (0 until values.length()).map { values.getString(it) }.filter { it.isNotBlank() }.take(10)
}.getOrDefault(emptyList())

@Composable private fun MovieFilterDropdowns(sourcePartition: String?, status: String?, sort: String, onSourcePartitionChange: (String?) -> Unit, onStatusChange: (String?) -> Unit, onSortChange: (String) -> Unit) {
    var sourcePartitionExpanded by remember { mutableStateOf(false) }
    var statusExpanded by remember { mutableStateOf(false) }
    var sortExpanded by remember { mutableStateOf(false) }
    val sourcePartitionLabel = when (sourcePartition) { "censored" -> "有码"; "fc2" -> "FC2"; "uncensored" -> "无码"; "leaked" -> "流出"; "unknown" -> "待分类"; else -> "全部片源" }
    val statusLabel = when (status) { "unwatched" -> "未观看"; "watching" -> "观看中"; "watched" -> "已看完"; else -> "全部状态" }
    val sortLabel = when (sort) { "release-desc" -> "发行日期（最新）"; else -> "加入时间（最新）" }
    LazyRow(Modifier.fillMaxWidth().height(48.dp), contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        item {
            Box {
                OutlinedButton(onClick = { sourcePartitionExpanded = true }, modifier = Modifier.height(36.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)) { Text(sourcePartitionLabel); Spacer(Modifier.width(4.dp)); Icon(Icons.Default.KeyboardArrowDown, null, modifier = Modifier.size(16.dp)) }
                DropdownMenu(expanded = sourcePartitionExpanded, onDismissRequest = { sourcePartitionExpanded = false }) {
                    listOf(null to "全部片源", "censored" to "有码", "fc2" to "FC2", "uncensored" to "无码", "leaked" to "流出", "unknown" to "待分类").forEach { (value, label) ->
                        DropdownMenuItem(modifier = Modifier.requiredHeight(40.dp), text = { Text(label, style = MaterialTheme.typography.bodyMedium) }, leadingIcon = { if (sourcePartition == value) Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp)) }, onClick = { sourcePartitionExpanded = false; onSourcePartitionChange(value) })
                    }
                }
            }
        }
        item {
        Box {
            OutlinedButton(onClick = { statusExpanded = true }, modifier = Modifier.height(36.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)) { Text(statusLabel); Spacer(Modifier.width(4.dp)); Icon(Icons.Default.KeyboardArrowDown, null, modifier = Modifier.size(16.dp)) }
            DropdownMenu(expanded = statusExpanded, onDismissRequest = { statusExpanded = false }) {
                listOf(null to "全部状态", "unwatched" to "未观看", "watching" to "观看中", "watched" to "已看完").forEach { (value, label) ->
                    DropdownMenuItem(modifier = Modifier.requiredHeight(40.dp), text = { Text(label, style = MaterialTheme.typography.bodyMedium) }, leadingIcon = { if (status == value) Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp)) }, onClick = { statusExpanded = false; onStatusChange(value) })
                }
            }
        }
        }
        item {
        Box {
            OutlinedButton(onClick = { sortExpanded = true }, modifier = Modifier.height(36.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)) { Text(sortLabel); Spacer(Modifier.width(4.dp)); Icon(Icons.Default.KeyboardArrowDown, null, modifier = Modifier.size(16.dp)) }
            DropdownMenu(expanded = sortExpanded, onDismissRequest = { sortExpanded = false }) {
                listOf("added-desc" to "加入时间（最新）", "release-desc" to "发行日期（最新）").forEach { (value, label) ->
                    DropdownMenuItem(modifier = Modifier.requiredHeight(40.dp), text = { Text(label, style = MaterialTheme.typography.bodyMedium) }, leadingIcon = { if (sort == value) Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp)) }, onClick = { sortExpanded = false; onSortChange(value) })
                }
            }
        }
        }
    }
}

@Composable private fun LibraryPage(pairing: Pairing, onOpen: (RemoteMovie) -> Unit, onUnauthorized: () -> Unit, modifier: Modifier, onSearch: () -> Unit) {
    val context = LocalContext.current
    val uiPreferences = remember { context.getSharedPreferences("avault-ui", android.content.Context.MODE_PRIVATE) }
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var movies by remember { mutableStateOf<List<RemoteMovie>>(emptyList()) }
    var page by remember { mutableIntStateOf(1) }
    var total by remember { mutableIntStateOf(0) }
    var status by remember { mutableStateOf<String?>(null) }
    var sourcePartition by remember { mutableStateOf<String?>(uiPreferences.getString("movieSourcePartition", null)) }
    var sort by remember { mutableStateOf(uiPreferences.getString("movieSort", "added-desc") ?: "added-desc") }
    var grid by remember { mutableStateOf(uiPreferences.getBoolean("movieGrid", true)) }
    val gridState = rememberSaveable(saver = LazyGridState.Saver) { LazyGridState() }
    val listState = rememberSaveable(saver = LazyListState.Saver) { LazyListState() }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    fun load(reset: Boolean = true) = scope.launch {
        loading = true
        val target = if (reset) 1 else page + 1
        try {
            val result = withContext(Dispatchers.IO) {
                AvaultApi(pairing).movies(page = target, query = query, status = status, sourcePartition = sourcePartition, sort = sort)
            }
            movies = if (reset) result.items else movies + result.items
            page = result.page
            total = result.total
            error = null
        } catch (e: UnauthorizedException) {
            onUnauthorized()
        } catch (e: Exception) {
            error = e.message ?: "无法加载媒体库"
        } finally {
            loading = false
        }
    }
    fun setSort(value: String) { sort = value; uiPreferences.edit().putString("movieSort", value).apply(); load() }
    fun setSourcePartition(value: String?) { sourcePartition = value; uiPreferences.edit().putString("movieSourcePartition", value).apply(); load() }
    LaunchedEffect(Unit) { load() }
    Column(modifier.fillMaxSize()) { Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { Text("AVault", style = MaterialTheme.typography.titleLarge); Row { IconButton(modifier = Modifier.size(36.dp), onClick = onSearch) { Icon(Icons.Default.Search, "搜索") }; IconButton(modifier = Modifier.size(36.dp), onClick = { grid = !grid; uiPreferences.edit().putBoolean("movieGrid", grid).apply() }) { Icon(if (grid) Icons.Default.ViewList else Icons.Default.GridView, if (grid) "切换为列表" else "切换为网格") }; IconButton(modifier = Modifier.size(36.dp), onClick = { load() }) { Icon(Icons.Default.Refresh, "刷新") } } }
        MovieFilterDropdowns(sourcePartition, status, sort, ::setSourcePartition, { status = it; load() }, ::setSort)
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth()); error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
        if (grid) LazyVerticalGrid(GridCells.Fixed(3), Modifier.fillMaxSize().padding(start = 10.dp, top = 4.dp, end = 10.dp), state = gridState, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { if (loading && movies.isEmpty()) gridItems(List(9) { it }) { Card(Modifier.fillMaxWidth().aspectRatio(442f / 568f), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {} } else gridItems(movies) { movie -> Card(Modifier.fillMaxWidth().clickable { onOpen(movie) }) { Column { AuthenticatedMediaImage(movie.coverUrl, pairing, movie.title, Modifier.fillMaxWidth().aspectRatio(442f / 568f), alignment = androidx.compose.ui.Alignment.CenterEnd); Text(movie.code ?: "未识别", modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) } } }; if (movies.size < total) item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.fillMaxWidth(), contentAlignment = androidx.compose.ui.Alignment.Center) { OutlinedButton(onClick = { load(false) }, enabled = !loading) { Text("加载更多") } } } } else LazyColumn(Modifier.fillMaxSize().padding(start = 12.dp, top = 8.dp, end = 12.dp), state = listState, verticalArrangement = Arrangement.spacedBy(8.dp)) { if (loading && movies.isEmpty()) items(List(5) { it }) { Card(Modifier.fillMaxWidth().height(110.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {} } else items(movies) { movie -> Card(Modifier.fillMaxWidth().clickable { onOpen(movie) }) { Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) { AuthenticatedMediaImage(movie.coverUrl, pairing, movie.title, Modifier.width(150.dp).aspectRatio(840f / 568f)); Column(Modifier.weight(1f)) { Text(movie.code ?: "未识别", style = MaterialTheme.typography.titleMedium); Text(movie.title, maxLines = 2, style = MaterialTheme.typography.bodyMedium) } } } }; if (movies.size < total) item { Box(Modifier.fillMaxWidth(), contentAlignment = androidx.compose.ui.Alignment.Center) { OutlinedButton(onClick = { load(false) }, enabled = !loading) { Text("加载更多") } } } }
    }
}

@Composable private fun SettingsPage(pairing: Pairing, error: String?, retry: () -> Unit, clear: () -> Unit, modifier: Modifier) = Column(modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { Text("设置", style = MaterialTheme.typography.headlineSmall); Text("已连接服务器：${pairing.serverId.take(8)}\n${pairing.baseUrl}"); error?.let { Text("离线：$it", color = MaterialTheme.colorScheme.error) }; Button(onClick = retry) { Text("重试连接") }; OutlinedButton(onClick = clear) { Text("取消配对并重新扫码") }; Text("AVault Android ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall) }

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun PlayerPage(movie: RemoteMovie, pairing: Pairing, initialFileId: String?, onBack: () -> Unit, onUnauthorized: () -> Unit) {
    val context = LocalContext.current
    val activity = context as? Activity
    val scope = rememberCoroutineScope()
    val audioManager = remember { context.getSystemService(AudioManager::class.java) }
    val player = remember { ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(DefaultHttpDataSource.Factory().setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${pairing.token}")))).build() }
    var file by remember(movie.id, initialFileId) { mutableStateOf(movie.files.firstOrNull { it.id == initialFileId && it.available } ?: movie.files.firstOrNull { it.available }) }
    var error by remember { mutableStateOf<String?>(null) }
    var controlsVisible by remember { mutableStateOf(true) }
    var versionSheetVisible by remember { mutableStateOf(false) }
    var isPlaying by remember { mutableStateOf(false) }
    var position by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var scrubPosition by remember { mutableLongStateOf(0L) }
    var scrubbing by remember { mutableStateOf(false) }
    var gestureText by remember { mutableStateOf<String?>(null) }
    var lastGestureText by remember { mutableStateOf("") }
    var gestureKind by remember { mutableStateOf("feedback") }
    var gestureActive by remember { mutableStateOf(false) }
    var lastTapAt by remember { mutableLongStateOf(0L) }
    var lastTapOnLeft by remember { mutableStateOf(false) }
    var singleTapJob by remember { mutableStateOf<Job?>(null) }

    fun syncProgress(positionMs: Long, durationMs: Long, final: Boolean = false) {
        val safePosition = positionMs.coerceAtLeast(0L)
        val safeDuration = durationMs.coerceAtLeast(0L)
        val status = movie.watchStatus
        if (final) {
            // The remembered Compose scope is cancelled while this page leaves composition.
            // Use a short-lived independent job so the final update survives player disposal.
            CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                runCatching { AvaultApi(pairing).updateProgress(movie.id, safePosition, safeDuration, status) }
            }
        } else scope.launch {
            try {
                withContext(Dispatchers.IO) { AvaultApi(pairing).updateProgress(movie.id, safePosition, safeDuration, status) }
            } catch (error: UnauthorizedException) {
                onUnauthorized()
            } catch (_: Exception) {
                // A later periodic update or the final update will retry transient LAN failures.
            }
        }
    }

    DisposableEffect(player) {
        val listener = object : androidx.media3.common.Player.Listener {
            override fun onPlayerError(playbackError: androidx.media3.common.PlaybackException) { error = "当前视频无法在此设备播放：${playbackError.errorCodeName}" }
            override fun onIsPlayingChanged(value: Boolean) {
                isPlaying = value
                if (!value && player.currentPosition > 0L) syncProgress(player.currentPosition, player.duration)
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == androidx.media3.common.Player.STATE_ENDED) syncProgress(player.currentPosition, player.duration)
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    DisposableEffect(Unit) {
        val window = activity?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, it.decorView) }
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        controller?.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            controller?.show(WindowInsetsCompat.Type.systemBars())
            // Read Media3 state on its owning (main) thread before releasing the player.
            syncProgress(player.currentPosition, player.duration, final = true)
            player.release()
        }
    }
    LaunchedEffect(player) { while (isActive) { position = player.currentPosition.coerceAtLeast(0L); duration = player.duration.coerceAtLeast(0L); delay(400) } }
    LaunchedEffect(controlsVisible) { if (controlsVisible) { delay(3_000); controlsVisible = false } }
    LaunchedEffect(gestureText) { gestureText?.let { lastGestureText = it } }
    LaunchedEffect(gestureText, gestureActive) { if (gestureText != null && !gestureActive) { delay(700); if (!gestureActive) gestureText = null } }
    LaunchedEffect(player) { while (isActive) { delay(15_000); if (player.isPlaying) syncProgress(player.currentPosition, player.duration) } }

    fun play(next: RemoteFile, startPosition: Long = movie.progressSeconds * 1_000) {
        file = next
        val codec = next.mediaInfo?.videoCodec.orEmpty()
        if (codec.contains("hevc", true) && !android.media.MediaCodecList(android.media.MediaCodecList.ALL_CODECS).codecInfos.any { !it.isEncoder && it.supportedTypes.any { type -> type.equals("video/hevc", true) } }) { error = "此设备无法播放 HEVC"; return }
        player.setMediaItem(MediaItem.Builder().setUri("${pairing.baseUrl.trimEnd('/')}/api/v1/files/${next.id}/stream").build())
        player.prepare()
        player.seekTo(startPosition.coerceAtLeast(0L))
        player.play()
    }
    LaunchedEffect(movie.id, initialFileId) { movie.files.firstOrNull { it.id == initialFileId && it.available }?.let(::play) ?: movie.files.firstOrNull { it.available }?.let(::play) }

    fun seekTo(target: Long, showControls: Boolean = true) { player.seekTo(target.coerceIn(0L, duration.coerceAtLeast(0L))); position = target; if (showControls) controlsVisible = true }
    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black)) {
        AndroidView(factory = { PlayerView(it).also { view -> view.player = player; view.useController = false; view.resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT } }, modifier = Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().pointerInput(player) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                val startPosition = player.currentPosition.coerceAtLeast(0L)
                val gestureDuration = player.duration.coerceAtLeast(0L)
                val startVolume = audioManager?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: 0
                val maxVolume = (audioManager?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: 1).coerceAtLeast(1)
                val startBrightness = activity?.window?.attributes?.screenBrightness?.takeIf { it >= 0f } ?: .5f
                val startPlaybackSpeed = player.playbackParameters.speed
                val fiveTimesThreshold = minOf(80.dp.toPx(), size.width * .18f)
                val twoTimesThreshold = fiveTimesThreshold * .65f
                var mode = 0 // 0 tap/hold, 1 seek, 2 brightness, 3 volume
                var speedBoost = false
                var fiveTimesSpeed = false
                val longPressJob = scope.launch {
                    delay(500)
                    if (mode == 0) {
                        singleTapJob?.cancel()
                        lastTapAt = 0L
                        speedBoost = true
                        gestureActive = true
                        controlsVisible = false
                        player.setPlaybackSpeed(2f)
                        gestureKind = "speed"
                        gestureText = "2× 倍速"
                    }
                }
                try {
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        val dx = change.position.x - down.position.x
                        val dy = change.position.y - down.position.y
                        if (!change.pressed) {
                            longPressJob.cancel()
                            if (speedBoost) { player.setPlaybackSpeed(startPlaybackSpeed); gestureActive = false; gestureText = null }
                            else when (mode) {
                                0 -> {
                                    val tappedLeft = down.position.x < size.width / 2f
                                    val now = SystemClock.uptimeMillis()
                                    val doubleTap = now - lastTapAt <= 280L && tappedLeft == lastTapOnLeft
                                    if (doubleTap) {
                                        singleTapJob?.cancel()
                                        lastTapAt = 0L
                                        val delta = if (tappedLeft) -15_000L else 15_000L
                                        val maximum = player.duration.takeIf { it > 0L } ?: Long.MAX_VALUE
                                        val target = (player.currentPosition + delta).coerceIn(0L, maximum)
                                        player.seekTo(target)
                                        position = target
                                        gestureKind = "feedback"
                                        gestureText = if (tappedLeft) "快退 15 秒" else "快进 15 秒"
                                    } else {
                                        lastTapAt = now
                                        lastTapOnLeft = tappedLeft
                                        singleTapJob?.cancel()
                                        singleTapJob = scope.launch {
                                            delay(280)
                                            if (lastTapAt == now) {
                                                controlsVisible = !controlsVisible
                                                lastTapAt = 0L
                                            }
                                        }
                                    }
                                }
                                1 -> { seekTo(scrubPosition, showControls = false); gestureActive = false }
                                else -> gestureActive = false
                            }
                            break
                        }
                        if (!speedBoost && mode == 0 && (abs(dx) > 32f || abs(dy) > 32f)) {
                            longPressJob.cancel()
                            singleTapJob?.cancel()
                            lastTapAt = 0L
                            mode = if (abs(dx) >= abs(dy) * 1.2f) 1 else if (down.position.x < size.width / 2f) 2 else 3
                            gestureKind = "feedback"
                            gestureActive = true
                            controlsVisible = false
                        }
                        if (speedBoost) {
                            val shouldUseFiveTimes = if (fiveTimesSpeed) dx >= twoTimesThreshold else dx >= fiveTimesThreshold
                            if (shouldUseFiveTimes != fiveTimesSpeed) {
                                fiveTimesSpeed = shouldUseFiveTimes
                                player.setPlaybackSpeed(if (fiveTimesSpeed) 5f else 2f)
                                gestureText = if (fiveTimesSpeed) "5× 倍速" else "2× 倍速"
                            }
                        } else when (mode) {
                            1 -> { scrubPosition = (startPosition + (dx / size.width * 120_000f).roundToInt().toLong()).coerceIn(0L, gestureDuration); gestureText = "${formatPlaybackTime(scrubPosition)} / ${formatPlaybackTime(gestureDuration)}" }
                            2 -> { val brightness = (startBrightness - dy / size.height * .55f).coerceIn(.05f, 1f); activity?.window?.attributes = activity?.window?.attributes?.also { it.screenBrightness = brightness }; gestureText = "亮度 ${(brightness * 100).roundToInt()}%" }
                            3 -> { val volume = (startVolume - dy / size.height * maxVolume.toFloat() * .55f).roundToInt().coerceIn(0, maxVolume); audioManager?.setStreamVolume(AudioManager.STREAM_MUSIC, volume, 0); gestureText = "音量 ${(volume * 100f / maxVolume).roundToInt()}%" }
                        }
                        change.consume()
                    }
                } finally {
                    longPressJob.cancel()
                    if (speedBoost) player.setPlaybackSpeed(startPlaybackSpeed)
                    gestureActive = false
                }
            }
        })
        AnimatedVisibility(
            visible = gestureText != null,
            modifier = if (gestureKind == "speed") Modifier.align(androidx.compose.ui.Alignment.TopCenter).padding(top = 18.dp) else Modifier.align(androidx.compose.ui.Alignment.Center),
            enter = fadeIn(animationSpec = tween(80)),
            exit = fadeOut(animationSpec = tween(100))
        ) {
            val speedPrompt = gestureKind == "speed"
            Surface(
                color = androidx.compose.ui.graphics.Color.Black.copy(alpha = if (speedPrompt) .36f else .68f),
                contentColor = androidx.compose.ui.graphics.Color.White.copy(alpha = .9f),
                shape = if (speedPrompt) MaterialTheme.shapes.small else MaterialTheme.shapes.medium
            ) {
                Text(
                    lastGestureText,
                    modifier = Modifier.padding(horizontal = if (speedPrompt) 11.dp else 20.dp, vertical = if (speedPrompt) 5.dp else 12.dp),
                    style = if (speedPrompt) MaterialTheme.typography.labelMedium else MaterialTheme.typography.titleMedium
                )
            }
        }
        if (controlsVisible) {
            Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black.copy(alpha = .38f))) {
                Row(Modifier.align(androidx.compose.ui.Alignment.TopStart).padding(12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.Default.Close, "退出播放") }
                    Text(movie.code ?: movie.title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                }
                IconButton(modifier = Modifier.align(androidx.compose.ui.Alignment.TopEnd).padding(12.dp), onClick = { versionSheetVisible = true }) { Icon(Icons.Default.Settings, "播放设置") }
                Row(Modifier.align(androidx.compose.ui.Alignment.Center), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    IconButton(modifier = Modifier.size(60.dp), onClick = { seekTo(player.currentPosition - 15_000) }) { Icon(Icons.Default.FastRewind, "快退 15 秒", modifier = Modifier.size(36.dp)) }
                    IconButton(modifier = Modifier.size(72.dp), onClick = { if (player.isPlaying) player.pause() else player.play() }) { Icon(if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow, if (isPlaying) "暂停" else "播放", modifier = Modifier.size(54.dp)) }
                    IconButton(modifier = Modifier.size(60.dp), onClick = { seekTo(player.currentPosition + 15_000) }) { Icon(Icons.Default.FastForward, "快进 15 秒", modifier = Modifier.size(36.dp)) }
                }
                Column(Modifier.align(androidx.compose.ui.Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp)) {
                    Slider(value = (if (scrubbing) scrubPosition else position).toFloat(), onValueChange = { scrubPosition = it.toLong(); scrubbing = true }, onValueChangeFinished = { if (scrubbing) { seekTo(scrubPosition); scrubbing = false } }, valueRange = 0f..duration.coerceAtLeast(1L).toFloat())
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text("${formatPlaybackTime(if (scrubbing) scrubPosition else position)} / ${formatPlaybackTime(duration)}", style = MaterialTheme.typography.bodySmall)
                        Text(file?.displayLabel(movie.code).orEmpty(), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        error?.let { message -> Surface(modifier = Modifier.align(androidx.compose.ui.Alignment.BottomCenter).padding(bottom = 72.dp), color = MaterialTheme.colorScheme.errorContainer) { Text(message, modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer) } }
    }
    if (versionSheetVisible) ModalBottomSheet(onDismissRequest = { versionSheetVisible = false }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("播放版本", style = MaterialTheme.typography.titleLarge)
            movie.files.filter { it.available }.forEach { candidate -> ListItem(headlineContent = { Text(candidate.displayLabel(movie.code)) }, supportingContent = { Text(listOfNotNull(candidate.mediaInfo?.videoCodec, candidate.mediaInfo?.container).joinToString(" · ").ifBlank { "本地文件" }) }, trailingContent = { if (candidate.id == file?.id) Icon(Icons.Default.Check, null) }, modifier = Modifier.clickable { versionSheetVisible = false; play(candidate, player.currentPosition) }) }
            Spacer(Modifier.height(12.dp))
        }
    }
}

private fun formatPlaybackTime(milliseconds: Long): String {
    val totalSeconds = (milliseconds.coerceAtLeast(0L) / 1_000).toInt()
    val hours = totalSeconds / 3_600
    val minutes = totalSeconds % 3_600 / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds) else "%02d:%02d".format(minutes, seconds)
}
