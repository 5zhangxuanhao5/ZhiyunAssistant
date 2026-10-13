# 第三方组件与外部服务

## hls.js 1.6.19

来源：https://github.com/video-dev/hls.js/tree/v1.6.19

用途：本地 Web 播放器解析官方提供的 HLS 视频。库随安装包提供，不从第三方 CDN 动态加载；没有广告或分析 SDK。播放器有本项目的网络桥接与离线加载适配。

版权声明：entry/src/main/resources/rawfile/HLS_LICENSE.txt。完整许可：entry/src/main/resources/rawfile/APACHE_LICENSE_2_0.txt。

## 外部服务（不是第三方 SDK）

- 浙江大学统一身份认证及智云课堂：官方登录、用户有权限的课表、课件、转写和视频。
- DeepSeek 开放平台：用户主动配置 API Key 并启用问答或速览时，发送对应课程上下文；关闭功能后停止生成。费用由用户 API 账户承担。
- 鸿蒙系统 SDK：文件选择器、相册、相机、设备互联与隐私管理。发布时按实际用途配置隐私声明。

本次补丁升级到同一 1.6 分支的 1.6.19，npm 官方包完整性 SHA-512 已核对。核查日 2026-10-10，项目安全页面未列公开安全公告；这不替代正式发布前的漏洞测试。
