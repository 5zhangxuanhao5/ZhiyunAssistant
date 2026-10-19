# 智云助手 Windows 测试版

## 2026-10-19 校内 AI / OCR 默认接入

获授权的新版安装包在没有个人 API 时默认使用校内 DS 与校园 OCR；已配置个人 DeepSeek API 时优先个人服务。首次调用会提示校园网要求、效果可能不佳，以及校内服务使用期限截至 **2026 年 11 月 1 日**；想获得更佳效果可自行配置个人 DeepSeek API。校内模式先用 OCR 提取课件，可能遗漏图示关系或误识公式、表格。

构建只注入获准分发的两项学校凭据，不包含开发者的个人 API、校园登录、聊天、笔记、学习记录或下载资源。普通源码不包含凭据，仍可构建个人 API 版本。详见[校内服务与构建](../docs/CAMPUS_AI.md)。以下历史验证与版本说明仅对应其标注版本，不代表本轮已完成同等真机验收。


当前版本 **0.8.0-beta.1**。采用 Electron、React 与受限桌面服务，迁移现有智云课程 API、时间线、重复课件、笔记及 AI 上下文模型。目标是保留鸿蒙版本的学习行为；具体迁移目标见 [FEATURE_PARITY.md](FEATURE_PARITY.md)，实际测试范围见 [VERIFICATION.md](VERIFICATION.md)。

## 安装

