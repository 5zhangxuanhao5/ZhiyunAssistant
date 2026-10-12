# 桌面服务实现与验证

`services.ts` 提供受限 IPC 方法、账户隔离存储和 `zhiyun-resource` 资源协议；`compat.ts` 将原鸿蒙服务所用的网络、文件、图像与安全存储接口适配到 Electron/Node。共享的课程 API、教室资源解析、实时转写、下载队列、问答上下文、笔记格式及时间线算法保留在 `src/shared`。

课程进入和视频/下载始终重新确认官方权限。明确的拒绝不探测备用权限通道。直播历史资源只读取平台确实提供的数据；历史转写缺失时返回明确原因。断网不会自行清除已保存的登录身份；明确退出登录会清除安全会话和在线入口。

API 密钥、保存的登录 Cookie 和账户身份使用 Electron `safeStorage`，Windows 上由系统安全存储保护。旧版明文账户元数据迁移后删除。渲染进程不获得密钥和 Cookie。资源使用随机令牌，不能直接打开任意文件；HLS 清单中每个子资源都改写为受限令牌地址，跨主机跳转删除 Cookie/Authorization。下载和缓存分开；缓存清理不会删除离线课程、笔记、学习进度和收藏。

黑边与相邻重复课件的像素判断运行在独立 Worker。图片解码/编码使用 Electron 自带的 NativeImage；比较任务串行准备像素，避免概览同时创建大量高分辨率缓冲。构建须包含 `dist/desktop/image-worker.cjs`，正式 ASAR 打包须解包这个 Worker 文件到 `app.asar.unpacked/dist/desktop/image-worker.cjs`。后台下载进度只发送运行中任务的 `taskUpdates`；直播转写按 120ms 聚合 `added` 增量，2秒保存一次并在退出课程时保存。

2026-10-12：`node --import tsx --test tests/desktop-services.test.ts` 的 31 项服务行为测试通过，覆盖跨系统文件标志、账户隔离、拒绝权限边界、持久缓存修订、损坏目录恢复、下载暂停/删除、连续重复课件与时间线、笔记图片重启及 ZIP 目录、无网登录、加密迁移、HLS 令牌、视频 Range/HEAD/零文件/取消、Worker 像素处理、浏览器缓存清理、分周课表和历史缓存先显示。`npm run check` 已通过。

这些测试在当前 Mac 上运行，官方服务器交互用明确的测试数据模拟，安全存储测试使用加密适配器；不等同于 Windows 真机安装、DPAPI、校园登录或实际视频播放验证。Windows x64/ARM64 的干净系统安装、真实官方登录、硬件视频解码、键鼠/触控板和系统安全存储仍需要对应 Windows 环境验证，不能宣称所有电脑零故障。

2026-10-12 合成媒体回归：`npx playwright test tests/e2e/media.spec.ts` 在 Mac 原生 Electron 运行，4/4 通过（11.1秒）。自有 H.264/AAC MP4 及 HLS/TS 实际解码和播放时间前进，原生进度/倍速滑轨、键盘15秒寻址、概览持续播放、全窗口几何与黑底边界、自动隐藏控件均有断言。修复了 hls.js 1.6.19 因单独设置 `liveMaxLatencyDurationCount` 导致构造失败的问题。仍未验证真实校园视频或 Windows 原生运行。

批量上课索引缓存使用明确命名 my-attendance-batch-v1.json，并迁移删除旧散列缓存；目录缓存清理会取消正在运行的历史扫描，防止旧请求随后重新写入。运行缓存详情按选定子类清理。导出名称依照 Microsoft Windows 文件命名规则避免设备保留名、末尾空格/句点、大小写冲突，并限制 Unicode 路径组件长度；正常课程/日期/笔记命名保持不变。参考：https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file 。
