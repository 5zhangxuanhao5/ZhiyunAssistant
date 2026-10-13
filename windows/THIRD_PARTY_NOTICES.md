# 第三方组件与通知

本项目未新增 MIT 或其他项目级开源授权。下列许可证是第三方组件自身的声明，不构成本项目原创代码的新许可证。

## 生产依赖与传递依赖

下表逐项覆盖本次 package-lock.json 中 dev 为 false 或未标注 dev 的 21 个依赖，包含传递依赖与可选类型声明。实际业务模块由构建工具按使用情况打包；保留完整生产依赖通知，不因此宣称每个模块都在运行时执行。各组件现有许可与版权原文保存在 third_party；版本、文件来源和内容 SHA256 可核对 [生产许可清单](third_party/production-manifest.json)。

| 组件 | 版本 | 组件声明的许可证 | 许可原文目录 |
| --- | --- | --- | --- |
| @types/trusted-types | 2.0.7 | MIT | [third_party/@types__trusted-types](third_party/@types__trusted-types) |
| core-util-is | 1.0.3 | MIT | [third_party/core-util-is](third_party/core-util-is) |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) | [third_party/dompurify](third_party/dompurify) |
| hls.js | 1.6.19 | Apache-2.0 | [third_party/hls.js](third_party/hls.js) |
| immediate | 3.0.6 | MIT | [third_party/immediate](third_party/immediate) |
| inherits | 2.0.4 | ISC | [third_party/inherits](third_party/inherits) |
| isarray | 1.0.0 | MIT | [third_party/isarray](third_party/isarray) |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) | [third_party/jszip](third_party/jszip) |
| lie | 3.3.0 | MIT | [third_party/lie](third_party/lie) |
| marked | 16.4.2 | MIT | [third_party/marked](third_party/marked) |
| pako | 1.0.11 | (MIT AND Zlib) | [third_party/pako](third_party/pako) |
| process-nextick-args | 2.0.1 | MIT | [third_party/process-nextick-args](third_party/process-nextick-args) |
| react | 19.3.0 | MIT | [third_party/react](third_party/react) |
| react-dom | 19.3.0 | MIT | [third_party/react-dom](third_party/react-dom) |
| readable-stream | 2.3.8 | MIT | [third_party/readable-stream](third_party/readable-stream) |
| safe-buffer | 5.1.2 | MIT | [third_party/safe-buffer](third_party/safe-buffer) |
| scheduler | 0.28.0 | MIT | [third_party/scheduler](third_party/scheduler) |
| setimmediate | 1.0.5 | MIT | [third_party/setimmediate](third_party/setimmediate) |
| string_decoder | 1.1.1 | MIT | [third_party/string_decoder](third_party/string_decoder) |
| util-deprecate | 1.0.2 | MIT | [third_party/util-deprecate](third_party/util-deprecate) |
| ws | 8.22.0 | MIT | [third_party/ws](third_party/ws) |

isarray 没有单独的 LICENSE 文件，其完整 MIT 许可包含在上游 README 中，现以 LICENSE-in-upstream-README.md 原样保留。pako 根目录 MIT LICENSE 和 lib/zlib/README 中的 Zlib 许可、版权说明均原样保留。许可中的第三方作者署名与公开联系方式属于原始版权通知，不是本应用的用户账户资料。

## 桌面运行时、构建与测试工具

以下为 Electron 运行时及锁定的主要构建/测试工具；普通用户无需另行安装它们。

| 组件 | 版本 | 组件声明的许可证 | 许可原文目录 |
| --- | --- | --- | --- |
| electron | 44.7.0 | MIT | [third_party/electron](third_party/electron) |
| electron-builder | 26.15.6 | MIT | [third_party/electron-builder](third_party/electron-builder) |
| typescript | 5.9.3 | Apache-2.0 | [third_party/typescript](third_party/typescript) |
| tsx | 4.20.6 | MIT | [third_party/tsx](third_party/tsx) |
| esbuild | 0.25.11 | MIT | [third_party/esbuild](third_party/esbuild) |
| @playwright/test | 1.56.0 | Apache-2.0 | [third_party/@playwright__test](third_party/@playwright__test) |

Electron 捆绑 Chromium、Node.js 和其他运行时依赖。发行包内 Electron 原有 LICENSE.electron.txt 和 LICENSES.chromium.html 由打包工具一并保留，未将整个 vendor 目录重复复制到应用。上表的构建/测试工具不是所有开发传递依赖的清单，开发环境仍须遵循安装模块自身的许可证。

React/ReactDOM 用于界面，hls.js 用于 HLS 播放，JSZip 用于导出打包，ws 用于实时连接；marked 与 DOMPurify 用于格式解析和清理。JSZip 的压缩、流和异步工具依赖及 React 的 scheduler 等通知也包含在生产依赖表中。

## 系统与远程服务

Windows 系统凭据、摄像头、文件对话框与剪贴板遵循系统权限。校园认证和智云课堂由学校运营；DeepSeek 为用户主动启用的远程模型服务，不是内置密钥或随包分发的模型。

Mac 原生版使用系统 AppKit、WebKit、Network、Security、CryptoKit 与 Vision 框架，其原第三方说明保留在 [macOS/THIRD_PARTY_NOTICES.md](../macOS/THIRD_PARTY_NOTICES.md)，没有改成 Electron Mac 包。

课程文本、图片与视频不作为本项目发行素材。课程访问和下载以平台实际返回的权限和可用内容为准。