目标系统为 Windows 10/11 的 64 位版本，不提供 Windows 7/8/8.1 或 32 位安装包。Electron 的 Windows 平台范围与架构说明见其[官方 README](https://github.com/electron/electron#platform-support)和[安装文档](https://www.electronjs.org/docs/latest/tutorial/installation)。

1. 在本仓库 [Releases](https://github.com/5zhangxuanhao5/ZhiyunAssistant/releases) 下载与电脑架构一致的包。
2. x64 用于 Intel/AMD 64 位电脑，ARM64 用于 Windows on ARM。Setup.exe 为当前用户安装，不要求先装 Node.js、DevEco Studio 或开发工具。
3. ZIP 需完整解压后打开其中的智云助手程序，保留同目录的运行时和资源文件。ZIP 仍使用系统用户的数据目录，不是把资料保存在压缩包旁的便携数据模式。
4. 首次阅读隐私说明，然后通过浙江大学官方登录窗口登录智云课堂。验证码、二次认证等由用户在官方页面完成。

当前安装包尚无发布者代码签名。若系统或安全软件阻止文件，请先核对仓库、架构与 SHA256；不要为安装它整体关闭系统防护。

PowerShell 校验示例（文件名以当前 Release 为准）：

~~~powershell
Get-FileHash '.\ZhiyunAssistant-0.8.0-beta.1-Windows-x64-Setup.exe' -Algorithm SHA256
~~~

## 日常学习

我的课堂包含今日、近两周和全部修读记录，全部可按课程或日期查看。课程广场支持课程/教师搜索及结果筛选。收藏、稍后再看和学习进度分别保存；进入课程、视频及下载仍会检查当前官方权限，缓存不替代权限。

课件与转写按时间对应。连续相邻的相同课件可以合并，A-B-A 不合成一页；去黑边保留原图以便关闭恢复。概览、单独全屏图片、跳转时间及页数用于定位。课件或本页速览开启时按课件分页显示转写；两者都关闭或没有课件时以连续转写阅读。

视频由用户主动打开，支持播放/暂停、0.1–16 倍速、进度拖动和全屏。只列出实际取得的画面源。直播回放取决于官方提供的可寻址录像或 DVR，平台不提供的历史内容不会被补造。

功能区可以拖动、从四边四角缩放、调层级、锁定并显式保存布局。多篇笔记可记录文字、图片及转写/AI 引用，在原光标处插入，引用保留时间点与来源。笔记支持重命名、来源颜色、常用文字格式和 Markdown/HTML/纯文本导出；多篇按课程与日期打包。清理对应 AI 缓存后，引用内容仍保留在笔记中，跳回原记录会说明缓存已清理。

下载可以选择课件、转写与视频，支持队列、同时下载数量、单节暂停/继续及失败重试。离线资料和普通缓存分开管理；保存可用内容会说明缺失项目。素材是否齐全及视频编码能否离线播放以平台内容和验证结果为准。

## 键鼠与输入

- 普通输入框使用原生输入，支持数字、复制、粘贴与中文输入法。
- 课程问答：**Enter 发送，Shift＋Enter 换行**；中文输入法候选确认不发送。
- 视频获得焦点后：空格播放/暂停，左右键各跳转 15 秒。
- 课件等功能区获得焦点后：左右键翻页；正文支持原生鼠标与触控板拖选。
- Ctrl+A 根据所在的输入框、笔记块或问答块选择；笔记或问答正文内重复全选可扩展到整篇。Ctrl+C/V 使用系统剪贴板。
- 图片可通过本机文件选择、拖入文件或系统摄像头拍摄插入笔记。

实体触控板、触摸屏、中文输入法、屏幕缩放与多屏的完整验收仍需要对应 Windows 环境。鸿蒙互联手机拍照、图库与文档扫描没有宣称已经在 Windows 完整等价实现；系统可提供的摄像头是另一种能力。

## AI 与本机资料

API 密钥由用户自行在 DeepSeek 开放平台取得，保存、验证、更换或删除均在应用内完成；源码没有内置调试密钥。课程问答默认按需参考课件，可选择课件和上下文范围；本页速览支持本页、前文、本节整课及关联课次等范围。直播当前页通常由用户主动生成，已讲完页按所选模式生成和缓存。无实质讲解分析为可选功能，会提示额外用量。

问题和相关课程资料发送至 DeepSeek。密钥、身份及会话由桌面主进程通过系统安全存储保护；渲染界面没有任意文件读取、Node.js 或密钥读取权限。识图与稳定材料缓存用于减少重复请求，实际费用以 DeepSeek 计费为准。

数据位于当前系统用户的 Electron 应用数据目录。笔记、离线课程、收藏和进度按账号隔离；普通缓存有分类开关、详情与清理功能。明确退出登录清除登录会话，断网本身不主动注销身份。卸载当前配置保留用户资料，若要删除学习资料请先备份后在应用内管理。

## 从源码构建

开发需要 Node.js 22 和 npm；普通安装用户不需要它们。首次安装依赖会下载锁定的 Electron 运行时。请使用提交中的 package-lock.json。

在此目录执行：

~~~sh
npm ci
npm run check
npm test
npm run build
npm run test:e2e
~~~

生成 Windows x64 与 ARM64 安装包及 ZIP：

~~~sh
npm run dist:win
~~~

交叉构建出的 EXE 不能在 Mac 上执行。Mac 上运行 Electron 仅用于迁移逻辑和界面检查，不把其产物冒称为此前原生 Mac 版。

打包审计示例：

~~~sh
node scripts/package-audit.cjs --dir release/win-unpacked --arch x64 --report work/package-audit-x64.json
node scripts/package-audit.cjs --dir release/win-arm64-unpacked --arch arm64 --report work/package-audit-arm64.json
~~~

原生 CI 配置会分别在 x64 与 ARM64 Windows 运行器执行检查、构建、包审计、中文含空格路径安装、已安装应用启动烟测及卸载；两个架构都成功后，版本 Tag 的工作流才上传预发布包。查看 [Actions](https://github.com/5zhangxuanhao5/ZhiyunAssistant/actions)，未运行或失败的任务不能记作通过。x64 CI 使用 Windows Server 2025，不等同 Windows 10/11 每种显卡与外设已经实测。

## 已知验收边界

Windows 用户机器的真实校园登录、全部教室直播、付费 DeepSeek 请求、显卡硬件解码、休眠/弱网、DPI、多屏及长时间高负载还需要进一步验证。合成课堂和自生成 MP4/HLS 的自动检查可定位程序行为，但不代替这些现场路径。发现问题时请记录版本、系统与架构、具体操作和错误提示，并对截图与日志中的个人及课程信息做模糊处理。

项目元数据采用 UNLICENSED，当前没有新增本项目 MIT 许可证。第三方信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
