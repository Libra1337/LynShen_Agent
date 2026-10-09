// Stopping one subagent (close_agent): it asks first only when the agent's
// worktree holds changes not merged yet — the files the engine named, else
// what git status finds there (a running agent names none yet).

import { t } from '$lib/i18n';
import { git } from '$lib/protocol';
import { confirm } from '$lib/ui/confirm.svelte';
import { porcelainFiles, unmergedFiles, type AgentRow } from '$lib/agentProgress';

/** True to stop the agent: it has no unmerged changes, or the user agreed. */
export async function confirmStop(row: AgentRow): Promise<boolean> {
	const a = row.team;
	let n = unmergedFiles(row);
	if (!n && a?.worktree && a.workdir && !a.merge?.ok && row.status !== 'merged' && row.status !== 'discarded')
		n = porcelainFiles(await git(['status', '--porcelain'], a.workdir).catch(() => '')).length;
	if (!n) return true;
	return confirm({
		title: t('chat.team.stopTitle', { name: row.label }),
		message: t('chat.team.stopMessage', { name: row.label, n }),
		confirmLabel: t('chat.team.stop'),
		danger: true
	});
}
