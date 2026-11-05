# npm 发布流程

以 `@qiuzhiyei/dsh-companion` 为例。当前 npm 最新版本是 `2.1.1`，下面按发布 `2.2.0` 演示。

## 一、进入仓库

```powershell
cd D:\Code_Project\Dsh_Plugin_Project\dsh-companion
git status
```

确认当前在 `main`。

注意：

- 不要用 `git add .`
- `01-设计稿/` 不能提交
- `dist/` 必须是最新构建产物

## 二、登录 npm

```powershell
npm whoami
```

如果返回 `E401`：

```powershell
npm login --auth-type=web
```

浏览器会打开 npm 登录页，登录并授权后回到终端：

```powershell
npm whoami
```

应显示：

```text
qiuzhiyei
```

每个新终端、或登录过期后，都要重新确认。

## 三、更新版本号

当前是 `2.1.1`，这次有新功能，使用小版本升级：

```powershell
npm version minor --no-git-tag-version
```

版本变成：

```text
2.2.0
```

同时更新 README：

- `README.md` 标题改成 `# DSH 伴侣 2.2.0`
- `README.en.md` 标题改成 `# DSH Companion 2.2.0`
- 补充本次更新内容

`--no-git-tag-version` 只改 `package.json`，不自动提交、不自动打 tag。

## 四、构建和测试

```powershell
pnpm run build
node --test
```

应看到：

```text
tests 149
pass 149
fail 0
```

构建会更新 `dist/`，发布前不要忘记提交。

## 五、检查 npm 包

```powershell
npm pack --dry-run
```

确认：

- 包名是 `@qiuzhiyei/dsh-companion`
- 版本是 `2.2.0`
- 包含 `dist/`
- 包含 `assets/`
- 包含 `electron/`
- 包含 `README.md`

## 六、提交 Git

```powershell
git add -u
```

如果这次有新增文件，再显式添加具体文件：

```powershell
git add 具体文件路径
```

不要用：

```powershell
git add .
```

检查暂存区：

```powershell
git status
```

确认没有 `01-设计稿/`。

提交并打 tag：

```powershell
git commit -m "release: 2.2.0"
git tag -a v2.2.0 -m "DSH 伴侣 2.2.0"
```

推送：

```powershell
git push origin main
git push origin v2.2.0
```

先 push 再发 npm。README 截图使用 GitHub raw 地址，先 push 才能保证 npm 页面上的图也能显示。

## 七、发布 npm

```powershell
npm publish --access public
```

`@qiuzhiyei/...` 是 scoped 包，必须带 `--access public`。

## 八、处理 2FA

如果终端出现：

```text
npm error code EOTP
npm error This operation requires a one-time password.
npm error Open this URL in your browser to authenticate:
```

操作：

1. 打开终端给出的 URL
2. 在浏览器里确认发布
3. 回到终端

npm 有时会自动继续，显示：

```text
Your package is being processed...
```

如果命令已经退出，再执行一次：

```powershell
npm publish --access public
```

有验证器时也可以直接：

```powershell
npm publish --access public --otp=123456
```

## 九、验证发布

```powershell
npm view @qiuzhiyei/dsh-companion version --prefer-online
npm view @qiuzhiyei/dsh-companion dist-tags --json --prefer-online
```

正常输出：

```json
{
  "latest": "2.2.0"
}
```

npm registry 可能延迟几分钟，刚发布完查不到就稍后再查。

## 十、可选：GitHub Release

```powershell
gh release create v2.2.0 `
  --title "DSH 伴侣 2.2.0" `
  --notes "桌宠多任务状态、任务阶段与角标聚合显示。"
```

## 常见错误

| 错误 | 原因 | 处理 |
| --- | --- | --- |
| `E401 Unauthorized` | 未登录或登录过期 | `npm login --auth-type=web` |
| `E403 cannot publish over previously published versions` | 版本号已存在 | 升版本，不能覆盖发布 |
| `EOTP` | 账号要求发布 2FA | 打开终端 URL 验证，或加 `--otp=六位码` |
| `npm view` 还是旧版本 | registry 处理延迟 | 等几分钟，加 `--prefer-online` 重查 |
| 安装后没有 `dist/` | 构建产物没提交或没进包 | 重新构建，检查 `npm pack --dry-run` |
| npm 页面截图 404 | main 还没 push | 先 push main，再发 npm |

## 发布前检查清单

- [ ] `npm whoami` 显示 `qiuzhiyei`
- [ ] `package.json` 版本已更新
- [ ] README 版本和更新说明已更新
- [ ] `pnpm run build` 通过
- [ ] `node --test` 全绿
- [ ] `npm pack --dry-run` 内容和版本正确
- [ ] Git 已提交，无 `01-设计稿/`
- [ ] `main` 和 tag 已 push
- [ ] `npm publish --access public` 完成
- [ ] 2FA 浏览器验证完成
- [ ] `npm view` 看到新版本
- [ ] 可选：GitHub Release 已创建

## 安全提醒

- 不要把 npm token 发到聊天里
- 不要手输别人的 OTP
- 优先使用 `npm login --auth-type=web`
- 发布前确认版本号和 `package.json` 的 `name`
