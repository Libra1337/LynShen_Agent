# LynShen / Monoize 下载与自动更新

官网下载页为 `https://www.lynshen.org/download`。桌面更新优先访问
`https://www.lynshen.org/v1/public/releases/desktop/latest.json`，连接失败时访问
`https://api.lynshen.org/v1/public/releases/desktop/latest.json`。
GitHub 仓库现已公开；客户端仍以官网作为下载与更新源。
构建和签名在 GitHub Actions 或本地完成，文件存储和下载由 Monoize 提供。

## 客户端行为

- 启动约 5 秒后检查，此后每 10 分钟检查；手动检查不自动下载，强制更新除外。
- 自动下载并校验 Tauri 签名，用户选择「重启并安装」后才执行安装器。
  Windows 安装器会退出进程，因此必须先保存工作区，不能后台自动调用。
- 待安装的包保存在当前进程内存中；选择「稍后」后仍可在设置里安装。
  若直接关闭应用，下次启动会重新检查和下载。
- 下载失败时从下一来源重试同一版本；换源时进度从零重新计算。
- 正常返回「无更新」的主源具有优先权。只有错误才切换备用源。
- `policy` 的 `min_version` 控制最低版本；网络不可达时不锁定客户端。
- `~/.lynshen/config.json` 的 `desktop_update_url` 可覆盖更新服务根地址；
  未设置时使用 `lynshen_api_url`，再回退到默认官网。更新 URL 必须使用 HTTPS。
- 配置中的 updater `endpoints` 是唯一备用源列表，Rust 不再硬编码旧仓库地址。

0.4.16 及以前的错误更新源不能自动找到本次修复，需从官网下载一次新安装包。
后续版本通过官网更新。

## Monoize 接口和存储

Monoize 仓库的 `spec/desktop-distribution.spec.md` 定义接口。
默认目录为 `data/desktop-releases`，可由 `MONOIZE_DESKTOP_RELEASE_DIR` 覆盖：

```text
desktop-releases/
  latest.json      # Tauri 更新清单，URL 为 HTTPS，保留原始签名
  catalog.json     # 官网安装包清单，使用同源相对 URL，附 SHA-256
  policy          # {"min_version":""}，由维护者按需修改
  0.4.17/         # 不可变版本目录，安装包、更新包、.sig
```

访问路径为 `/v1/public/releases/desktop/<文件路径>`，不需要登录，支持 HEAD 和 Range。
缺失文件返回 404，不回退到官网 HTML。只同步发布目录，不需要重启 Monoize 或 Caddy。
网站首次增加分发接口仍需通过已有蓝绿流程发布新 Monoize 程序。

当前主机：`40.160.141.21`。运行中的容器把主机
`/opt/migration-20260930/final/runtime/opt/monoize/data` 挂载到 `/app/data`。
部署前重新检查挂载信息，不假定其他环境相同。

## 跨平台构建

Release 和 CI 覆盖 Windows x64、macOS Apple Silicon、macOS Intel、Linux x64。
手动运行 Release 会构建所有平台并上传 Actions artifacts，不创建 Release。
CLI 来源固定在 `src-tauri/lynshen-cli.ref` 的提交，版本必须匹配
`src-tauri/lynshen-cli.version`，不能直接追踪可变的 main。

发布步骤：

1. 同步 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 Cargo.lock 的版本。
2. 需要升级 CLI 时更新 ref 和 version。
3. 推送版本 tag。所有平台先上传到同一个 draft Release。
4. 完整性检查要求 Windows、Apple Silicon、Intel 的安装包和签名更新包全部存在。
5. 生成 `desktop-distribution` artifact，再公开 Release，并同步 Monoize。

`scripts/check-release-version.mjs` 检查版本一致性。
`scripts/prepare-desktop-release.mjs` 重写 URL，核对 `.sig` 与清单一致，生成下载 SHA-256。
Tauri 客户端负责密码学验签；清单中的 SHA-256 供用户核验，不替代签名。

## GitHub Actions 配置

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | 与内置公钥匹配的 Tauri 私钥 |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |
| Secret | `LYNSHEN_CLI_TOKEN` | 可选；公开 CLI 仓库默认使用 github.token |
| Secret | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | 可选 macOS 固定签名身份 |
| Variable | `DESKTOP_PUBLIC_ORIGIN` | 默认 `https://www.lynshen.org` |
| Variable | `DESKTOP_SSH_HOST`, `DESKTOP_SSH_USER` | 分发服务器和发布账号 |
| Secret | `DESKTOP_SSH_KEY` | 发布账号专用 SSH 私钥 |
| Secret | `DESKTOP_SSH_KNOWN_HOSTS` | 经核验的服务器 host key |

未设置 `DESKTOP_SSH_HOST` 时保留分发 artifact，跳过远程同步。
远程发布脚本原子替换清单，保留旧版文件，拒绝版本倒退和覆盖同版本不同内容。
同步不会修改已有 `policy`。不要提交任何密码或私钥。

发布专用 SSH key 必须使用 forced command 和 `restrict`，只接受
`publish-desktop-release`。服务器安装 root 所有的 `receive-desktop-release.py`
及 `publish-desktop-release.py`，固定目标目录，不允许 CI 指定命令或路径。
接收器拒绝链接、路径穿越、未知文件、清单与校验和不一致，以及超过 2 GiB 的归档。
专用账号没有通用 sudo 权限，只有固定接收器入口；SSH 转发和交互终端均禁用。

macOS 自签名不等于 Apple 公证；Windows 更新签名不等于 Authenticode。
平台安装限制仍需向用户说明。GitHub 账号必须具有可用的 Actions 额度，才能运行构建。

## 手动发布

```sh
node scripts/prepare-desktop-release.mjs release-assets distribution https://www.lynshen.org
python3 scripts/publish-desktop-release.py distribution /path/to/desktop-releases
```

首次只有 Windows 包可用时，可显式传入 `--windows-only`。
官网会把两个 macOS 平台显示为「尚未发布」，不会生成失效下载链接。
完整 CI 发布不使用这个选项；后续增加平台时使用新版本，保留已发布版本的不可变性。
