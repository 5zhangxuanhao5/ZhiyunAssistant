# Windows 迁移功能对照与验收边界

核对基线：鸿蒙源项目 `outputs/SuikeHarmony`，0.7.4 / 31。核对日期：2026-10-12。此文依据实际源码及 0.7.4、0.7.3、0.7.1 审计记录，不把历史文档中的旧行为作为当前要求。本轮在 macOS 上运行鸿蒙行为测试，**374 / 374 通过，零失败、零跳过**。这不等于 Windows 安装、Windows 外设及长期稳定性已验收。

本表记录需要保留的行为及平台等效方案。**“Windows 等效”是迁移与验收目标，不预填为实现成功。** Windows 各项实际结果应以独立测试记录和发布包验证为准。目标分发架构为 x64 与 ARM64；不宣称兼容旧 32 位 Windows 或 Windows 7。

## 功能与细节

| 实际鸿蒙源功能 | Windows 等效目标 | 必须核验的细节 / 证据入口 |
| --- | --- | --- |
| 登录智云课堂、原生输入及官方其他登录方式 | 桌面登录表单 + 隔离的官方认证窗口；调用学校自身提交处理，验证码保留人工完成 | 数字/小键盘/中文输入/Tab/粘贴正常。用户名密码仅发送到官方认证，不写日志或持久保存。认证成功及时返回；慢网不错误提示未准备好。`OfficialLogin`、`Index` |
| 关闭应用后保持身份和会话；断网不自动退出 | 按账号隔离的数据目录与加密会话；离线可恢复账户身份 | 网络错误不能当注销；只有明确官方主账户失效影响在线登录。退出登录从任何子页直接回登录页、清会话、不误删笔记下载。`SessionStore` |
| 我的课堂：今日、近两周、全部本人修读记录 | 三个分类、全部默认按课程也可按日期；历史游标及课次目录缓存 | 全部不是所有“可访问”课程；新数据继续扫描、失败保留游标、目录减项使批量旧记录失效；回主页恢复最近分类。`Zhiyun`、`AttendanceBatch`、`MyCourses` |
| 半小时内准备、当前上课进入、自动衔接 | 按官方课次状态及起止时间显示；准备状态不虚构加载 | 30 分钟边界、正式开课切换、课程退出后刷新今日状态。`Timeline.phase`、`Index.tick` |
| 课程广场搜索课程/教师、全部/直播、全部分页、学年学期 | 最后一级入口；搜索菜单切换后自动搜索、分页及联动筛选 | 教师/课程/教室/学期选项只来自搜索结果，筛选联动后不无谓归零；进入课次和下载保留来源返回。`Plaza`、`SearchFacets` |
| 权限先呈缓存、后台实时确认、允许优先展示 | 账号限定的权限缓存及批量查询；入课/视频/下载明确检查 | “未知”不能当“允许”；字符串 `0` 不能授权；被明确拒绝时停止，不改走另一个资源路径。按门课批量 100 条、两并发。`Zhiyun.permissions/checkCurrentPermission` |
| 高清课件历史与新增页、双官方教室后端 | 主课堂及互动教室适配；完整分页历史 + 增量刷新 | 相同地址图变更条件校验；保留原图、时间戳、页面身份；进入直播可追溯平台已经提供的早期截图。`Zhiyun.slides`、`LocalStore` |
| 去黑边默认开启；黑底课件保守保护 | 图像像素算法放后台线程；保留原图、切换可恢复 | 两侧不对称边、左右黑边、黑底PPT、图片版本变化，不能按整图黑色就裁有效内容。`BlackBorders`、`LocalStore.trimmedImage` |
| 连续重复课件默认合并，可关闭 | 自动比较每次新来的相邻页；按保留页时间区间归并转写 | 仅相邻重复 A-A-A 合并，A-B-A 保留；压缩噪声容忍不能误合并不同页；原页面/转写不破坏、排序按源时间。`SlideSimilarity`、`Timeline.distinctSlides/groupPages` |
| 默认宽屏两页、小于四分之一屏一页；课件独开可设多页 | 响应式显示及基于图片比例的网格 | 只课件四页用 2×2 等合适网格；键盘按当前容量翻页，触摸距离倍率保留；左旧右新。`Timeline.pageCapacity`、`SlideGrid`、`StudyNavigation`、`PageNavigation` |
| 双击课件全屏，单击退出，左右查看不影响主进度 | 独立全屏图片查看状态 | 图片放大后拖移与翻页区分；全屏图片左右换页不寻址视频/转写。`PageCard`、`Index.turnExpandedSlide` |
| 概览和问答选页：触控缩放、浏览/选择模式、滑动刷选 | 桌面网格缩放、鼠标拖刷、触控捏合；固定右滚动条 | 选择模式禁缩放/课件上内容滚动，空白仍可滚；选择关闭清选；多指不误变纵滑；开概览/跳页/跳时间先关闭布局。`SlideOverview` |
| 历史转写 + Glue WebSocket 实时转写，多时间格式 | 主课堂/互动后端历史解析、官方返回地址的 WS 增量连接 | 相对秒、绝对毫秒、墙上时间统一。增量句子身份保持稳定；历史校正近似接收时间；重连/心跳/超时不重复句。历史缺失明确说明，不能补造进入前内容。`CaptionTime`、`LiveTranscript`、`Timeline.reconcileLines` |
| 有课件或速览时按课件对应转写；二者均关或无课件时连续 | 保留相同分页/连续切换条件及阅读锚点 | **当前条件是 `!slides.length || !(slidesEnabled || summaryOpen)`**；不是旧审计说的“二者同时开”。切连续后保持刚才可视句子及偏移，不跳开头。`Index.continuousTranscript` |
| 转写与页对应、播放句变蓝、无视频引用定位淡蓝两秒 | 以源开始时间分组；音视频按当前时刻定位、非播放引用强调 | 跨页边界归下一页；暂停间隙保留最近句蓝色；不叠两种强调；时间标签不闪、不重叠。`TranscriptPlayback`、`TranscriptRender`、`TranscriptMarkers` |
| 原生跨时间线选择、纯文本无换行复制、选字附近插笔记 | DOM 跨元素原生选区 + Rich Clipboard；冻结显示但继续后台接收 | 鼠标/触控板按压选择优先，不能当水平翻页；新直播转写不打断选区，翻页清旧选区；普通输入数字/A/C/V/方向键不拦截。`TranscriptText`、`NativeSelections` |
| 手动浏览暂停跟随，回到刚刚恢复当前；显式寻址可撤销 | 来源功能区唯一返回状态，保留原阅读/播放偏移 | 不点就不抢回；纯阅读点击原句仍可见不立即显示返回，滚出后才出现；返回按钮浮动、末尾留 44 像素等效滚动空间。`Index`、`TranscriptColumn`、`ReturnAction` |
| 主动加载视频，多机位仅真实不同且可播才显示 | 内置 HTML 视频/HLS 播放器；允许源列表、Range 与本地缓存 | 第一个源播放不等机位比较；只有一个源隐藏菜单。HLS/MP4、音轨、签名URL更新、编码失败均须真实Windows检查。`player.html`、`Media`、`VideoNetwork` |
| 0.1–16 倍速、悬浮滑轨、进度拖动实时显示、快捷键 | 相同速度范围与步进、稳定拖动值；视频焦点左右 ±15 秒/空格 | 回报不能覆盖正在拖动的速度/时间；双击暂停/继续，横拖显示正负秒；焦点按最后实际点的功能区。`VideoPane`、`PlaybackController` |
| 全窗口全屏、黑色画面外围、控制隐藏；概览时视频继续 | 系统全屏/应用内全屏 + 覆盖控制条 | 黑色局限视频区，全屏才铺满；大小调整画面/控件一同变，不能分离。当前手机重力旋转属于手机能力，Windows按窗口/屏幕方向等效适配。 |
| 直播默认无倍速/进度，主动回放才出现、回最新返直播 | 使用官方保留区间与DVR/已生成录像 | 无DVR不得伪造倒退；最早可播片段不自动跳尾。缺历史时说明限制。`player.html.replay/canScrub` |
| 每课次学习进度、收藏/稍后再看独立 | 本地按账号持久保存；两种按钮与进入学习同行 | 门课可全选及排除个别节，课程显示剩余 N 节；未来课程后置；取消单项/多项只确认一次；集合根按钮从嵌套课次能回根。`LearningProgress`、`CourseCollections`、`CollectionView` |
| 六个可组合功能区、自由拖移/八边角缩放/图层 | 桌面可拖面板与边角指针；点区置顶、横条才进入编辑 | 锁定仅布局内解锁；左/右/下可移出但保留、上不能移没；点别区退出旧编辑。默认布局不自动保存，保存仅同组合+同窗口尺寸复用；模态不能改变旧层级。`PaneLayout`、`PanePreferences`、`PaneFrame` |
| 常用功能可拖动排序、选中状态一致 | 真条目随指针移动、邻项让位、落位持久保存 | 所有关闭时提示打开功能；下拉文字对齐、圆角完整；拖动柄与滚动条分开。`Index.pinnedSettings` |
| 笔记光标中间插入、框间插入、回车分块、空定位块清理 | 可编辑富文档块和固定来源引用块 | 预上屏确认Enter不拆块，提交换行才拆；图/引用在原光标插入、前后文保留，不一律末尾追加；末尾续写可到达、图片完整同比例。`Notes`、`NoteBlocks`、`NoteCursor` |
| 笔记时间与来源、六种浅色来源、格式工具、命名、多笔记 | 保留原子/块数据、粗体/斜体/下划线/删除线/对齐、调色 | 自写时间按实际记录时刻；正文布局左上、placeholder与光标基线；窄窗设置可滚动。第二笔记时未命名首份编号。`NoteBlocks`、`NotesPane` |
| 笔记图/转写/AI/速览引用回溯、保留格式及时间链接 | 来源ID、会话/回答/速览归档ID、课程/时间一起保存 | 自动开源区、淡蓝定位、清理缓存后说明已清理；来源标题整行可点但叉号独立；跳转撤销放格式/末尾行，不改正文。`NoteFormatting`、`NotesStore`、`Index.rewind` |
| 图库/拍照/互联设备图片 | Windows文件选择/系统相机；跨设备来源按实际支持提供 | 鸿蒙 `ServiceCollaborationKit` 不可直接在Windows运行；不得用一个空按钮宣称等价实现华为互联相机/扫描。导入普通文件和系统能提供的联网设备源须分开验收。 |
| 管理课程→日期课次→笔记、最近打开优先、打开笔记 | Windows层级管理、重命名/删除/打开/批量导出 | 打开笔记自动进入原课次，保留原面板偏好，但视频不自动播放。名称管理 `课程_日期_笔记名`，课内仅笔记名。`NotesLibrary`、`NoteExport` |
| HTML / TXT / Markdown、图片、逐篇ZIP目录 | 原文档格式与时间引用保留；多篇独立文件打包 | `课程名_老师_学期/日期/笔记名`；Markdown图片 `笔记名_图片N`，防重名/非法Windows文件名；缺学期不编造。`NotesStore.export` |
| DeepSeek API配置/安全保存/更换/删除/动态模型 | 加密密钥、/models、真实配置页与已配置状态 | 用户自备密钥与费用，默认不耗费；不打包原用户调试密钥、会话或真实课程数据。`AiClient`、`ApiKeySetup` |
| 课程问答流式、格式、单页/指定页/全课/跨课范围 | SSE流式解析、Markdown安全渲染、真实工具读材 | **最新是 Enter发送、Shift+Enter换行**；输入法候选不发送；问题中明确范围可扩展；默认转写，必要时按需图像识别，不机械全页喂图。材料有序且与时间线对应。`AiStream`、`QuestionScope`、`AiClient.ask` |
| 每节问答历史、新会话、回复/多时间点可点击 | 独立课次会话缓存；每个引用独立课程ID+时间 | 同课与跨课多个时间都可跳、越界/未知引用不乱跳；回原课保持速览范围、页面、答复及滚动，不再次生成覆盖原文。`CourseReference`、`ChatStore`、`CourseJump` |
| 本页速览独立区、单页默认、所有页选择、多个上下文范围 | 页/前文/本节整课/整门课之前/整门课；版本归档+阅读位置 | 直播当前页手动，完成讲解后补最终版；已手動阶段答案完成后即使用户不看也补齐。单页不后台扫所有未查看页；全门课只读可访问课次，说明缺失及Token范围。`SummaryPolicy`、`SummaryCache`、`SummaryView`、`CourseContextLoader` |
| 跳过无转写与AI无效片段、两种跳过模式 | 默认关闭AI分析、启用提示费用、进度悬浮；准确时间片段而非整页删除 | 确定片段先完成先跳；视频同步寻址，只播放且可seek才自动跳；原文不破坏，关闭恢复；95%及教学内容保护、缺历史不当静默；无匹配提示。`SmartSkip`、`SmartSkipService` |
| 课内单节下载/主页批量、按课程/日期、局部全选 | 分类型选择课件/转写/视频；确认可访问课立即展示，后台继续发现 | 默认不全选；新增允许提示更新；批量缓存比对上课记录，删项重新扫；日历当月全日期可点，蓝色只代表已知可下载。`DownloadSheet`、`LessonDownload`、`AttendanceBatch` |
| 下载并发1–4、单节/全部暂停继续、调整队列 | 独立任务取消/恢复、字节进度、稳定虚拟列表 | 无关任务不取消；进度只更新变化行，写盘合并；下载中删除等待取消完成不能复活。未知总大小不伪造比例。`OfflineLibrary`、`OfflineRows`、`DownloadBytes` |
| 失败重试只补失败文件、保存可用内容、缺失具体原因 | 保留成功文件检查点，重试可恢复；部分内容明确列出 | 网络失败两次自动重试，403/404/空间不足直接说明；HLS缺片只保留连续可播前缀，不能把时间线拼错。离线删除清干净但不误删其他课程/笔记共图。 |
| 缓存保留及透明控制、不清下载/笔记/收藏/进度 | 普通缓存分类开关/总清理/详情多选；浏览器内核缓存单独列出 | 课件、转写、视频、问答、速览、识图、跳过分析、课表权限、旧缓存、网页临时文件；清理代次保护晚到请求不写回，活动下载临时文件受保护。`FeatureCache`、`CacheInventory`、`CacheSettings` |
| 流畅性优先、减少没有作用的工作 | UI/网络/下载/图像处理分隔，虚拟列表、后台worker、资料对象复用 | 不关闭硬件加速兜底所有机器；不靠低画质/少资料隐藏开销。无变更轮询不重复写，播放刻度不重建全列表，关视频/后台取消机位探测；DeepSeek稳定材料前缀和版本识图复用。`PERFORMANCE_0.7.3.md` |

