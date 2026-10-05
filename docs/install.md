# 安装与首次打开

LynShen Desktop 内测版还没有做代码签名。macOS 和 Windows 在第一次打开时会拦截，按下面的步骤放行即可。之后应用会自动更新，不需要重复操作。

下载地址：[GitHub Releases](https://github.com/LynShen-Team/LynShen-Desktop/releases/latest)

| 系统 | 下载文件 |
| --- | --- |
| macOS（Apple 芯片） | `LynShen_<版本>_aarch64.dmg` |
| Windows x64 | `LynShen_<版本>_x64-setup.exe` |
| Linux x64 | `LynShen_<版本>_amd64.AppImage`，或 `.deb`、`.rpm` |

Intel 芯片的 Mac 暂不支持。

## macOS

1. 打开 dmg，把 LynShen 拖进「应用程序」。
2. 在「应用程序」里打开 LynShen。系统会提示无法验证开发者，点「完成」。
3. 打开「系统设置 → 隐私与安全性」，滚动到「安全性」一栏，找到「已阻止 LynShen 以保护你的 Mac」，点「仍要打开」，输入登录密码确认。
4. 再次打开 LynShen，在弹窗里点「打开」。

如果提示「LynShen 已损坏，无法打开」，或者第 3 步找不到「仍要打开」，在终端执行：

```sh
xattr -dr com.apple.quarantine /Applications/LynShen.app
```

然后重新打开 LynShen。

### 权限

LynShen 只在用到对应功能时申请权限，不用的功能不需要授权。

| 权限 | 用途 | 位置 |
| --- | --- | --- |
| 麦克风 | 语音输入 | 系统设置 → 隐私与安全性 → 麦克风 |
| 屏幕与系统录音 | 截屏、录屏发给智能体 | 系统设置 → 隐私与安全性 → 屏幕与系统录音 |
| 文件和文件夹 | 打开「桌面」「文稿」「下载」里的项目 | 首次访问时系统弹窗确认 |
| 通知 | 会话完成或需要确认时提醒 | 系统设置 → 通知 → LynShen |

开启录屏权限后，macOS 会要求退出并重新打开 LynShen 才生效。

因为内测版没有签名，更新到新版本后，系统可能把它当成新应用，麦克风和录屏权限需要重新开启。如果功能突然提示没有权限，到上表的位置把 LynShen 关掉再打开即可。

## Windows

1. 运行 `LynShen_<版本>_x64-setup.exe`。
2. 如果出现「Windows 已保护你的电脑」，点「更多信息」，再点「仍要运行」。
3. 按安装程序的提示完成安装，不需要管理员权限。

部分杀毒软件会拦截未签名的程序，需要在杀毒软件里放行 LynShen。

## Linux

AppImage：

```sh
chmod +x LynShen_*_amd64.AppImage
./LynShen_*_amd64.AppImage
```

Ubuntu 22.04 及以后的版本运行 AppImage 需要 FUSE 2：Ubuntu 22.04 安装 `libfuse2`，Ubuntu 24.04 安装 `libfuse2t64`。

deb 和 rpm：

```sh
sudo apt install ./LynShen_*_amd64.deb      # Debian、Ubuntu
sudo dnf install ./LynShen-*.x86_64.rpm     # Fedora、RHEL
```

## 首次启动

首次启动会打开设置向导：

1. 检查 git 和 LynShen CLI，缺少的可以一键安装。
2. 登录 LynShen 账号，浏览器会打开登录页，完成后自动回到应用。
3. 选择常用模型。

Claude Code 和 Codex 是可选的。需要时在「设置 → 智能体」里安装，安装程序来自它们的官方渠道。
