# macOS 预览版本分发

Mac 1.6.0（构建 9）为 universal 应用，最低 macOS 13。GitHub 提供 DMG、应用 ZIP、独立源码 ZIP 和 SHA256SUMS.txt。

使用 ad-hoc 签名，并在构建后执行 `codesign --verify --deep --strict`。当前没有 Developer ID 发行证书和 Apple 公证记录，不以此包宣称已完成 Mac App Store 或正式公证分发。

学校登录使用持久化 WebKit 会话与官方认证续接；“恢复登录”不会请求交互式钥匙串权限。旧登录条目无法静默迁移或学校会话过期时，需要在学校官方页面登录一次。DeepSeek 密钥仍由钥匙串独立保护，只有主动点击“恢复已保存的密钥”才请求密钥恢复授权。升级身份稳定性仍需正式开发者签名，依据 [Apple 的签名要求说明](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)。

公开包仅包含程序、图标、界面与共享模型。测试数据为人工合成，源码和安装包不包含课程截图、实际转写、用户身份、Cookie、API 密钥、签名私钥或本机资料目录。

安装时通过 DMG 把应用拖入 Applications。更新前正常退出旧应用，覆盖安装后再次打开；旧版本本机资料会保留。若系统安全检查阻止打开，核对 SHA256 后在系统“隐私与安全”使用系统提供的允许选项，勿整体关闭 Gatekeeper。

正式发行签名和公证需要开发者自己的 Apple Developer 身份，不能将私人证书或密钥提交到仓库。