## 应直接复用的算法层

`model/Timeline, CaptionTime, SlideSimilarity, BlackBorders, Media, PaneLayout, PanePreferences, CourseCollections, CollectionView, LearningProgress, StudyFolders, CourseSections, SearchFacets, AttendanceBatch, StudyNavigation, PageNavigation, SlideGrid, TranscriptPlayback, TranscriptRender, TranscriptMarkers, Notes, NoteBlocks, NoteCursor, NoteFormatting, NoteExport, AiStream, AiUsage, CourseReference, CourseContext, QuestionScope, SummaryPolicy, SummaryView, SmartSkip, DownloadBytes` 为行为核心，应转换为 TS 并继承原测试。

其中 `Media` 只需将 `@kit.ArkTS.url.URL` 换为标准 `URL`；`NativeSelections/SelectionKeys` 的鸿蒙事件类型及键码须适配。`OfflineRows/OverviewSource/SlideSpreadSource` 的 `IDataSource` / `DataChangeListener` 属 ArkUI虚拟列表接口，Windows用等效虚拟列表；不要原封不动留下未定义全局。`player.html` 与本地 `hls.min.js` 可复用播放状态、直播DVR及手势规则，必须改桥接实现并保留许可证。

`ChatStore, SummaryCache, SmartSkipService, CourseContextLoader, PlaybackController` 的大部分逻辑可保留，依赖平台服务抽象后使用。ArkUI UI组件与 `Index` 应以明确学习状态机迁移到桌面组件，不能仅用外壳加载鸿蒙界面。

