# npm 发布手册（给 AI 协作者 / 未来的自己）

> 本文记录 **2026-10-21 实际打通的那一次**（v1.0.3）。所有步骤都是本机实测过的，不是"应该能行"。
> 目的：下一个人（或 AI）发新版时，不用再花两小时在 2FA 上打转。

---

## 0. 一句话结论

**发布必须在「真终端窗口」里裸跑 `npm publish`**，让 npm 自己去拉起浏览器做 Windows Hello 授权。
任何把输出接成管道/日志的写法都会让它**直接失败**（原因见 §3）。

---

## 1. 身份与坐标（事实）

| 项 | 值 |
|---|---|
| npm 账号 | `qiuzhiyei`（scope 也是它） |
| 包名 | **`@qiuzhiyei/dsh-companion`** |
| 为什么带 scope | 无前缀的 `dsh-companion` 已被别人占用（作者 `gjnzsu`，0.1.1） |
| 2FA 方式 | **Security Key / Windows Hello**（设备名 `thinkbook14+`） |
| 有没有 TOTP | **没有** —— npm 的 2FA 页面只提供 `Security Key` + `Recovery Codes`，**没有 `Authenticator app` 选项** |
| 本机 npm | 11.12.1（`dsh` 自带的是 pnpm 11.28.5，两者无关） |
| 仓库 | https://github.com/qiuzhiyei/dsh-companion |
| 包页面 | https://www.npmjs.com/package/@qiuzhiyei/dsh-companion |

> ⚠️ **KeePassXC 在这条路上用不了。** KeePassXC 只能算 TOTP（6 位动态码），而这个账号根本没有 TOTP 密钥可以导出。别再折腾验证器。

---

## 2. 发版前：改身份 + 构建 + 测试

发布前必须做完这四步，缺一个都会导致装完不生效。

### 2.1 版本号

改 `package.json` 的 `version`（当前线：1.0.x）。

### 2.2 身份改名（**只有第一次换包名时才需要**，之后别再动）

包名 = 客户端注册 id = 补丁里的加载器名，**四处必须逐字一致**：

| 位置 | 内容 |
|---|---|
| `package.json` | `"name": "@qiuzhiyei/dsh-companion"` |
| `src/client/index.ts` | `id: '@qiuzhiyei/dsh-companion'`（`__ModuleLoader__.load({ id, factory })`） |
| `cordis.patch.yml` | `insert[0].name: '@qiuzhiyei/dsh-companion'`（**树节点 `id: dsh-companion` 保持不变**） |
| `tests/client-badge.test.mjs` | 断言「注册 id 必须逐字等于包名」 |

为什么这么严：DSH 宿主用 **加载器行名**（即 `cordis.patch.yml` 的 `name`）去反查 `node_modules/<name>/package.json`，要求 `package.json.name` 与之逐字相等；客户端注册的 `id` 又必须等于这个行名。**任何一处不一致 → 插件静默不加载，没有任何报错。**

保持不变的东西（改了只会添乱）：树节点 `id`、数据目录 `<DSH_HOME>\dsh-companion`、`src/index.ts` 的 `export const name`、事件通道 `companion/*`。

### 2.3 构建（dist 必须提交）

```powershell
cd D:\Code_Project\Dsh_Plugin_Project\dsh-companion
pnpm run build          # 双 tsc：tsc -p tsconfig.json && tsc -p tsconfig.client.json
```

`dist/` **纳入版本库**（GitHub 安装靠它）。CI 有 `git diff --exit-code -- dist` 校验，提交的产物必须与源码同步。

