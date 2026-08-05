# AVault Android

AVault Android 是 AVault Windows 桌面端的局域网客户端。它通过扫码与用户自己的 AVault 电脑配对，浏览电脑上的媒体库，并使用 AndroidX Media3 在手机内播放服务端提供的视频流。

客户端不扫描手机目录，不直接读取 Windows 共享文件夹，不编辑影片资料，也不提供下载、云同步或公网播放。

## 已实现功能

### 连接与安全

- 使用 CameraX 和 ML Kit 扫描桌面端配对二维码。
- 校验二维码版本、服务器身份、端口、一次性随机值和失效时间。
- 配对成功后使用 `EncryptedSharedPreferences` 加密保存服务器信息与访问令牌。
- 启动时自动连接上次地址；地址失效时通过 Android NSD 在局域网内发现同一台 AVault 服务器。
- 服务端返回未授权状态后清除失效配对，并回到扫码页面。
- 设置页支持重试连接以及取消配对后重新扫码。

### 页面与浏览

- 使用深色 Material 3 主题和 AVault 紫色视觉体系。
- 底部提供“媒体库、演员库、设置”三个主页面，页面实例保持缓存。
- Android 返回键优先关闭播放器、详情、演员/标签影片页或搜索页，不直接退出到桌面。
- 首页支持三列竖封网格和横封列表：网格显示番号，列表显示番号与标题。
- 支持分页加载、手动刷新、加载占位和网络错误提示。
- 观看状态与排序使用紧凑下拉菜单。
- 网格/列表布局和排序偏好保存在本机；两种布局分别保持滚动位置。

### 搜索、演员与详情

- 首页右上角打开独立搜索页，打开时不会自动请求影片数据。
- 提交关键词后才查询番号、标题、演员或标签。
- 保存最近 10 条搜索记录，自动去重、最新优先，并支持一键清空。
- 媒体库与搜索结果均支持片源分区（有码、FC2、无码、流出、待分类）、观看状态、加入时间和发行日期筛选/排序。
- 从搜索结果进入详情再返回时保留关键词、结果、筛选和滚动位置。
- 演员库以三列网格显示演员头像；演员详情展示别名、分类、社交链接和参演影片。
- 影片详情展示封面、标题、番号、发行日期、时长、演员、标签、简介和全部可用播放版本。
- 点击演员或标签可浏览对应影片。

### 播放器

- 使用 AndroidX Media3 / ExoPlayer 播放带 Bearer Token 的 HTTP Range 视频流。
- 默认进入沉浸式横屏播放，退出播放器后恢复系统方向和状态栏。
- 支持播放、暂停、进度条、前后 10 秒跳转和自动隐藏控制层。
- 支持在播放器中切换原画、HEVC、720p HEVC 等服务端可用版本，并尽量保持当前位置。
- 播放前检查设备 HEVC 解码能力；播放错误会在播放器内显示，不调用外部播放器。
- 播放中每 15 秒同步一次观看进度，退出播放器时同步最终位置和观看状态。
- 横向滑动：拖动时在中央预览目标时间，松手后执行快进或快退。
- 左半屏纵向滑动：调整屏幕亮度。
- 右半屏纵向滑动：调整媒体音量。
- 长按：临时使用 2 倍速；保持长按并向右滑切换到 5 倍速；滑回恢复 2 倍速；松手恢复手势前的速度。
- 手势提示会在操作结束后自动淡出。

## 技术栈

- Kotlin 2.2
- Jetpack Compose / Material 3
- AndroidX Media3 / ExoPlayer
- CameraX
- Google ML Kit Barcode Scanning
- Coil
- AndroidX Security Crypto
- Android NSD / DNS-SD

当前配置：

- `minSdk 35`（Android 15）
- `targetSdk 36`
- `compileSdk 36.1`
- Java/Kotlin JVM 目标兼容级别 11

## 项目结构

```text
android/
├─ app/src/main/java/com/example/avault/
│  ├─ MainActivity.kt          页面、导航、详情与播放器
│  ├─ data/
│  │  ├─ AvaultApi.kt         局域网 API 客户端与数据模型
│  │  ├─ LanDiscovery.kt      DNS-SD 自动发现
│  │  └─ PairingStore.kt      配对解析与加密存储
│  └─ ui/
│     ├─ MediaImage.kt        带鉴权的封面/头像加载
│     ├─ QrScanner.kt         相机扫码
│     └─ theme/               Compose 主题
├─ app/src/test/              JVM 单元测试
└─ app/src/androidTest/       Android 仪器测试
```

## 开发环境

建议使用最新版 Android Studio，并安装：

- Android SDK Platform 36
- Android SDK Build Tools
- Android SDK Platform-Tools（ADB）
- 与 Android Gradle Plugin 9.1.1 兼容的 JDK

桌面端和手机必须连接到允许设备互相访问的同一局域网。访客 Wi-Fi、AP 隔离、Windows 防火墙或 VPN 可能阻止扫码后的连接与自动发现。

## 构建与测试

在 PowerShell 中执行：

```powershell
cd android
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
```

生成的 APK：

```text
app/build/outputs/apk/debug/app-debug.apk
```

安装到已启用 USB 调试的设备：

```powershell
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

运行连接设备上的仪器测试：

```powershell
.\gradlew.bat :app:connectedDebugAndroidTest
```

## 使用流程

1. 启动 Windows 桌面端，确认局域网服务正在运行。
2. 在桌面端打开“连接手机”，生成配对二维码。
3. 打开 Android 客户端，允许相机权限并扫描二维码。
4. 配对成功后进入媒体库，选择影片及文件版本播放。
5. 如果电脑地址发生变化，点击设置中的“重试连接”；客户端会尝试在局域网重新发现原服务器。

## 接口与网络约束

Android 客户端使用桌面端 `/api/v1` 接口，主要包括健康检查、配对、影片、演员、标签、图片、播放进度和文件流。除健康检查与首次配对外，请求均携带设备 Bearer Token。

视频流只按服务端生成的文件 ID 请求，客户端不会接收或拼接电脑上的绝对文件路径。当前仅支持可信局域网内的 HTTP 通信，不应将服务端端口暴露到公网。

## 当前限制

- 仅保存并连接一台 AVault 电脑。
- 不支持离线下载、投屏、外挂字幕、后台音频或画中画。
- 不支持在手机端扫描、整理、转码或编辑影片资料。
- 不支持公网、NAT 穿透、云账户和多用户。
- 播放能力取决于设备硬件解码器及视频容器/编码组合。

完整项目说明见仓库根目录的 [README](../README.md)，产品约束和验收标准见 [REQUIREMENTS](REQUIREMENTS.md)。
