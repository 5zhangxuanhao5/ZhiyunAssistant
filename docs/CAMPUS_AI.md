# 校内 AI / OCR 与全新发布包

## 用户体验

四端都支持在未配置个人 DeepSeek API 时使用校内 DS 网关与校园 OCR；个人 API 已配置时优先个人服务。Mac 另有手动来源选择。首次使用提示校园网要求、效果局限、个人 API 配置入口和 **2026 年 11 月 1 日** 的校内服务使用期限。该日期不触发本机资料清理。

校内模型固定为 `deepseek-v4-flash-780k-local`，地址为 `https://modelgateway.zju.edu.cn/v1/chat/completions`。校园 OCR 使用 `https://mcp.zju.edu.cn/api/protal/proxy/system/layout-parsing`，先提取课件文字、公式和版面结构。OCR 可能漏识或误识，不能完整替代视觉模型对图表关系的理解；服务失败时不伪造课件内容。

## 密钥与构建

两枚校内服务凭据通过以下构建变量注入，变量值不写入日志或源码：

- `ZJU_CAMPUS_MODEL_API_KEY`
- `ZJU_CAMPUS_OCR_API_KEY`

构建器只读取这两个字段，**不读取开发者的个人 DeepSeek API、账号目录或学习记录**。缺少全部变量时构建普通个人 API 版本，并移除上次生成的校内配置；仅提供其中一个或格式错误时中止，防止产出半配置安装包。运行 `node scripts/campus-services.cjs <输出位置>` 可独立检查注入过程。

| 平台 | 注入位置 | 运行时读取 |
| --- | --- | --- |
| Mac | 应用 `Contents/Resources/CampusServices.json`，签名前写入 | Swift 原生层读取；本机自定义值优先；不会把校内密钥返回网页 |
| Windows | `staging-app/dist/desktop/CampusServices.json`，原生打包前写入 | Electron 主进程加载供内部课程服务使用 |
| Android | `app/src/main/assets/CampusServices.json`，Gradle 编译前写入 | 只向受信的内置应用桥提供，不给远程登录页面挂接原生桥 |
| HarmonyOS | `entry/src/main/resources/rawfile/CampusServices.json`，Hvigor 配置阶段写入 | UIAbility 加载至课程服务，不进入普通缓存 |

每个平台都有独立的注入脚本，因此单独下载该平台源码仍可构建。生成的 `CampusServices.json` 被 Git 忽略，源码归档明确排除此文件；安装包包含这两项默认服务。校内凭据能从客户端提取，不作为不可泄露的服务器密钥使用。用户自己的个人 API 保持原有本机保存方式，不会被默认配置覆盖。

CI 仅在主分支推送或受维护者控制的手动构建中读取仓库 Secrets；拉取请求验证不接收这些构建凭据。Windows 在界面测试之后、打包之前注入，避免测试时的重新构建移除最终配置。签名私钥与设备 Profile 不作为校内服务配置的一部分。

## 数据与验收

新包不得带有校园账号、Cookie / Token、聊天与助手记录、笔记、收藏、稍后再看、学习进度、权限记录、离线课程、下载队列或开发者文件路径。保持静态代码和个人运行目录分离；不清理开发者正在使用的应用资料以制造“干净包”。

验证包含：普通无预置构建、双凭据注入、个人字段不被导入、个人服务优先、校内服务固定路由、校园 OCR 解析、首次提示、账户内提示记录及安装包扫描。真实网络调用与真机交互的证据另列，不能仅根据配置存在宣称所有环境可用。