### 2.4 测试（81 项应全绿）

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Code_Project\Dsh_Plugin_Project\dsh-companion'; node --test 2>&1 | Out-String }
Wait-Job $job -Timeout 300 | Out-Null
Receive-Job $job | Select-String 'tests \d+|pass \d+|fail \d+'
Remove-Job $job -Force
```

### 2.5 预演（不真发）

```powershell
npm publish --dry-run --access public
```

看三件事：包名、版本、`total files: 95`（约 7.6 MB）。**scoped 包必须带 `--access public`**，否则默认走私有（要付费）。

---

## 3. 为什么必须用"真终端"（核心坑）

npm 现在强制发布必须 2FA。CLI 遇到 2FA 时会走 `webAuthOpener`：打开浏览器让你做 WebAuthn，然后自动重试发布。

但 npm 的源码把条件钉死了 —— `npm/lib/utils/auth.js`：

```js
const otplease = async (npm, opts, fn) => {
  try {
    return await fn(opts)
  } catch (err) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw err          // ← 不是真终端，直接失败，不走网页授权
    }
    ...
    // web otp
    if (err.code === 'EOTP' && err.body?.authUrl && err.body?.doneUrl) {
      const { token: otp } = await webAuthOpener(createOpener(npm, 'Authenticate your account at'), err.body.authUrl, err.body.doneUrl, opts)
      return await fn({ ...opts, otp })
    }
```

**推论（全部实测验证过）：**

1. 在 agent / 脚本里跑 `npm publish` → 立刻抛 `EOTP` 并退出。
2. 用 `npm publish 2>&1 | Tee-Object -FilePath log` → **同样失败**，因为 stdout 变成管道，`process.stdout.isTTY === false`。
3. 用 `Start-Process` 拉出来的子进程 → 会被 agent 的进程树回收（窗口活不过一次工具调用）。
4. `wt.exe` / `.cmd` 用 explorer 启动 → 会被 **SmartScreen** 拦。
5. ✅ **可用**：`Shell.Application` COM 的 `ShellExecute` 拉起的独立 PowerShell 窗口 + **裸跑** `npm publish`（不接任何管道）。

另外：错误信息里的 `https://www.npmjs.com/auth/cli/***` 是**被打码**的，没法转给用户点（npm 的 log redaction）。同理 `~/.npm/_logs/*.log` 里也是 `***`。

---

## 4. 标准发布流程（照抄）

### 4.1 确认已登录（一次即可，凭证存在 `~/.npmrc`）

```powershell
npm whoami      # 应输出: qiuzhiyei
```

未登录就按 §6 的"首次登录"做一次。

### 4.2 拉起一个独立发布窗口

把下面整段粘进 PowerShell 执行（它会写一个临时 ps1 并用 COM 拉起窗口）：

```powershell
$ps1 = Join-Path $env:TEMP 'npm-publish.ps1'
$body = @'
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
Set-Location 'D:\Code_Project\Dsh_Plugin_Project\dsh-companion'
Write-Host ''
Write-Host '============ npm 发布（网页授权模式）============' -ForegroundColor Cyan
Write-Host '  浏览器会自动打开 -> 用 Windows Hello 确认' -ForegroundColor Yellow
Write-Host '  成功标志: + @qiuzhiyei/dsh-companion@<版本号>' -ForegroundColor Green
Write-Host '=================================================' -ForegroundColor Cyan
Write-Host ''
npm publish --access public
Write-Host ''
Write-Host ("==== 退出码: " + $LASTEXITCODE + " ====") -ForegroundColor Green
Write-Host '（窗口先别关，等确认发布成功）'
'@
[System.IO.File]::WriteAllText($ps1, $body, [System.Text.UTF8Encoding]::new($true))
$sh = New-Object -ComObject Shell.Application
$sh.ShellExecute('powershell.exe', "-NoLogo -NoExit -ExecutionPolicy Bypass -File `"$ps1`"", '', 'open', 1)
```

**要点（一个都不能少）：**

- `ShellExecute` 而不是 `Start-Process`（否则进程被回收）
- 脚本里 **裸跑** `npm publish`（**绝不要** `| Tee-Object`、`> log.txt`、`2>&1 |`）
- `--access public` 必须带
- `-ExecutionPolicy Bypass` 必须带（临时脚本没有签名）

### 4.3 人肉动作（只有这一步需要人）

窗口里会打印 `Publishing to https://registry.npmjs.org/ ...`，随后**浏览器自动弹出**：

1. 页面提示用安全密钥认证
2. **Windows Hello**：指纹 / 人脸 / PIN
3. 确认后回到窗口，它会自动完成上传

成功的输出：

```
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
+ @qiuzhiyei/dsh-companion@1.0.3
```

