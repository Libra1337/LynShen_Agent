# 0.4.18 修复与验证

- 修复新项目先写入原始对象而非 Svelte 代理，导致新会话显示“该对话已关闭”。
- 合并重复默认工作区，保留聊天标签、项目、当前布局和用户命名工作区；迁移前备份原文件。
- 多客户端默认工作区使用一致的 ID，防止重连再次增加默认工作区。
- Windows 从系统目录启动时使用用户目录作为默认项目路径。
- 账户授权弹窗移至设置页公共层；点击授权立即启动浏览器流程。
- 退出账户后关闭设置并回到欢迎页；撤销失败时保留账户状态以供重试。
- 修复 API Key 占位符缺失，补齐中英文文本。
- 提供 ChatGPT/Codex 与 Claude 浏览器 OAuth 入口，独立进程授权，取消时结束进程；不启动草稿引擎。
- 新增账户密钥专用模型目录接口，使用实际路由、定价及密钥绑定解析分组。
- 模型广场、设置和聊天选择器显示模型及分组；请求仍使用原始模型 ID。
- 更新安装继续使用 LynShen/Monoize 下载源、签名验证和安装前保存工作区。
- 本地准备的 CI 工作流包含 macOS Apple Silicon、Intel、Windows、Linux；增加真实浏览器回归。

## 验证

Svelte 检查零错误。592 项前端单测通过。桌面 Rust 114 项单测及网关集成测试通过。
浏览器回归通过：连续新项目、新会话、草稿不启动引擎、账户页打开授权、退出、API Key 文案及提供商 OAuth 入口。
Monoize Linux 模型分组路由测试及 3 项设备授权测试通过。
CLI 647 项库单测、8 项托管引擎集成及 11 项其他集成测试通过；clippy 通过。
CLI 完整 Windows 测试仍有 11 项 daemon 集成失败，涉及 Unix 假进程脚本、命令及路径假设；不宣称完整套件通过。
第三方账号最终授权需要用户在浏览器完成，未代替用户登录订阅账户。

## 发布

此文件记录源代码改动；构建、CI 与线上部署状态以实际完成结果更新。
2026-10-06 已完成 GitHub workflow 权限授权；完整工作流已可推送。
更新通过以下 PR 审查：
- Desktop: https://github.com/Libra1337/LynShen_Agent/pull/1
- CLI: https://github.com/Libra1337/LynShen-CLI/pull/1

Windows 安装包已在本地构建并验证文件与元数据签名：
- 文件：`src-tauri/target/release/bundle/nsis/LynShen_0.4.18_x64-setup.exe`
- SHA-256：`d1dc440c82c7191f942db747709532ff33341ecaedfb496969e24a3b9ac7dac2`
- CLI 来源：`1a9baa20e314c8e809d9730e60e036a89bba071f`，从干净源码构建。

GitHub CI 生成的 Windows 安装包已独立下载并验证文件及元数据签名：
- SHA-256：`e871a577464209293c0281395a2a8d80104bc173f3b9aa7e35da7a888ca155ac`
- 大小：11,500,089 字节。
- 与本地构建的哈希不同；线上分发使用 CI 构建产物。

远程验证：
- Desktop 四平台 CI 和浏览器回归通过：https://github.com/Libra1337/LynShen_Agent/actions/runs/37412326591
- CLI Linux 格式、clippy、完整测试及 Windows 编译通过：https://github.com/Libra1337/LynShen-CLI/actions/runs/37411470402
- macOS 无 Apple 证书时使用 ad-hoc 签名，自动更新产物另行使用 Tauri 更新密钥签名；尚未进行 Apple 公证。

Windows、macOS Apple Silicon、macOS Intel 和 Linux 由发布工作流构建，全部成功后才发布完整目录及自动更新。发布前每个平台运行桌面 Rust 测试和 clippy。
2026-10-06 12:43（UTC+8），0.4.18 已正式发布并同步至两个公网域名。
发布任务成功：https://github.com/Libra1337/LynShen_Agent/actions/runs/37412643714
下载页：https://www.lynshen.org/download 和 https://api.lynshen.org/download
两个域名的目录及自动更新清单均为 0.4.18，包含 Windows x64、macOS Apple Silicon 和 macOS Intel。
三个安装包均通过公网下载 SHA-256 校验；对应更新包均通过文件和元数据签名验证；HEAD 与 byte-range 下载检查通过。
- macOS Apple Silicon DMG SHA-256：`3fb9aa9d602502414bd03e6da838854a2f0c74fa30d19c7d353be9972a0789fd`
- macOS Intel DMG SHA-256：`c3d529000ca61a4e4535661e2726f7414021d8269a4258123d804d315821c1b1`

2026-10-06 13:05（UTC+8），两个域名的匿名浏览器检查均显示 0.4.18 和三个正确下载链接。
修复账户检查清空公开下载目录缓存的问题；新增缓存回归及真实浏览器测试均通过。
修复镜像 `desktop-download-0418-ef7cdfc8` 已通过隔离检查并接收新连接，旧实例仍保留 5 条连接自然排空。
Monoize 镜像 `desktop-0418-fe561f25` 已通过隔离检查。2026-10-05 20:07 UTC，两个公网域名的模型目录均返回 200，43 个模型中 34 个可用，可用项均带有分组。
2026-10-06 11:09（UTC+8），蓝绿切换成功完成；旧连接自然结束，没有强制终止连接。
