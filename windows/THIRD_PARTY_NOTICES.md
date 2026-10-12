# 第三方组件与通知

本项目未新增 MIT 或其他项目级开源授权。下列许可证是第三方组件自身的声明，不构成本项目原创代码的新许可证。

## 锁定依赖

以下版本来自本次 package-lock.json 对应的已安装模块。实际交付以该提交中的锁文件及打包文件为准；版权、许可证与 NOTICE 原文保存在 third_party 目录。

| 组件 | 版本 | 组件声明的许可证 | 许可原文目录 |
| --- | --- | --- | --- |
| electron | 44.7.0 | MIT | [third_party/electron](third_party/electron) |
| react | 19.3.0 | MIT | [third_party/react](third_party/react) |
| react-dom | 19.3.0 | MIT | [third_party/react-dom](third_party/react-dom) |
| hls.js | 1.6.19 | Apache-2.0 | [third_party/hls.js](third_party/hls.js) |
| marked | 16.4.2 | MIT | [third_party/marked](third_party/marked) |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) | [third_party/dompurify](third_party/dompurify) |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) | [third_party/jszip](third_party/jszip) |
| ws | 8.22.0 | MIT | [third_party/ws](third_party/ws) |
| electron-builder | 26.15.3 | MIT | [third_party/electron-builder](third_party/electron-builder) |
| typescript | 5.9.3 | Apache-2.0 | [third_party/typescript](third_party/typescript) |
| tsx | 4.20.6 | MIT | [third_party/tsx](third_party/tsx) |
| esbuild | 0.25.11 | MIT | [third_party/esbuild](third_party/esbuild) |
| @playwright/test | 1.56.0 | Apache-2.0 | [third_party/@playwright__test](third_party/@playwright__test) |

Electron 包含 Chromium、Node.js 与其他依赖，发行包内原有 LICENSE.electron.txt 和 LICENSES.chromium.html 应随其运行时保留。上表不是其传递依赖的完整清单；这些运行时通知和各组件原始文件共同构成对应依赖说明。

React/ReactDOM 用于界面，hls.js 用于 HLS 播放，JSZip 用于导出打包，ws 用于实时连接；marked 与 DOMPurify 为已锁定的安全格式化依赖。构建和回归依赖不作为业务运行环境要求，普通用户无需自行安装它们。

## 系统与远程服务

Windows 系统凭据、摄像头、文件对话框与剪贴板遵循系统权限。校园认证和智云课堂由学校运营；DeepSeek 为用户主动启用的远程模型服务，不是内置密钥或随包分发的模型。

Mac 原生版使用系统 AppKit、WebKit、Network、Security、CryptoKit 与 Vision 框架，其原第三方说明保留在 [macOS/THIRD_PARTY_NOTICES.md](../macOS/THIRD_PARTY_NOTICES.md)，没有改成 Electron Mac 包。

课程文本、图片与视频不作为本项目发行素材。课程访问和下载以平台实际返回的权限和可用内容为准。
