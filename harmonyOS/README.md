## 0.7.6：照片式课件缩放

双击课件全屏后，双指缩放围绕手指位置进行，连续捏合保留倍率；放大后可双向拖动。根据实际图片比例约束边界，缩回适合屏幕后恢复左右翻页；全屏查看不改变视频、转写的学习位置。

# 智云助手 · HarmonyOS

## 2026-10-19 校内 AI / OCR 默认接入

新版安装包在没有个人 API 时默认使用校内 DS 与校园 OCR；已配置个人 DeepSeek API 时优先个人服务。首次调用会提示校园网要求、效果可能不佳，以及校内服务使用期限截至 **2026 年 11 月 1 日**；想获得更佳效果可自行配置个人 DeepSeek API。校内模式先用 OCR 提取课件，可能遗漏图示关系或误识公式、表格。

构建只注入两项校内服务凭据，不包含开发者的个人 API、校园登录、聊天、笔记、学习记录或下载资源。普通源码不包含凭据，仍可构建个人 API 版本。详见[校内服务与构建](../docs/CAMPUS_AI.md)。以下历史验证与版本说明仅对应其标注版本，不代表本轮已完成同等真机验收。


0.7.4，版本代码 31。原生 ArkTS/ArkUI 应用，手机和平板使用同一工程，支持平板多窗及电脑模式。安装包最低要求 HarmonyOS 6.1.1 / API 24，目标 SDK 为 API 26；此前在 HarmonyOS 7 手机和平板上进行过测试。

应用市场上架需要备案、授权材料、发行签名和审核，目前尚未完成，因此先在 GitHub 提供开发者自行签名安装的版本。**开启开发者模式之后，仍须为自己的设备配置合法的调试签名。** 未签名 HAP 无法直接安装，现有测试设备的签名也不能供其他设备通用。参见[华为应用签名要求](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/experience-suggestions-security-debug-V5)。

## 下载与安装

前往[鸿蒙版发布页](https://github.com/5zhangxuanhao5/ZhiyunAssistant/releases/tag/harmony-v0.7.4-preview)。

- `ZhiyunAssistant-HarmonyOS-0.7.4-PublicSource.zip`：完整、无私人签名材料的工程，推荐通过 DevEco Studio 配置自己的自动签名并运行。
- `ZhiyunAssistant-HarmonyOS-0.7.4-unsigned.hap`：已编译的未签名 HAP，供已有合法签名材料的开发者自行签名；不能直接安装。
- `HarmonyOS-Installation.md`：开发者模式、签名和 HDC 安装步骤。
- `SHA256SUMS.txt`：下载文件校验值。

详细步骤见[安装说明](INSTALLATION.md)。不分发作者的私钥、证书、Profile、设备 UDID 或商城上传包。

## 功能

课表与课程搜索、收藏和稍后再看、课件去黑边及连续重复页合并、时间线转写、可选视频及倍速、自由布局、课堂笔记及导出、离线下载及缓存管理、课程问答、本页速览和可选的无实质讲解分析。

在线资源按当前校园账号的官方权限访问。直播历史仅在平台实际提供时获取。AI 需要用户自行配置 DeepSeek 密钥，启用后相应问题和课程材料会发送给 DeepSeek。

## 构建与检查

1. 将 `build-profile.example.json5` 复制为 `build-profile.json5`，使用支持 API 26 的 DevEco Studio 打开此目录。
2. 在 DevEco Studio 配置本人的 SDK 和调试签名，选择 `entry` 模块及已连接设备。
3. 通过 IDE 的 Run 构建、签名并安装。正式发行签名、商城提交和个人调试签名用途不同。

不依赖鸿蒙设备的模型与服务回归可运行：

```sh
npm ci
npm test
```

测试用例使用合成资料；374 项回归不等于全部触控、键鼠、教室媒体和设备型号已验收。SDK 编译与真机检查仍需 DevEco Studio 和相应设备。测试依赖单独锁定，不成为鸿蒙应用的运行依赖。

公开源码不含私人账号、密钥、会话、笔记或真实课程原文。构建输出、签名配置和本机 SDK 路径已忽略。源码沿用仓库现有授权状态，未另行添加 MIT 等本项目许可证；第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