## 平台专有接口的替换边界

| 鸿蒙接口 | Windows接口职责 |
| --- | --- |
| NetworkKit.http/webSocket | Electron主进程受限网络服务、取消/超时/流式下载，Renderer不直接暴露任意本机请求能力 |
| AssetStoreKit | Windows系统用户绑定的加密凭据存储；可用性失败应明确报错，不能悄悄明文降级 |
| ArkWeb.WebCookieManager/controlledWebview | 隔离认证session与cookie持久化，trusted origin/frame校验，官方窗口无Node权限 |
| CoreFileKit/DocumentViewPicker/zlib | Electron/Node异步文件IO、原子替换、标准保存对话框、ZIP打包，严格账户根目录与文件名规则 |
| ImageKit/TaskPool | Canvas/图像解码 + Worker后台比较/裁切/采样，释放大位图及任务取消 |
| ArkData拖放/Pasteboard | Windows原生文件拖出、文字/HTML/图片剪贴板；触控长按与鼠标拖放分别测试 |
| MediaKit取帧、ArkWeb播放器桥 | Chromium视频/HLS、主进程Range/授权请求、离线协议；播放器不因布局变化销毁 |
| Sensor/Window orientation/safe-area | 桌面窗口尺寸、显示缩放、全屏/多屏/DPI变化，不宣称提供无传感器电脑的重力方向能力 |
| PhotoViewPicker/CameraPicker/ServiceCollaboration | 本机文件/系统相机/系统能提供的联网设备能力；华为专有互联能力需明确平台等效与支持边界 |
| AppGalleryKit.privacyManager | Windows版公开隐私说明、功能同意和撤回；不调用华为商城托管接口冒充Windows政策 |

