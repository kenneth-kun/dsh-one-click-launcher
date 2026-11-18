# 发布与收录（GitHub + dsh-plugin.org）

插件市场的收录方式不是网页表单，而是 **GitHub 已公开仓库 + `dsh-plugin` topic + 一条固定模板的 Issue**。
下面按"现在能做什么 / 之后要做什么"分成两段。

## 现状

| 步骤 | 状态 |
| --- | --- |
| 代码仓库 | 待建：`https://github.com/kenneth-kun/dsh-one-click-launcher`（public） |
| GitHub topic `dsh-plugin` | 待加（仓库页 → About 齿轮 → Topics） |
| 提交收录 Issue | 待发，模板见 [docs/SUBMIT-ISSUE.md](docs/SUBMIT-ISSUE.md) |
| npm 包 `dsh-one-click-launcher` | **未发布**（没有 npm 账号；网站仍会收录，但应用内「插件中心」里搜不到） |

## 一、发布仓库（这次要做的）

在 GitHub 建一个 **public、空** 仓库，名字 `dsh-one-click-launcher`，**不要**勾 README / .gitignore / license，否则会有冲突提交。

然后用 SSH 推送（本机 `~/.ssh/id_ed25519` 已注册为 `kenneth-kun`，无需 token）：

```sh
cd ~/Documents/deepseek-harness/default-workspace/dsh-one-click-launcher
git push -u origin main
```

推送成功后：

1. 仓库页右侧 **About** → 齿轮 → **Topics** 加 `dsh-plugin`（必须），可顺带加
   `deepseek-harness`、`dsh`、`launcher`、`desktop`、`shortcut`。
2. **About → Description** 填：`DeepSeek Harness (DSH) 插件：一键生成 macOS .app / Windows .lnk / Linux .desktop，双击启动 dsh web。`
3. 打开 [docs/SUBMIT-ISSUE.md](docs/SUBMIT-ISSUE.md) 里的预填链接，直接提交 Issue 到
   `dshplugin/dsh-plugin-hub`。

审核通过后会自动生成收录页，常见形态：
`https://dsh-plugin.org/plugins/kenneth-kun/dsh-one-click-launcher`，
届时可把徽章放进 README：

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/kenneth-kun/dsh-one-click-launcher)
```

## 二、之后可选：发布到 npm

发布 npm 是"进入 DSH 应用内插件中心"的唯一方式（插件中心只展示能 `dsh plugin --profile web add <包名>` 一键装的插件）。

1. 注册 <https://www.npmjs.com/signup>（GitHub 账号可直接登录）。
2. 本地登录并开一个 **Automation** token（可绕过 2FA）：

```sh
npm login
npm publish --access public
```

3. 发布后把 README 的安装段落顺序换回来（npm 优先），并在 Issue 里补一句"已发布 npm 包"，或等下一轮自动刷新。

发布前自检：

```sh
npm test                # 19 个用例全绿
npm pack --dry-run      # 17 个文件，lib/launcher.cjs 与 assets/ 三个图标必须在内
```

## 三、版本与兼容性约定

- **不依赖宿主私有 API**：只用 `ctx.inject(['webServer'])`、`ctx.slots`、`ctx.locale` 三处稳定接口。
- **`engines.node >= 18`**（宿主自带 Node，实际不会低于这个版本）。
- **改 `launcher.json` 结构是破坏性变更**：用户桌面上可能还躺着上一版复制过去的 `launcher.cjs`，
  所以读取配置时要向后兼容。当前 `schema: 1`，若要改请升 `schema: 2` 并在 `readConfig` / `resolveCommand` 里同时支持。
- **图标**：`assets/icon.{png,ico,icns}` 三个一起换，`npm run icons` 一次生成。

## 四、每次发版的检查表

- [ ] `npm test` 全绿
- [ ] macOS 真机创建 + 双击 `.app` 通过
- [ ] Windows 真机创建 + 双击 `.lnk`（wscript 不闪黑框）
- [ ] Linux 真机创建 + 双击 `.desktop`（GNOME 需 trusted，插件已自动 `gio set`）
- [ ] Settings 页面截图没泄露个人信息（当前截图含 `/Users/lilikun/…`，公开前可重截或遮挡）
- [ ] `package.json` 版本号 +1
- [ ] 发布后打 tag：`git tag v0.1.x && git push --tags`
