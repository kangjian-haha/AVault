# AVault iOS

参考 Android 客户端实现的原生 SwiftUI 应用，最低 iOS 17，支持 iPhone 与 iPad。直接连接现有桌面端 `/api/v1` 接口，不需要修改服务端，无第三方依赖。

## 打开与运行

1. 使用 Xcode 打开 `AVault.xcodeproj`，选择 `AVault` Scheme。
2. 模拟器可直接运行；真机需在 Signing & Capabilities 中选择自己的 Development Team，必要时更换 Bundle Identifier。
3. 手机和电脑连接同一局域网，启动桌面端 AVault，在“连接手机”生成二维码。
4. iOS 端允许本地网络及相机权限，扫码配对。模拟器没有相机，可粘贴二维码 JSON（不是访问令牌）。

命令行构建：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project iOS/AVault.xcodeproj -scheme AVault -sdk iphonesimulator \
  -configuration Debug -derivedDataPath /tmp/avault-ios-build \
  CODE_SIGNING_ALLOWED=NO build
```

API 契约测试（macOS 自带 Swift 编译器和 Python 3）：

```sh
python3 iOS/Tests/run-contract-tests.py
```

测试直接抽取生产代码中的 Foundation 数据模型、二维码解析及 API 实现，用 URLProtocol 响应验证，不需要启动桌面端。

## 已实现

- 相机扫码配对，校验二维码版本、身份、有效期、随机值及端口；也可粘贴二维码 JSON。
- 配对身份及令牌存入 Keychain，仅当前设备解锁时可读取；取消配对会删除。
- 启动检查服务器身份与设备授权，地址失效后通过 `_avault._tcp` Bonjour 重新发现同一服务器；401/403 清除配对。
- 媒体库三列网格/横封列表、分页、下拉刷新、片源/观看状态筛选及加入时间/发行日期排序；保存布局和排序偏好。
- 独立提交式搜索，最近 10 条搜索记录与清空操作。
- 演员库、演员别名/分类/社交链接、演员影片与标签影片页。
- 影片详情、可用文件版本和手动观看状态同步。
- 封面及头像请求携带鉴权，不将令牌放入 URL。
- 自定义 AVPlayerLayer 播放器：播放/暂停、进度拖动、前后 15 秒、3 秒自动隐藏控制层、横屏锁定和返回详情页；每 15 秒以及暂停、退到后台、退出时同步进度。播放器不会自动修改观看状态。
- 播放器支持左右半屏双击跳转、横向拖动预览、左侧亮度调节、右侧音量调节、长按 2 倍速以及横向滑动切换 5 倍速；每个手势都会显示轻量提示。
- 深色主题与紫色强调色。

### iPhone 首页设计

- 首页以 iPhone 竖屏为主要目标，使用三列紧凑网格。
- 媒体封面统一使用 2:3 竖版容器并裁剪填充，避免原图比例不同造成卡片跳动。
- 封面加载使用内存缓存和请求去重；加载中、缺失和失败状态都有稳定占位。
- 筛选控件使用可横向滚动的胶囊按钮，布局切换按钮保留至少 44pt 触控区域。
- 网格和列表卡片支持 Dynamic Type、VoiceOver 标签和长标题省略。

## 文件

- `AVaultApp.swift`：应用入口。
- `AppStore.swift`：接口、数据模型、配对、Keychain 与 Bonjour 重连。
- `ContentView.swift`：媒体库、搜索、详情、演员库和设置。
- `ScannerView.swift`：AVFoundation 二维码扫描。
- `PlayerView.swift`：AVKit 播放与进度同步。

## 验证与限制

已通过 iOS Simulator Debug 编译、模拟器首次启动检查和 API 契约测试。尚未连接真实 Windows AVault 进行真机扫码、Bonjour 和流媒体端到端验证。

本版播放器使用自定义 AVPlayerLayer，可在竖屏进入后手动锁定横屏；不提供下载、后台音频、投屏或外挂字幕。封面暂未提供放大查看或持久缓存。

播放采用 AVURLAsset 的 HTTP header options 传入 Bearer Token；`AVURLAssetHTTPHeaderFieldsKey` 并非 Apple 正式公开承诺的 API，需要在目标 iOS 真机确认兼容性。若用于正式分发，应进一步实现受支持的鉴权资源加载方案。iOS 能否播放取决于容器与编码，部分 Android 可播放的 MKV/编码组合在 AVPlayer 中不可用，可尝试桌面端生成的 MP4 HEVC/AAC 版本。

局域网 HTTP 的 ATS 例外用于连接动态 IP 的桌面端。仅在可信局域网使用，不应将服务端端口暴露到公网。