## 关键课程API（只沿官方权限路径）

- 主站：`https://classroom.zju.edu.cn`；互动教室：`https://interactivemeta.cmc.zju.edu.cn`。
- 账户：`/userapi/v1/infosimple`。
- 修读课表：`/courseapi/v2/schedule/get-week-schedules`；校历学期：`/courseapi/index.php/v2/course/get-term-years`。
- 搜索：`/pptnote/v1/searchlist`；课次目录：`/courseapi/v2/course/catalogue`。
- 课程详情：`/courseapi/v3/portal-home-setting/get-sub-info`；广场/视频及教室元信息：`/courseapi/v2/course-live/search-live-course-list`。
- 官方权限（保留平台路径原拼写）：`/courseapi/v2/course/video-and-live-promission-by-user-id`。
- 课件：主站 `/pptnote/v1/schedule/search-ppt`，互动 `/pptnoteapi/v1/schedule/search-ppt`；每页100、完整历史最多200页请求。
- 历史转写：`/courseapi/v3/web-socket/search-trans-result`；实时地址只取课程元数据并转换Glue `/glue/ws`，不转发校园密码或Cookie至WS地址。
- 平台资源课件：`/spidermaterial/spider-material/web/aitask/async/getPPTData`。
- DeepSeek：`https://api.deepseek.com/models` 与 `/chat/completions`，真实模型清单、SSE、工具读取资料及识图。