> 如果浏览器没弹：看窗口里有没有完整链接（**真终端里是不打码的**），复制到浏览器打开即可。

### 4.4 AI 侧怎么确认（不用读那个窗口）

```powershell
$deadline = (Get-Date).AddMinutes(8)
while ((Get-Date) -lt $deadline) {
  $v = & npm view '@qiuzhiyei/dsh-companion' version 2>&1
  if ($LASTEXITCODE -eq 0) { Write-Output ('PUBLISHED: ' + ($v -join ' ').Trim()); break }
  Start-Sleep -Seconds 6
}
```

### 4.5 发布后验证（三项，别省）

```powershell
# ①注册表信息
npm view '@qiuzhiyei/dsh-companion' name version dist.tarball time.created --json

# ②干净目录装一遍（npm 路径）
$tmp = Join-Path $env:TEMP ('v-' + (Get-Random)); New-Item -ItemType Directory $tmp | Out-Null; Set-Location $tmp
'{"name":"v","private":true}' | Set-Content package.json
npm install '@qiuzhiyei/dsh-companion' --no-audit --no-fund

# ③真正的用户路径（全新 DSH_HOME，走 dsh 自己的 CLI）
$dsh = 'D:\Software\Angent\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$env:DSH_HOME = Join-Path $env:TEMP ('dshhome-' + (Get-Random))
New-Item -ItemType Directory $env:DSH_HOME | Out-Null
& $dsh plugin --profile p add '@qiuzhiyei/dsh-companion'
# 期望：+ @qiuzhiyei/dsh-companion <版本>  Done in ~10s using pnpm v11.28.5
```

还要确认**身份一致性**：

```powershell
$p = "$env:DSH_HOME\profiles\p\node_modules\@qiuzhiyei\dsh-companion"
node -e "const q=require('$($p -replace '\\','/')/package.json'); console.log(q.name, q.version)"
Select-String -Path "$p\dist\client\index.js" -Pattern "id: '@qiuzhiyei/dsh-companion'"
# 两处包名必须逐字相同，否则宿主静默不加载
```

国内镜像同步（通常几分钟内）：

```powershell
npm view '@qiuzhiyei/dsh-companion' version --registry=https://registry.npmmirror.com
```

### 4.6 提交 + 标签 + Release（顺序固定）

```powershell
cd D:\Code_Project\Dsh_Plugin_Project\dsh-companion
git add -A
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z — <一句话>"
git push origin main
git push origin vX.Y.Z     # 标签必须单独推，否则 Release 选不到
gh release create vX.Y.Z --title "vX.Y.Z — <标题>" --notes-file <临时md> --verify-tag
```

---

## 5. 别人怎么装（发布后的两种形态）

```sh
# 首选：npm（走自己的 registry / 国内镜像，不受 GitHub 连通性影响）
dsh plugin --profile <你的 profile> add @qiuzhiyei/dsh-companion

# 备选：GitHub 直装（仓库里带编译好的 dist/）
dsh plugin --profile <你的 profile> add github:qiuzhiyei/dsh-companion
```

**桌面版 GUI**：插件管理器 → 安装插件 → 选「中国大陆镜像源」或「npm 官方源」→ 输入 `@qiuzhiyei/dsh-companion` → 安装 → **启用** → 完全退出重开 DSH。

**装完不等于启用**：宿主只有在 profile 的 `cordis.patch.yml` 里看到该插件的 `insert` 条目才会加载它，必须走插件管理器的"启用"开关。启用后要**完全退出**（含托盘）再重开。

---

## 6. 首次登录（新机器 / 换了账号时）

```powershell
npm login --auth-type=web
```

- 终端会打印 `Login at: https://...` 并停在 `Press ENTER`
- **必须真终端**（同 §3 的原因，非 TTY 会退化到问用户名/密码然后失败）
- 按回车 → 浏览器 → Windows Hello → 终端出现 `Logged in as qiuzhiyei`
- 凭证写入 `~/.npmrc`，之后发布不再需要登录

> 注意：**登录 ≠ 能发布**。发布永远还要一次 2FA 授权（§4.3），这是 npm 的规则，绕不过。

---

