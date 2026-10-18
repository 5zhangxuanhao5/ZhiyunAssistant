# 智云助手

把智云课堂中的课件、课堂转写、视频和笔记放在同一个学习窗口，按课程时间线回看。在线资源按校园账号的实际权限访问，AI 功能由用户自行配置 DeepSeek API。

本仓库包含 Windows、原生 Mac、原生鸿蒙手机/平板和 Android 手机/平板/折叠屏版本。各客户端分别维护本机资料，目前没有跨端自动同步。

## 下载

前往 [Releases](https://github.com/He-He-He-He-He-He/ZhiyunAssistant/releases) 选择对应平台的包，并核对同一发布中的 SHA256 校验文件。Windows 预发布需要两种架构的原生 CI 都成功才由工作流上传；没有上传的构建不能视为已验收。

| 客户端 | 版本与目标系统 | 下载选择 | 验证范围 |
| --- | --- | --- | --- |
| Windows | 0.8.0-beta.1；Windows 10/11，x64 / ARM64 | Intel、AMD 的 64 位电脑选 x64；ARM 电脑选 ARM64；提供 Setup.exe 与 ZIP | 处于测试阶段。Mac 上的模型、服务及 Electron 检查不代替 Windows 原生验收；实际 CI 状态以 [Actions](https://github.com/He-He-He-He-He-He/ZhiyunAssistant/actions) 为准 |
| Mac 原生版 | 1.8.1；macOS 13 及以上 | [Mac 下载](https://github.com/He-He-He-He-He-He/ZhiyunAssistant/releases/tag/mac-v1.8.1-preview)：同一 DMG / ZIP 包含 Intel 与 Apple Silicon | 新版有完整页面回归、隐藏真实 WebKit 流程、合成视频实际解码与原生桥验证，见 [Mac 验证记录](macOS/VERIFICATION.md)；Intel 为编译检查 |
| HarmonyOS 原生版 | 0.7.4；最低 HarmonyOS 6.1.1 / API 24，手机 / 平板 | [鸿蒙下载](https://github.com/He-He-He-He-He-He/ZhiyunAssistant/releases/tag/harmony-v0.7.4-preview)：未签名 HAP、源码和安装说明，需自行配置设备调试签名 | 374 项自动回归；此前在 HarmonyOS 7 手机/平板测试，不能视为全部设备或交互已验收 |
| Android | 0.1.0-beta.2；Android 8.0 及以上，手机 / 平板 / 折叠屏 | [Android 下载](https://github.com/He-He-He-He-He-He/ZhiyunAssistant/releases/tag/android-v0.1.0-beta.2)：已签名通用 APK | 本次修正 vivo 图标裁切；0.1.0-beta.1 已验证登录、视频及内外屏切换，并通过 240 项共享测试、7 项合成界面检查和 10 项原生 JVM 测试通过；双铰链为合成布局检查，见 [Android 验证记录](android/VERIFICATION.md) |

鸿蒙版上架涉及备案、授权材料、发行签名和审核，目前尚未完成，先通过 GitHub 提供开发者自行签名安装的版本。可在设备开启开发者模式，通过 DevEco Studio 配置自己的调试签名后安装；**开发者模式本身不能免除签名或设备绑定要求**，详见[鸿蒙安装说明](harmonyOS/INSTALLATION.md)。不公开作者的私人签名材料或测试设备信息。

Mac 1.8.1 提供 20 套完整主题，主窗口内单击真实首页截图预览，双击确认并返回，日期、日历、收藏、翻页与笔记图标按主题统一设计。恢复登录使用学校官方网页会话，不再要求交互式解锁旧登录钥匙串；修复空课表误报并保护未确认窗口内的缓存。保留六个自由功能区、笔记引用和下载队列，Dock 与标题栏图标同步切换。提供 DMG、应用 ZIP、源码 ZIP 与 SHA256；公开资料不含用户账号、密钥或私人课程内容。

Mac 包采用 ad-hoc 签名，尚未完成 Apple Developer ID 签名与公证。Windows 当前也没有发布者代码签名。这些包作为预览版本提供，不保证所有电脑、显卡、外设或教室媒体格式都已通过测试。

## 可以做什么

- 查看自己的课表与历史课次，搜索课程，收藏或稍后再看，保存每节课的学习进度。
- 按时间线浏览高清课件和转写，去黑边、合并连续重复课件；主动打开视频后可寻址、调速或全屏观看。
- 调整学习功能区，记录带来源与时间点的多篇笔记，管理、重命名及导出笔记。
- 下载当前账号可访问的课件、转写和视频，管理离线资料与普通缓存。
- 使用课程问答、本页速览及可选的无实质讲解分析；AI 材料按课件和讲解时间对应，费用由用户的 DeepSeek 账户承担。

各平台实现与验证细节请读 [Android 说明](android/README.md)、[Android 功能对照](android/FEATURE_PARITY.md)、[Windows 说明](windows/README.md)、[Mac 说明](macOS/README.md)、[Mac 功能对照](macOS/FEATURE_PARITY.md)及 [Mac 分发说明](macOS/DISTRIBUTION.md)。[Windows 功能对照](windows/FEATURE_PARITY.md)包含迁移目标及未验收事项，不是一份全部完成的承诺清单。

## 使用边界与隐私

学校登录通过官方认证页面完成，不要求把校园密码发给项目维护者。密钥、会话和课程资料不随发布包分发；笔记、离线资料与缓存保存在本机，网络异常不主动注销已保存身份。平台明确拒绝的资源停止访问；直播开始前的转写和可回放片段只在平台实际提供时可用。

AI 仅在用户配置并启用相关功能后调用。问题及选定的课程上下文会发送给 DeepSeek；本机缓存可在应用内查看、关闭或清理。具体资料发送范围与存储方式见各客户端说明。

智云助手是独立学习工具，不代表浙江大学或智云课堂运营方。公开源码不包含用户账号、API 密钥、登录会话或真实课程原文。反馈问题时请模糊用户信息和课程内容，勿上传密钥或 Cookie。

## 源码与构建

- [Android 使用与构建](android/README.md)
- [Android 验证说明](android/VERIFICATION.md)
- [Android 第三方说明](android/THIRD_PARTY_NOTICES.md)

- [Windows 使用与构建](windows/README.md)
- [Windows 验证说明](windows/VERIFICATION.md)
- [Windows 第三方说明](windows/THIRD_PARTY_NOTICES.md)
- [原生 Mac 使用与构建](macOS/README.md)
- [Mac 第三方说明](macOS/THIRD_PARTY_NOTICES.md)
- [鸿蒙源码与构建](harmonyOS/README.md)
- [鸿蒙开发者模式安装说明](harmonyOS/INSTALLATION.md)
- [鸿蒙第三方说明](harmonyOS/THIRD_PARTY_NOTICES.md)

仓库当前未新增本项目许可证，也没有将原作改为 MIT 授权。第三方组件保留各自现有许可证、版权和通知文件；如需其他使用授权，请与作者确认。
