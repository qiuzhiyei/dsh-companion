/**
 * dsh-companion — Electron 运行时解析与按需获取。
 *
 * 桌宠的透明置顶悬浮窗 + 真托盘必须借 Electron 才能实现（Node 自身没有窗口能力）；
 * 但把 ~150 MB 的运行时塞进 npm 包对所有用户都不划算（装一次全量、镜像同步、每次发版重传），
 * 所以采用业内通行做法：**包只带代码，首次需要时自动下载并缓存**。
 *
 * 解析顺序（先本地后网络）：
 *   1. 环境变量 `DSH_COMPANION_ELECTRON`（指向 electron 可执行文件，手动兜底/调试用）
 *   2. `require('electron')`——开发态（link 安装）或用户自己装过 electron 的情形
 *   3. `<dataDir>/runtime/electron-<version>/…`——本模块之前下载并解压的副本
 *   4. 都没有 → `ensureElectronRuntime()` 按镜像顺序下载 → 解压 → 返回可执行文件
 *
 * 版本**钉死**在 ELECTRON_VERSION：运行时与 electron/main.cjs 的行为绑定，
 * 不跟上游 latest 漂移（也别指望 npm 上的 beta 标签）。
 * 下载失败会写一个带时间戳的标记，6 小时内不再自动重试，避免每次启动都卡一下。
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
/** 与 electron/main.cjs 一起验证过的版本；升级前先在 Windows 上跑一遍壳。 */
export const ELECTRON_VERSION = '44.7.2';
/** 下载失败后的冷却期，避免坏网络下每次启动都重试。 */
const FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** 低于这个体积的 zip 一定是错误页/半截文件。 */
const MIN_ZIP_BYTES = 40 * 1024 * 1024;
/** 运行时根目录：<dataDir>/runtime。 */
export function runtimeRoot(dataDir) {
    return join(dataDir, 'runtime');
}
/** 某个版本解压后的目录。 */
export function runtimeDir(dataDir, version = ELECTRON_VERSION) {
    return join(runtimeRoot(dataDir), `electron-${version}`);
}
/** 平台无关的可执行文件相对路径（解压目录内）。 */
export function exeRelativePath(platform = process.platform) {
    if (platform === 'darwin')
        return join('Electron.app', 'Contents', 'MacOS', 'Electron');
    if (platform === 'win32')
        return 'electron.exe';
    return 'electron';
}
/** 已下载副本的可执行文件路径（不存在返回 null）。 */
export function installedExe(dataDir, version = ELECTRON_VERSION) {
    const exe = join(runtimeDir(dataDir, version), exeRelativePath());
    return existsSync(exe) ? exe : null;
}
/**
 * 下载地址，按尝试顺序排列。
 * 国内镜像优先（DSH 用户大多在国内，GitHub release 经常连不上），GitHub 兜底。
 */
