# 鸿蒙公开分发检查

2026-10-13，0.7.4 / versionCode 31。

- 从公开目录的源码重新执行 DevEco SDK API 26 的 release HAP 构建，34 项构建任务全部执行，ArkTS 编译与 PackingCheck 通过。
- 公开配置没有 signingConfigs；构建明确报告未配置签名，产物为 unsigned HAP。未把作者的调试 Profile、两台测试设备标识或私人证书打包。
- 独立安装锁定的 TypeScript 测试依赖后，374 项模型、服务及源码回归全部通过，失败、取消、跳过均为 0。此结果不代替全套真机 UI 和硬件验收。
- HAP 的 module.json 为 cn.suike.slides，0.7.4，设备类型 phone/tablet，最低 API 24、目标 API 26，release / debug=false。仅声明 INTERNET 权限，系统选择器交互由对应系统组件处理。
- 发布前检查源码、HAP 的全部资源与程序字节，排除校园凭据、API 密钥、登录会话、个人资料、私钥、设备绑定 Profile、私人路径和构建日志。保留本项目图标、合成演示资源及第三方许可证。
- 通过 Git 受控文件生成独立源码 ZIP，排除 node_modules、oh_modules、build、.hvigor、本机 SDK 路径及实际签名配置。使用示例配置自行构建。

本次发布未为其他人的设备签名，也未在其他人的设备上安装。现有手机和平板的签名不能通用于所有下载者；需要按[安装说明](INSTALLATION.md)在自己的电脑和设备上配置调试签名。此前的真机测试范围与剩余未验收场景在 README 中说明。

发布页提供 SHA256SUMS，方便核对 HAP、源码 ZIP 和独立安装说明。未上传正式商城 APP 包、证书链、私钥或签名工具本体。
