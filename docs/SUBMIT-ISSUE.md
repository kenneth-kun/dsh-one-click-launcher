# 提交 Issue 到 dsh-plugin-hub

给 `dshplugin/dsh-plugin-hub` 提一个 Issue（按官方模板）。下面内容可直接复制，或点预填链接。

- 仓库：`https://github.com/kenneth-kun/dsh-one-click-launcher`
- 提交页说明：<https://dsh-plugin.org/zh/submit>

## 标题

```
[插件提交] kenneth-kun/dsh-one-click-launcher — 一键生成三平台桌面图标，双击启动 dsh web
```

## 正文

```markdown
### 仓库地址
https://github.com/kenneth-kun/dsh-one-click-launcher

### 一句话价值
安装后在「设置 → 桌面快捷方式」点一下，就能在 macOS / Windows / Linux 生成双击启动 DSH Web 的桌面图标（.app / .lnk / .desktop），自动复用已运行的实例并带上登录凭据。

### 能力分类
界面与体验

### 安装命令
dsh plugin --profile web add github:kenneth-kun/dsh-one-click-launcher

（npm 包 `dsh-one-click-launcher` 尚未发布，暂以源码方式安装；发布后会换成 dsh plugin --profile web add dsh-one-click-launcher）

### 兼容与运行要求
DSH 0.2.x web profile；宿主 Node ≥ 18；macOS 11+ / Windows 10+ / 主流 Linux 桌面（GNOME、KDE）。纯本机运行，不联网。

### 许可证
MIT

### 截图 / 演示
https://github.com/kenneth-kun/dsh-one-click-launcher/blob/main/docs/settings-zh.png
https://github.com/kenneth-kun/dsh-one-click-launcher/blob/main/docs/settings-en.png

### 补充说明
- 写入位置：桌面图标，以及 `%LOCALAPPDATA%`（Windows）/ `~/.local/share`（Linux）/ app bundle 内部（macOS）；状态与日志在各自的日志目录。
- 宿主侧三个路由做同源校验（Host 必须回环，Origin 缺失或同源），只写本机文件，无遥测、无外部服务。
- 卸载插件不影响已创建的快捷方式：启动器 `launcher.cjs` 是复制到用户目录的独立 payload。
- 已知限制：Electron 桌面壳托管的会话没有 `bin.js`，快捷方式会退回 `dsh` 命令；不提供开机自启。

### 提交前自查
- [x] 仓库已公开
- [x] 已添加 GitHub topic：dsh-plugin
- [x] README 包含安装命令
- [x] 插件导出 apply(ctx) 模块
- [x] 仓库根目录包含 package.json
```

## 预填链接

打开下面这个链接，GitHub 会把标题和正文自动填好，直接点「Create」即可
（链接较长，见仓库根目录 `docs/submit-issue-url.txt`，由脚本生成）：

```sh
cat docs/submit-issue-url.txt
```
