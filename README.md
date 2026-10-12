# 智云助手

把智云课堂中的课件、课堂转写、视频和笔记放在同一个学习窗口，按课程时间线回看。在线资源按校园账号的实际权限访问，AI 功能由用户自行配置 DeepSeek API。

本仓库包含 Windows 测试版，以及此前独立开发的原生 Mac 版。两个客户端分别维护本机资料，目前没有跨端自动同步。

## 下载

前往 [Releases](https://github.com/He-He-He-He-He-He/ZhiyunAssistant/releases) 选择对应平台的包，并核对同一发布中的 SHA256 校验文件。Windows 预发布需要两种架构的原生 CI 都成功才由工作流上传；没有上传的构建不能视为已验收。

| 客户端 | 版本与目标系统 | 下载选择 | 验证范围 |
| --- | --- | --- | --- |
| Windows | 0.8.0-beta.1；Windows 10/11，x64 / ARM64 | Intel、AMD 的 64 位电脑选 x64；ARM 电脑选 ARM64；提供 Setup.exe 与 ZIP | 处于测试阶段。Mac 上的模型、服务及 Electron 检查不代替 Windows 原生验收；实际 CI 状态以 [Actions](https://github.com/He-He-He-He-He-He/ZhiyunAssistant/actions) 为准 |
| Mac 原生版 | 1.0.0；macOS 13 及以上 | 同一个 DMG 或 ZIP 包含 Intel 与 Apple Silicon | 当前 Apple Silicon Mac 已验证真实有权限课程的视频、键盘操作与身份恢复，19 项合成回归通过；Intel 为编译检查 |

Mac 本次公开附件为ZhiyunAssistant-Mac-1.0.0.dmg、ZhiyunAssistant-Mac-1.0.0-PublicApp.zip 和ZhiyunAssistant-Mac-1.0.0-PublicSource.zip。[Mac 分发说明](macOS/DISTRIBUTION.md)列出三个文件的 SHA256。ZIP 的公开分发整理去除了归档元数据和日志私人路径，没有改应用二进制或版本。

Mac 包采用 ad-hoc 签名，尚未完成 Apple Developer ID 签名与公证。Windows 当前也没有发布者代码签名。这些包作为预览版本提供，不保证所有电脑、显卡、外设或教室媒体格式都已通过测试。

## 可以做什么

- 查看自己的课表与历史课次，搜索课程，收藏或稍后再看，保存每节课的学习进度。
- 按时间线浏览高清课件和转写，去黑边、合并连续重复课件；主动打开视频后可寻址、调速或全屏观看。
- 调整学习功能区，记录带来源与时间点的多篇笔记，管理、重命名及导出笔记。
- 下载当前账号可访问的课件、转写和视频，管理离线资料与普通缓存。
- 使用课程问答、本页速览及可选的无实质讲解分析；AI 材料按课件和讲解时间对应，费用由用户的 DeepSeek 账户承担。

各平台实现与验证细节请读 [Windows 说明](windows/README.md)、[Mac 说明](macOS/README.md)及 [Mac 分发说明](macOS/DISTRIBUTION.md)。[Windows 功能对照](windows/FEATURE_PARITY.md)包含迁移目标及未验收事项，不是一份全部完成的承诺清单。

## 使用边界与隐私

学校登录通过官方认证页面完成，不要求把校园密码发给项目维护者。密钥、会话和课程资料不随发布包分发；笔记、离线资料与缓存保存在本机，网络异常不主动注销已保存身份。平台明确拒绝的资源停止访问；直播开始前的转写和可回放片段只在平台实际提供时可用。

AI 仅在用户配置并启用相关功能后调用。问题及选定的课程上下文会发送给 DeepSeek；本机缓存可在应用内查看、关闭或清理。具体资料发送范围与存储方式见各客户端说明。

智云助手是独立学习工具，不代表浙江大学或智云课堂运营方。公开源码不包含用户账号、API 密钥、登录会话或真实课程原文。反馈问题时请模糊用户信息和课程内容，勿上传密钥或 Cookie。

## 源码与构建

- [Windows 使用与构建](windows/README.md)
- [Windows 验证说明](windows/VERIFICATION.md)
- [Windows 第三方说明](windows/THIRD_PARTY_NOTICES.md)
- [原生 Mac 使用与构建](macOS/README.md)
- [Mac 第三方说明](macOS/THIRD_PARTY_NOTICES.md)

仓库当前未新增本项目许可证，也没有将原作改为 MIT 授权。第三方组件保留各自现有许可证、版权和通知文件；如需其他使用授权，请与作者确认。
