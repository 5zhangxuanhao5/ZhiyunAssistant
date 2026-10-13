# 第三方与数据处理

- 浙江大学官方统一身份认证、智云课堂及其官方课程资源服务：处理校园登录并按账号权限提供课程内容。本应用为独立工具，不代表学校或平台运营方。
- DeepSeek：用户配置并主动启用 AI 后接收选定的课程资料、时间线和问题；费用、模型与数据处理规则以其官方平台为准。应用不内置 API 密钥。
- Android / AndroidX：系统 WebView、Keystore、WindowManager、系统文件保存、图片和相机能力；AndroidX 组件采用 Apache License 2.0。
- React / React DOM / Scheduler（MIT）、hls.js（Apache License 2.0）、DOMPurify（Apache License 2.0 或 MPL 2.0）、Marked（MIT）、Buffer（MIT）、JSZip（MIT 或 GPLv3，按 MIT 使用）及其构建传递组件：用于本机界面、视频和资料格式处理。许可证保留于 `third_party/`。
- Gradle、Android Gradle Plugin、JDK、Node.js、TypeScript、esbuild、Playwright 和测试工具属于构建/测试依赖。发行 APK 不包含 Electron 或 Node.js 运行时，也不包含第三方广告或统计 SDK。

登录页面不注入应用的 JavaScript 系统桥，登录密码不落盘。会话和 API 密钥由 Android Keystore 的 AES-GCM 保护。笔记、离线资料与普通缓存位于应用私有目录；应用不设置自己的资料上传服务器。图片/相机/导出均由用户操作触发。断网不主动退出身份。

课件、转写和视频版权属于原作者和相关权利人，下载和使用遵守平台提供的权限，不规避明确拒绝。AI 结果标明来源并应结合原文核对。公开源码和安装包不包含用户资料、校园账号或课程正文。