## 不能用“构建成功”代替的检查

1. **干净Windows实机/虚拟机安装**：未安装Node/开发工具的普通非管理员账户、x64与ARM64包、安装/首次启动/退出/再次启动/卸载保留数据；非ASCII用户名与路径、只读目录、磁盘不足、防病毒提示。
2. **独立发布包**：所需运行时/图标/资源全部包含；无开发绝对路径、签名私钥、校园Cookie、API密钥、测试笔记或真实课程原文；ZIP便携和安装版数据策略清楚。
3. **桌面矩阵**：100%/125%/150%/200%DPI、1366×768小屏、超宽/多屏、缩放窗、触摸屏、鼠标左右键、实体触控板单指按压选区和双指滚动、中文IME及所有数字/快捷键。
4. **真实媒体/弱网**：MP4、HLS、直播/DVR、多机位、离线音视频与课件转写，断网/重连/休眠/锁屏后恢复，不把接口桩测试说成实际Windows播放。
5. **长时稳定性**：万句转写、数千离线行、并行下载/删除/暂停/恢复、开关视频/布局/全屏/AI引用跳课、会话与速览返回、内存增长/崩溃日志。
6. **权限及隐私**：允许/拒绝/未知/失效/断网独立；官方明确拒绝终止。密钥加密、AI按需发送、缓存清理不破坏笔记/下载；发布到公开GitHub前做敏感文件扫描。

