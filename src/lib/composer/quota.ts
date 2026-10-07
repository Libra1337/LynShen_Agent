// Usage windows of a plan the session draws on, for the "remaining quota"
// part of the context card. Today the only source is the official plan an
// engine reports (`plan_usage`: Claude subscription, ChatGPT plan); a gateway
// coding plan can map into the same QuotaWindow shape.
import { t } from '$lib/i18n';

export interface QuotaWindow {
	/** Shown name, e.g. "5 小时", "每周". */
	label: string;
	/** Share used, 0–100. */
	usedPct: number;
	/** When the window resets (ms since the epoch); null when unknown. */
	resetsAt: number | null;
}

export interface QuotaSource {
	/** The plan's name, e.g. "Max"; null when the source does not say. */
	plan: string | null;
	windows: QuotaWindow[];
}

/** One window of an engine's `plan_usage` (see ChatState.planUsage). */
export interface PlanUsageWindow {
	key: string;
	used: number;
	resetsAt: number | null;
	minutes: number | null;
}

/** Name of an engine plan window: by its length, else its key. */
export function planWindowLabel(w: { key: string; minutes: number | null }): string {
	if (w.key === 'seven_day_overage_included') return t('chat.quota.weekOverage');
	const m = w.minutes ?? (w.key === 'five_hour' ? 300 : w.key === 'seven_day' ? 10_080 : null);
	if (m === 10_080) return t('chat.quota.week');
	if (m === null) return w.key;
	return m < 1440 ? t('chat.quota.hours', { n: Math.round(m / 60) }) : t('chat.quota.days', { n: Math.round(m / 1440) });
}

/** The engine-reported official plan as a quota source; null without windows. */
export function planQuota(usage: { plan: string | null; windows: PlanUsageWindow[] } | null): QuotaSource | null {
	if (!usage?.windows.length) return null;
	return {
		plan: usage.plan ? usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1) : null,
		windows: usage.windows.map((w) => ({ label: planWindowLabel(w), usedPct: w.used, resetsAt: w.resetsAt }))
	};
}

/** Share left of a window, 0–100. */
export const remainingPct = (w: QuotaWindow) => Math.max(0, Math.min(100, 100 - w.usedPct));

/** When a window resets: the time of day within the next 24 hours ("21:20"),
 *  else the date ("10月11日", "Oct 11"). */
export function fmtResetAt(at: number, locale: 'zh' | 'en', now = Date.now()): string {
	const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
	const d = new Date(at);
	if (at - now < 24 * 3_600_000) return d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
	if (locale === 'zh') return `${d.getMonth() + 1}月${d.getDate()}日`;
	return d.toLocaleDateString(tag, { month: 'short', day: 'numeric' });
}
