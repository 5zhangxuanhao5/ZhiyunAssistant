# 鸿蒙版安装说明

智云助手 0.7.4，手机和平板共用。最低 HarmonyOS 6.1.1 / API 24，开发构建使用 API 26 SDK。本版本尚未在华为应用市场正式上架；备案、授权材料、发行签名与审核流程尚待完成，现阶段提供开发者自行签名安装的方式。

**开发者模式 + 自己设备的调试签名 + 安装工具，三者都需要。** 下载的 `unsigned.hap` 不包含作者的签名或设备列表，不能直接点开安装，也不能仅开启开发者模式就安装。华为要求应用先签名，调试 Profile 与设备绑定，详见[应用签名要求](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/experience-suggestions-security-debug-V5)及[申请调试 Profile](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-debug-profile-0000002248181278)。

## 推荐：用 DevEco Studio 从源码安装

1. 下载并完整解压 `ZhiyunAssistant-HarmonyOS-0.7.4-PublicSource.zip`，安装[华为官方 DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/)，在 IDE 内安装支持 API 26 的 HarmonyOS SDK。
2. 在手机或平板的“设置 → 关于本机”连续点击软件版本号，按系统提示开启开发者模式；进入开发者选项开启 USB 调试。系统菜单因版本而异，按[华为开启开发者选项说明](https://consumer.huawei.com/cn/support/content/zh-cn02842747/)操作。USB 连接电脑后，在自己的设备上允许调试连接。
3. 将工程中的 `build-profile.example.json5` 复制为 `build-profile.json5`，用 DevEco Studio 打开工程文件夹。
4. 在 `File → Project Structure → Signing Configs`（中文界面为项目结构/签名配置）登录自己的华为开发者账号，为当前设备配置自动调试签名。签名材料与设备信息保留在自己的电脑上，无须提交到本仓库。
5. 确保 Profile 的包名与 `AppScope/app.json5` 的 `bundleName` 一致，并包含当前设备。如果自己的账号无法为原包名签名，改为自己账号下的包名，重新配置签名并从源码构建；仅改 HAP 文件名不会改变应用包名或签名。
6. 选择 `entry` 模块与连接的手机/平板，点击 Run。IDE 会构建、签名并安装。初次进入需阅读隐私说明；校园账号只在自己的应用内登录，API 密钥由本人配置。

## 已有签名材料：安装自行签名后的 HAP

未签名 HAP 可使用 SDK 自带的 `hap-sign-tool.jar` 配合自己的合法调试证书、私钥库和 Profile 签名。Profile 必须匹配包名、证书及设备，保留默认代码签名；不要关闭校验或修改设备限制。具体参数以 SDK 工具帮助与[华为签名配置说明](https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/ide-hmos-hvigor-build-profile-app)为准。不了解这些材料时，使用上面的源码自动签名路线。

把 SDK 的 `toolchains` 目录加入终端 PATH。**以下命令只能使用已签名的包，不是发布页中的 unsigned.hap。**

```sh
hdc list targets
hdc install -r entry-default-signed.hap
```

有多台设备时，指定自己的连接标识：

```sh
hdc -t YOUR_DEVICE_CONNECT_KEY install -r entry-default-signed.hap
```

SDK 工具或 DevEco Studio 界面显示的连接标识不等同于调试 Profile 中的 UDID。不要把设备标识、Profile、证书、私钥、校园密码或 API 密钥发到公开 Issue。

## 常见问题

- **未签名/代码签名校验失败**：确认安装的是完成签名后的 HAP，使用最新配套 SDK 重新签名。
- **设备未获授权**：确认自己设备已加入调试 Profile，签名后再安装。不能拿作者其他设备的测试包直接安装。
- **系统版本不兼容**：本包最低 API 24；HarmonyOS 4、Android APK 安装器及轻量级穿戴设备不适用。
- **同包名无法覆盖安装**：新旧版本的签名也需兼容。更换包名会成为独立应用；更换证书可能无法直接覆盖旧版。先导出重要笔记，不要为解决签名问题直接删除原有资料。
- **开发者模式仍提示无法安装**：开发者模式不是签名豁免。按[华为安装错误说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/bm-tool-V5)核对错误码与签名。

本发布提供自行签名用的 HAP、源码和 SHA256 校验值，不是免签名的一键安装包，也不宣称已完成商城审核。首次尝试建议使用源码与 DevEco Studio。后续若具备正式分发条件，将另行公布正式安装渠道。