## 7. 错误 → 原因 → 处理

| 报错 | 原因 | 处理 |
|---|---|---|
| `E403 Two-factor authentication or granular access token with bypass 2fa enabled is required` | 账号没开 2FA，或 token 没 bypass | 账号开 2FA（安全密钥即可）；或按 §4 走真终端 |
| `EOTP This operation requires a one-time password`（且立刻退出） | **不是真终端**，或输出被管道接了 | 用 §4.2 的方式拉独立窗口，**裸跑**命令 |
| 错误里的链接显示 `***` | npm 对 auth URL 做了打码 | 正常现象；在真终端里它是完整的 |
| `E404 Not found` 于 `GET /@scope%2fname` | 包还没发布过 | 正常，首次发布后就有了 |
| `E402 Payment Required` | scoped 包没加 `--access public` | 加 `--access public` |
| `ERR_PNPM_GIT_RESOLVE_FAILED ... github.com:443` | 装 profile 时 GitHub 连不上（**与插件无关**） | 重试；或 `$env:GIT_CONFIG_COUNT=1; $env:GIT_CONFIG_KEY_0='url.git@github.com:.insteadOf'; $env:GIT_CONFIG_VALUE_0='https://github.com/'` |
| `ERR_PNPM_EPERM ... symlink 'D:\...' -> 'C:\...'` | profile 里旧的 link/junction 跨盘符 | 先 `Remove-Item` 掉那个 junction 再装 |
| 装完插件不生效、无报错 | `package.json.name` ≠ 客户端注册 `id` ≠ 补丁 `insert.name` | 按 §2.2 四处对齐，重新 build + 发布 |
| `POST /-/v1/login` 返回 401 | 该接口需要交互式会话（带 token 也没用） | 别走这条路，用 §4 |

---

## 8. 认知纠正（这几个"看起来对"的判断都错过）

1. **`Publish new versions directly` ≠ 有 bypass。** Granular token 生成页的 Summary 这么写，不代表 token 真能绕过 2FA。判据只有一条：**Access Tokens 列表页的 `Bypass 2FA` 列有没有勾**。
2. **2FA 开启前创建的 token 永远没有 bypass。** 之后把账号 2FA 开了，那个旧 token 还是会被 `EOTP` 拦——必须重新建。
3. **`npm stage` 不存在**（npm 11.12.1）。暂存发布（Staged Packages）在网页侧菜单里，但 CLI 没有对应命令，别按文档瞎试。
4. **KeePassXC 用不上**：账号没有 TOTP 密钥，页面上也没有 `Authenticator app` 选项。
5. **网页端不能上传包**：npmjs.com 没有"发布"按钮，发布只能走 CLI/CI。
6. **`npm login` 成功不代表能直接发**：登录只是拿到凭证，发布仍需一次 2FA。

---

## 9. 安全事项

- 对话/聊天里贴出过的 **token、恢复码、auth 链接** 一律视为已泄露：
  - 去 https://www.npmjs.com/settings/~/tokens 删掉没用的 token
  - 去 2FA 页面 **Recovery Codes → 重新生成**
- 临时脚本用完后删掉：`$env:TEMP\npm-publish.ps1` 等
- `~/.npmrc` 里存着网页登录得到的长期凭证，别提交、别外传

---

## 10. 未来可以更省事（可选）

**Trusted Publishing（OIDC）**：在 npm 包页面绑定 `qiuzhiyei/dsh-companion` 这个 GitHub 仓库后，改由 GitHub Actions 发布，**完全不需要 token / 2FA / 浏览器确认**。

前提是包已经存在（本包 1.0.3 已发布，满足）。做法概要：

1. npm 包页面 → **Settings → Trusted Publisher** → 选 GitHub Actions → 填 `qiuzhiyei` / `dsh-companion` / `publish.yml`
2. 仓库加 `.github/workflows/publish.yml`：`permissions: id-token: write` + `npm publish --provenance --access public`
3. 之后发版 = 推个 tag，CI 自动发

⚠️ 这一步**尚未实测**，落地前先在本地/分支验证一次，别直接改主流程。

---

_最后更新：2026-10-21，v1.0.3 发布完成后整理。_