export function electronZipUrls(version = ELECTRON_VERSION, platform = process.platform, arch = process.arch) {
    const file = `electron-v${version}-${platform}-${arch}.zip`;
    return [
        `https://registry.npmmirror.com/-/binary/electron/${version}/${file}`,
        `https://npmmirror.com/mirrors/electron/${version}/${file}`,
        `https://github.com/electron/electron/releases/download/v${version}/${file}`,
    ];
}
/** 本地已具备的 Electron（不联网）。 */
export function resolveElectronSync(dataDir, version = ELECTRON_VERSION) {
    const fromEnv = process.env.DSH_COMPANION_ELECTRON;
    if (fromEnv && existsSync(fromEnv))
        return fromEnv;
    try {
        const require = createRequire(import.meta.url);
        const resolved = require('electron');
        if (typeof resolved === 'string' && existsSync(resolved))
            return resolved;
    }
    catch {
        // 没装 electron 是常态（npm 安装不带 devDependencies），继续往下走。
    }
    return installedExe(dataDir, version);
}
function failureMarkerPath(dataDir) {
    return join(runtimeRoot(dataDir), 'download-failed.json');
}
function readFailureMarker(dataDir) {
    try {
        const raw = readFileSync(failureMarkerPath(dataDir), 'utf8');
        const parsed = JSON.parse(raw);
        return typeof parsed?.ts === 'number' ? parsed : null;
    }
    catch {
        return null;
    }
}
function writeFailureMarker(dataDir, version, reason) {
    try {
        mkdirSync(runtimeRoot(dataDir), { recursive: true });
        writeFileSync(failureMarkerPath(dataDir), JSON.stringify({ ts: Date.now(), version, reason }));
    }
    catch {
        // 标记只是节流手段，写不进去无所谓。
    }
}
function clearFailureMarker(dataDir) {
    try {
        rmSync(failureMarkerPath(dataDir), { force: true });
    }
    catch {
        // 同上。
    }
}
/** 解压 zip：Windows 10+ / macOS 都自带 bsdtar，能直接读 zip。 */
async function extractZip(zipPath, destDir) {
    mkdirSync(destDir, { recursive: true });
    await new Promise((resolve, reject) => {
        const child = spawn('tar', ['-xf', zipPath, '-C', destDir], {
            stdio: 'ignore',
            windowsHide: true,
        });
        child.once('error', reject);
        child.once('exit', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`tar 解压失败 (code=${code})`));
        });
    });
}
/** 下载一个 zip 到临时文件，返回实际字节数。 */
async function downloadZip(url, zipPath, log) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
    }
    const total = Number(response.headers.get('content-length') ?? 0);
    let received = 0;
    let lastLogged = 0;
    const body = Readable.fromWeb(response.body);
    body.on('data', (chunk) => {
        received += chunk.length;
        // 每过 ~10 MB 或每 10% 打一行，日志不刷屏又能看出活着。
        const step = total > 0 ? total / 10 : 10 * 1024 * 1024;
        if (received - lastLogged >= step) {
            lastLogged = received;
            const pct = total > 0 ? ` ${Math.round((received / total) * 100)}%` : '';
            log.info(`正在下载 Electron 运行时：${(received / 1024 / 1024).toFixed(1)} MB` +
                (total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : '') +
                pct);
        }
    });
    await pipeline(body, createWriteStream(zipPath));
    return received;
}
let inFlight = null;
/**
 * 确保 Electron 运行时可用：本地优先，缺失时按镜像顺序下载并解压。
 * 返回可执行文件路径；失败/被禁用返回 null（调用方退回浏览器页面模式）。
 * 并发调用共享同一次下载。
 */
export function ensureElectronRuntime(options) {
    if (inFlight)
        return inFlight;
    inFlight = provision(options).finally(() => {
        inFlight = null;
    });
    return inFlight;
}
async function provision(options) {
    const version = options.version ?? ELECTRON_VERSION;
    const { dataDir, log } = options;
    const existing = resolveElectronSync(dataDir, version);
    if (existing)
        return existing;
    if (options.allowDownload === false)
        return null;
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
        // Linux 下发行版自带的 electron 与官方 zip 布局差异大，不做自动下载。
        log.warn('当前平台不支持自动下载 Electron 运行时，伴侣以浏览器页面模式运行');
        return null;
    }
    const marker = readFailureMarker(dataDir);
    if (marker && marker.version === version && Date.now() - marker.ts < FAILURE_COOLDOWN_MS) {
        const hours = Math.max(1, Math.round((FAILURE_COOLDOWN_MS - (Date.now() - marker.ts)) / 3_600_000));
        log.warn(`上次自动下载 Electron 失败（${marker.reason}），${hours} 小时内不再重试；伴侣以浏览器页面模式运行`);
        return null;
    }
    const zipPath = join(runtimeRoot(dataDir), `electron-${version}.zip`);
    const destDir = runtimeDir(dataDir, version);
    const urls = electronZipUrls(version);
    let lastError = '';
    for (const url of urls) {
        try {
            log.info(`本机没有 Electron 运行时，开始自动下载（一次性，约 150 MB，之后复用）: ${url}`);
            mkdirSync(runtimeRoot(dataDir), { recursive: true });
            rmSync(zipPath, { force: true });
            const bytes = await downloadZip(url, zipPath, log);
            if (bytes < MIN_ZIP_BYTES)
                throw new Error(`下载体积异常（${bytes} 字节）`);
            log.info('下载完成，正在解压 Electron 运行时…');
            rmSync(destDir, { recursive: true, force: true });
            await extractZip(zipPath, destDir);
            rmSync(zipPath, { force: true });
            const exe = installedExe(dataDir, version);
            if (!exe)
                throw new Error('解压后未找到 Electron 可执行文件');
            clearFailureMarker(dataDir);
            log.info(`Electron 运行时已就绪: ${exe}`);
            return exe;
        }
        catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            log.warn(`下载失败（${url}）: ${lastError}`);
            rmSync(zipPath, { force: true });
        }
    }
    writeFailureMarker(dataDir, version, lastError || 'unknown');
    log.warn('自动下载 Electron 失败，伴侣继续以浏览器页面模式运行（下次启动再试）。' +
        ' 也可手动安装后重启 DSH：dsh plugin --profile <你的 profile> add -D electron');
    return null;
}
