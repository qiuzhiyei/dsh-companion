/**
 * 高峰 / 闲时与法定节假日日历。
 *
 * 官方口径（北京时间）：
 *   周一至周五 09:00–12:00、14:00–18:00 为高峰；
 *   周末与中国法定节假日全天为闲时（闲时价 = 高峰价 5 折）。
 *
 * 节假日数据内置 2025–2026（国务院安排），并可通过面板「同步节假日」
 * 拉取公共节假日 API 的当年 / 次年数据。官方尚未公布的年份保留原数据，
 * 不会被空结果清空。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/** 公共节假日 API（按国务院节假日安排整理，按年返回）。 */
export const HOLIDAY_API_BASE = 'https://timor.tech/api/holiday/year/';
/** 内置的法定节假日（只列 holiday=true 的日期；调休上班日不算节假日）。 */
export const DEFAULT_HOLIDAY_YEARS = {
    '2025': [
        '2025-01-01',
        '2025-01-28',
        '2025-01-29',
        '2025-01-30',
        '2025-01-31',
        '2025-02-01',
        '2025-02-02',
        '2025-02-03',
        '2025-02-04',
        '2025-04-04',
        '2025-04-05',
        '2025-04-06',
        '2025-05-01',
        '2025-05-02',
        '2025-05-03',
        '2025-05-04',
        '2025-05-05',
        '2025-05-31',
        '2025-06-01',
        '2025-06-02',
        '2025-10-01',
        '2025-10-02',
        '2025-10-03',
        '2025-10-04',
        '2025-10-05',
        '2025-10-06',
        '2025-10-07',
        '2025-10-08',
    ],
    '2026': [
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
        '2026-02-15',
        '2026-02-16',
        '2026-02-17',
        '2026-02-18',
        '2026-02-19',
        '2026-02-20',
        '2026-02-21',
        '2026-02-22',
        '2026-02-23',
        '2026-04-04',
        '2026-04-05',
        '2026-04-06',
        '2026-05-01',
        '2026-05-02',
        '2026-05-03',
        '2026-05-04',
        '2026-05-05',
        '2026-06-19',
        '2026-06-20',
        '2026-06-21',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
        '2026-10-04',
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
    ],
};
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value) {
    if (!DATE_PATTERN.test(value))
        return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day);
}
function dateKeyAt(atMs) {
    const d = new Date(atMs + 8 * 60 * 60 * 1000); // 北京时间固定 UTC+8，无夏令时
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
let activeHolidays = new Set(Object.values(DEFAULT_HOLIDAY_YEARS).flat());
let activeUpdatedAt = null;
function applyHolidayYears(years, updatedAt) {
    const dates = [...new Set(Object.values(years).flat())].filter(validDate).sort();
    activeHolidays = new Set(dates);
    activeUpdatedAt = updatedAt;
    return {
        years: [...new Set(dates.map((d) => d.slice(0, 4)))].sort(),
        dates,
        updatedAt,
    };
}
applyHolidayYears(DEFAULT_HOLIDAY_YEARS, null);
export function getHolidayDates() {
    return [...activeHolidays].sort();
}
export function getHolidayCalendarView() {
    const dates = getHolidayDates();
    return {
        years: [...new Set(dates.map((d) => d.slice(0, 4)))].sort(),
        dates,
        updatedAt: activeUpdatedAt,
    };
}
/**
 * 该日期（北京时间 YYYY-MM-DD）是否为中国法定节假日。
 * 传入 holidays 可注入测试日历；缺省用当前加载的日历。
 */
export function isHolidayDate(date, holidays = activeHolidays) {
    return holidays.has(date);
}
/**
 * 是否处于高峰时段。按北京时间判断：
 * 周一至周五、非法定节假日、09:00–12:00 或 14:00–18:00。
 */
export function isPeakTime(atMs, holidays = activeHolidays) {
    if (!Number.isFinite(atMs))
        return true; // 时钟无效时按高峰价保守处理
    const date = new Date(atMs + 8 * 60 * 60 * 1000);
    const weekday = date.getUTCDay(); // 0=周日, 6=周六
    if (weekday === 0 || weekday === 6)
        return false;
    const key = dateKeyAt(atMs);
    if (holidays.has(key))
        return false;
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    return ((minutes >= 9 * 60 && minutes < 12 * 60) ||
        (minutes >= 14 * 60 && minutes < 18 * 60));
}
export function isOffPeakTime(atMs, holidays = activeHolidays) {
    return !isPeakTime(atMs, holidays);
}
/** 从公共节假日 API 的响应中取 holiday=true 的日期（忽略调休上班日）。 */
export function parseHolidayPayload(year, payload) {
    const holiday = payload?.holiday;
    if (holiday === null || typeof holiday !== 'object' || Array.isArray(holiday))
        return [];
    const dates = [];
    for (const [key, value] of Object.entries(holiday)) {
        if (!/^\d{2}-\d{2}$/.test(key))
            continue;
        if (value?.holiday !== true)
            continue;
        const date = `${year}-${key}`;
        if (validDate(date))
            dates.push(date);
    }
    return [...new Set(dates)].sort();
}
function normalizeYears(input) {
    const result = {};
    if (input === null || typeof input !== 'object' || Array.isArray(input))
        return result;
    for (const [year, dates] of Object.entries(input)) {
        if (!/^\d{4}$/.test(year) || !Array.isArray(dates))
            continue;
        const clean = [...new Set(dates.filter((d) => typeof d === 'string' && validDate(d)))]
            .filter((d) => d.startsWith(year + '-'))
            .sort();
        if (clean.length > 0)
            result[year] = clean;
    }
    return result;
}
function mergeYears(stored) {
    const merged = {};
    for (const [year, dates] of Object.entries(DEFAULT_HOLIDAY_YEARS)) {
        merged[year] = [...dates];
    }
    if (stored) {
        for (const [year, dates] of Object.entries(stored)) {
            merged[year] = [...dates];
        }
    }
    return merged;
}
function holidayFile(dataDir) {
    return join(dataDir, 'holidays.json');
}
async function readHolidayFile(dataDir) {
    try {
        const raw = JSON.parse(await readFile(holidayFile(dataDir), 'utf8'));
        const years = normalizeYears(raw.years);
        if (Object.keys(years).length === 0)
            return null;
        return {
            updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
            years,
        };
    }
    catch {
        return null;
    }
}
async function writeHolidayFile(dataDir, file) {
    await mkdir(dataDir, { recursive: true });
    const target = holidayFile(dataDir);
    const tmp = target + '.tmp';
    await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
    await rename(tmp, target);
}
/** 启动时加载本地节假日缓存；没有缓存则使用内置日历。 */
export async function loadHolidayCalendar(dataDir) {
    const stored = await readHolidayFile(dataDir);
    const years = mergeYears(stored?.years ?? null);
    return applyHolidayYears(years, stored?.updatedAt ?? null);
}
/**
 * 同步当年 + 次年节假日。只接受有 holiday=true 数据的年份；
 * 官方未发布的年份保留原数据，不覆盖、不清空。
 */
export async function syncHolidayCalendar(dataDir, years, fetcher = fetch) {
    const stored = await readHolidayFile(dataDir);
    const current = mergeYears(stored?.years ?? null);
    const updatedAt = stored?.updatedAt ?? null;
    const uniqueYears = [...new Set(years.filter((y) => Number.isInteger(y) && y >= 2000 && y <= 2100))];
    const results = [];
    const errors = [];
    let updated = false;
    for (const year of uniqueYears) {
        const old = current[String(year)] ?? [];
        try {
            const response = await fetcher(`${HOLIDAY_API_BASE}${year}`, {
                headers: { accept: 'application/json', 'user-agent': 'dsh-companion' },
                signal: AbortSignal.timeout(8_000),
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const dates = parseHolidayPayload(year, await response.json());
            if (dates.length === 0) {
                results.push({
                    year,
                    count: old.length,
                    updated: false,
                    reason: '官方尚未发布，保持原数据',
                });
                continue;
            }
            current[String(year)] = dates;
            updated = true;
            results.push({ year, count: dates.length, updated: true, reason: null });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${year}: ${message}`);
            results.push({
                year,
                count: old.length,
                updated: false,
                reason: '同步失败，保持原数据',
            });
        }
    }
    let nextUpdatedAt = updatedAt;
    if (updated) {
        nextUpdatedAt = Date.now();
        await writeHolidayFile(dataDir, { updatedAt: nextUpdatedAt, years: current });
        applyHolidayYears(current, nextUpdatedAt);
    }
    return {
        ok: updated,
        years: results,
        updatedAt: nextUpdatedAt,
        error: errors.length > 0 ? errors.join('；') : null,
    };
}
