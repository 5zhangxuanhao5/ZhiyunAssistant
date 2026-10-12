# 原生 Mac 版的分发与核验

这里保存的是此前独立开发的 **智云助手 Mac 1.0.0（build 1）**。其实现为 Swift、AppKit 与系统 WebKit，Bundle ID 为 cn.suike.slides.mac，最低 macOS 13。安装包包含 x86_64 与 arm64，不是 Windows 工程的 Electron Mac 构建。

## 下载与安装

从本仓库 [Releases](https://github.com/He-He-He-He-He-He/ZhiyunAssistant/releases) 下载以下公开分发文件：

- ZhiyunAssistant-Mac-1.0.0.dmg：原磁盘镜像，只读扫描后保留。
- ZhiyunAssistant-Mac-1.0.0-PublicApp.zip：去除 AppleDouble 和扩展属性归档元数据的安装 ZIP，应用内每个文件的字节保持原样。
- ZhiyunAssistant-Mac-1.0.0-PublicSource.zip：独立构建的公开源码包，包含浏览器模型与锁定的开发测试依赖；不需要相邻鸿蒙源码或 DevEco。

DMG 打开后将智云助手拖入 Applications；PublicApp ZIP 使用 macOS 自带工具完整解压。已发布 DMG 与 PublicApp ZIP 的应用字节和版本保持原样。公开源码的构建依赖于 2026-10-13 修正，并在独立输出目录重新编译验证；该验证产物没有替换公开安装包。原安装 ZIP 和原源码 ZIP 没有作为本次公开附件；原始交付文件保留在原工程中。

本次公开文件的 SHA256：

| 文件 | SHA256 |
| --- | --- |
| ZhiyunAssistant-Mac-1.0.0.dmg | a7ee18a0197db3a9e86cd0b459200510cb982dc054b778c9b94112bf687c9b21 |
| ZhiyunAssistant-Mac-1.0.0-PublicApp.zip | f07a4fe6180cbf75cc3d5511e359fcbb54bdffaaca9b1e52abb732ddfcb81d01 |
| ZhiyunAssistant-Mac-1.0.0-PublicSource.zip | 以同一发布页附件 SHA256SUMS.txt 中的值为准 |

PublicApp 解压后重新通过 codesign --verify --deep --strict；应用二进制、Web 资源和签名文件与原包一致。PublicSource 的校验值是新值；不能将它冒称为此前原源码 ZIP 的哈希。SHA256SUMS.txt 仅列本次公开的三个文件。

## 实际验证

2026-10-12 核验：

- codesign --verify --deep --strict 的包完整性检查通过；DMG 校验通过，两个 CPU 架构均存在。
- 原 19 项合成行为回归再次全部通过；应用中的 Web 资源与原工程对应；本次公开源码只整理分发说明和构建日志，未修改应用程序实现。
- 此前原生 Mac 任务记录了当前 Apple Silicon Mac 上真实有权限课程的课件/转写读取、视频时间推进、键盘暂停和跳转及重启后恢复身份。
- Intel 是构建检查；没有记录 Intel 机器上的实际运行验收。

2026-10-13 公开源码自包含核验：

- 从公开源码执行 `npm ci`、全部 16 个模型的本地模块导入及导出绑定验证、原 19 项合成回归，全部通过；缺失模型、空模型与无效导出绑定会明确失败。
- 公开 `build.sh` 在独立目录实际生成 x86_64/arm64 Universal 应用，`codesign --verify --deep --strict` 与 Info.plist 检查通过。源码和测试不再读取私人工程或工作目录中的依赖。
- 发布 DMG 与 PublicApp ZIP 的 SHA256 再次核对，保持上述原值。Source ZIP 只包含公开源码、锁文件及必要说明，不包含依赖安装目录、构建产物或本机日志。

本包为 ad-hoc 签名，没有 Apple Developer ID 发布者签名或公证票据。因此它作为预览试用包提供，不应宣传为“所有 Mac 都通过 Gatekeeper”或已正式上架。请核对下载来源，不要为试用它关闭系统整体安全检查。

## 源码及平台能力

本目录保留原应用实现和已生成的浏览器模型；构建与测试依赖已经整理为自包含源码。构建方法与原功能说明见 [README.md](README.md)；测试所需 jsdom 是开发依赖，不随应用打包。

Mac 与 Windows 分别保存本机资料，没有自动同步。原版支持的系统文件、WebKit 播放、键盘和窗口能力与鸿蒙平台不同；鸿蒙互联设备拍照/扫描及全套跨应用拖拽没有宣称已完整等效。完整教室直播、独立音轨 HLS、所有机位和付费 AI 仍需逐类验证。