原374条回归是迁移必须保留的基线，不代表完整硬件路径已测。新Windows行为测试、静态类型检查、集成检查及实际发布包启动检查均须另记结果。若没有Windows运行环境，交付必须明确标注“Windows真机尚未验证”，不能保证任何别人的电脑都绝无问题。

## 当前本机可复现结果与Windows门禁

- `tests/core-port.test.cjs` 已从原基线继承144个纯模型及智云API行为测试，不含ArkUI源码字符串断言，也不依赖DevEco绝对路径；另加日历、输入法、视频时间/DVR/手势、实际 HLS 构造配置及发布审计行为，共152项，在当前macOS主机实际全部通过。
- `tests/lists.test.ts` 的9项实际列表逻辑检查通过：批量下载四种来源范围、允许/拒绝/未知过滤、增量权限合并、修读记录增减时的缓存复用、早期下载事件和删除后旧事件安全、2500门已下载记录对象复用、同名课程独立分组、排除课次后的未来课程排序。
- `tests/e2e/calendar-selection.spec.ts` 与 `tests/e2e/lists.spec.ts` 共6项真实 macOS Electron 集成检查通过。覆盖日历滑动后立即点击与完整月格、课程转写纯文本复制和点击外部取消；本人批量缓存/默认不选、搜索及单门课程刷新范围、返回恢复搜索结果；早期下载进度/删除后旧事件不复活、2500条记录的80/160分页与已保存DOM位置稳定；不完整全课收藏补课次及部分收藏进入后只显示所选课。测试使用合成课程和隔离目录，无真实账号、课程内容或付费请求。
- `tests/camera.test.ts` 的6项实际视觉机位逻辑检查与 `tests/e2e/camera.spec.ts` 的3项真实 macOS Electron 解码检查通过。MP4和HLS不同URL在同一课内两个时点取64×36 RGB帧；充分相同才合并，反相真实不同画面保留，黑屏/纯色/单帧/错时间/不同比例都不能作相同证据。当前选中机位作为合并组代表不改变主播放源；取帧不寻址主播放器。暂停取消后台比较，失败未验证的机位保留。本项不代替Windows显卡及真实课堂媒体检查。
- `Calendar` 与 `Selections` 的独立macOS Electron检查覆盖当月格子、记录标记、无课日期、年切换/横划、阶梯选区、空白处取消、富文本图片复制载荷和时间标签排除。此项不代替Windows的实体键盘/触控板验收。
- `.github/workflows/windows.yml` 在原生 `windows-2025`（x64）与 `windows-11-arm`（ARM64）分别执行类型、单元、Electron UI、NSIS+ZIP、PE/ASAR、中文含空格路径安装、已安装EXE启动及卸载检查；两者全部通过后，版本Tag只生成**预发布**，不自动标记稳定版。任务尚未运行不能提前写成Windows已经通过。
- Windows10/11为目标支持范围；Windows7/8/8.1及32位系统不在分发范围。GitHub的x64运行器是WindowsServer2025，不能把其结果扩写成Windows10每个版本和任意显卡都已实测。参考[GitHub运行器说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)与[Electron旧Windows支持结束说明](https://www.electronjs.org/blog/windows-7-to-8-1-deprecation-notice)。

## 仍需单独确认的平台边界

- 视频机位视觉比较已实现桌面等效并在本机验证MP4/HLS：只在视频播放且有足够真实可比较时间区间时启动，首源不等待比较。不能取帧、没有足够历史区间或样本不确定时保留候选源。Windows原生CI与不同教室真实机位仍需核验，鸿蒙MediaKit路径不作为Windows结果证据。
- Windows图片导入可使用文件选择与操作系统摄像设备。鸿蒙华为互联手机图库、相机、文档扫描接口不是Windows通用接口；电脑/手机系统能提供的摄像设备需要分别验收，不能把“默认摄像头能拍照”写成完整华为设备互联已等效。
- 官方直播是否提供加入前的转写、历史课件和DVR区间由对应课程/教室接口决定。应用持续查询已授权的官方历史路径；缺失则说明原因，不补造历史、不绕过权限。合成媒体通过不代替真实教室与网络环境验证。
