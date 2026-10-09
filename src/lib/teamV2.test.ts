import { describe, it, expect, beforeEach } from 'vitest';
import { ChatState } from './chat.svelte';
import {
	agentRows,
	attemptGroups,
	attemptState,
	boardGroups,
	boardProgress,
	canStop,
	numstatTotals,
	unmergedFiles,
	waitingOn
} from './agentProgress';
import { parseDelivery } from './delivery';
import { parseSubagentResult } from './agents/subagentResult';
import { agentName } from './agents/teamText';
import { listHooks, validHookList, withHook, withoutHook } from './agents/teamHooks';
import { readTeamConfig, teamPatch } from './agents/teamConfig';
import { searchRows } from './settings/nav';
import { setLocale, t } from './i18n';

// Frames as the LynShen engine sends them for the agent team, second step:
// the task board, background agents, best-of-N attempts.
const board = {
	type: 'task_board',
	tasks: [
		{ id: 't0', title: 'Read the auth module', detail: 'Map the login flow', status: 'completed', owner: '/root/scan', depends_on: [], role: 'explorer', files: [], result: 'Login goes through src/auth.ts', updated_at: 1000 },
		{ id: 't1', title: 'Fix the login check', detail: '', status: 'claimed', owner: '/root/fix', depends_on: ['t0'], role: 'worker', files: ['src/auth.ts'], result: null, updated_at: 2000 },
		{ id: 't2', title: 'Review the fix', detail: '', status: 'blocked', owner: null, depends_on: ['t1', 't9'], role: 'reviewer', files: [], result: null, updated_at: 2000 },
		{ id: 't3', title: 'Update the docs', status: 'pending', owner: null, depends_on: ['t0'], role: null, files: ['docs/auth.md'], updated_at: 2100 },
		{ id: 't4', title: 'Try the old client', status: 'odd', owner: '/root/old', depends_on: 'x', updated_at: 2200 },
		{ title: 'no id' }
	]
};
const BG = '/root/watch';
const life = (path: string, status: string, extra: Record<string, unknown> = {}) => ({ type: 'subagent_lifecycle', path, status, message: '', ...extra });
const attempt = (n: number, status = 'running', extra: Record<string, unknown> = {}) =>
	life(`/root/login_${n}`, status, {
		label: `login_${n}`,
		model: n === 2 ? 'claude-sonnet-5' : 'gpt-5.5',
		role: 'worker',
		workdir: `/repo/.lynshen/agents/login_${n}-1`,
		isolation: 'worktree',
		attempt_group: 'fix_login',
		attempt: n,
		background: false,
		...extra
	});
const rowsOf = (c: ChatState, since = 0) =>
	agentRows({ runs: c.agentRuns, subagents: c.subagents, team: c.team, stopping: c.stopRequested, since });

describe('agent team v2: task board', () => {
	it('keeps the whole snapshot, read with defaults', () => {
		const c = new ChatState();
		expect(c.taskBoard).toBeNull();
		c.handle(board);
		expect(c.taskBoard!.map((x) => x.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
		expect(c.taskBoard![1]).toEqual({
			id: 't1',
			title: 'Fix the login check',
			detail: '',
			status: 'claimed',
			owner: '/root/fix',
			dependsOn: ['t0'],
			role: 'worker',
			files: ['src/auth.ts'],
			result: '',
			updatedAt: 2000
		});
		// An unknown state is read as pending; a missing list as none.
		expect(c.taskBoard![4]).toMatchObject({ status: 'pending', owner: '/root/old', dependsOn: [], role: '', detail: '' });
		// The next snapshot replaces it (a reconnect sends one again).
		c.handle({ type: 'task_board', tasks: [{ ...board.tasks[1], status: 'completed', result: 'Fixed; tests pass' }] });
		expect(c.taskBoard).toHaveLength(1);
		expect(c.taskBoard![0]).toMatchObject({ status: 'completed', result: 'Fixed; tests pass' });
		// It stays past the turn.
		c.handle({ type: 'connecting' });
		c.handle({ type: 'status', message: 'ready' });
		c.handle({ type: 'connecting' });
		expect(c.taskBoard).toHaveLength(1);
	});

	it('groups the board by state and says what a task waits for', () => {
		const c = new ChatState();
		c.handle(board);
		const tasks = c.taskBoard!;
		expect(boardGroups(tasks).map((g) => [g.status, g.tasks.map((x) => x.id)])).toEqual([
			['claimed', ['t1']],
			['blocked', ['t2']],
			['pending', ['t3', 't4']],
			['completed', ['t0']]
		]);
		// t1 is not done yet; t9 is not on the board.
		expect(waitingOn(tasks[2]!, tasks)).toEqual([
			{ id: 't1', title: 'Fix the login check' },
			{ id: 't9', title: '' }
		]);
		// Its dependency is done: nothing to wait for.
		expect(waitingOn(tasks[3]!, tasks)).toEqual([]);
		expect(boardProgress(tasks)).toEqual({ done: 1, total: 5 });
	});
});

describe('agent team v2: background agents', () => {
	beforeEach(() => setLocale('zh'));

	it('reads background and attempts from the lifecycle and the trace', () => {
		const c = new ChatState();
		c.handle(life(BG, 'running', { label: 'watch', background: true }));
		c.handle({ type: 'agent_runs', workflows: [], agents: [{ id: '/root/login_1', label: 'login_1', state: 'running', attempt_group: 'fix_login', attempt: 1, background: false }] });
		expect(c.subagents[BG]!.background).toBe(true);
		expect(c.team[BG]).toMatchObject({ background: true, attemptGroup: null, attempt: null });
		expect(c.team['/root/login_1']).toMatchObject({ background: false, attemptGroup: 'fix_login', attempt: 1 });
		const rows = rowsOf(c);
		expect(rows.map((r) => [r.id, r.background ?? false, r.attemptGroup ?? null, r.attempt ?? null])).toEqual([
			['/root/login_1', false, 'fix_login', 1],
			[BG, true, null, null]
		]);
		// A later frame without the fields leaves them as they were.
		c.handle(life(BG, 'running', { message: 'tick' }));
		expect(c.team[BG]!.background).toBe(true);
		expect(rowsOf(c).find((r) => r.id === BG)!.background).toBe(true);
	});

	it('keeps a background agent listed past its turn and through the turn its result starts', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle(life(BG, 'running', { label: 'watch', background: true }));
		c.handle({ type: 'status', message: 'ready' });
		// The turn is over; the agent still runs and is still listed.
		expect(rowsOf(c, c.turnStartedAt).map((r) => [r.id, r.state])).toEqual([[BG, 'running']]);
		// It finishes on its own, and its result starts a turn.
		c.handle(life(BG, 'completed', { message: 'finished' }));
		c.handle({ type: 'user_message', content: `<subagent_result path="${BG}" status="completed">\nThe build is green again.\n</subagent_result>` });
		c.handle({ type: 'connecting' });
		expect(c.subagents[BG]).toBeDefined();
		expect(rowsOf(c, c.turnStartedAt).map((r) => [r.id, r.state])).toEqual([[BG, 'done']]);
		// The turn's user item is a user turn that renders as one line.
		const user = c.messages.findLast((m) => m.kind === 'user');
		expect(user?.kind === 'user' && parseDelivery(user.text)).toEqual({
			kind: 'message',
			label: '子智能体 watch 完成，继续处理',
			body: 'The build is green again.'
		});
		// The turn after that no longer lists it.
		c.handle({ type: 'status', message: 'ready' });
		c.handle({ type: 'connecting' });
		expect(c.subagents[BG]).toBeUndefined();
	});

	it('drops a background agent that ended inside its own turn, like any other', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle(life(BG, 'running', { background: true }));
		c.handle(life(BG, 'completed'));
		c.handle({ type: 'status', message: 'ready' });
		c.handle({ type: 'connecting' });
		expect(c.subagents[BG]).toBeUndefined();
	});

	it('stops one agent with close_agent', () => {
		const c = new ChatState();
		c.handle(life('/root/a', 'running'));
		expect(canStop(rowsOf(c)[0]!)).toBe(true);
		expect(c.closeAgent('/root/a')).toEqual({ op: 'close_agent', target: '/root/a' });
		const row = rowsOf(c)[0]!;
		expect(row.stopping).toBe(true);
		expect(canStop(row)).toBe(false);
		c.handle(life('/root/a', 'closed'));
		expect(c.stopRequested['/root/a']).toBeUndefined();
		expect(rowsOf(c)[0]).toMatchObject({ state: 'stopped' });
		expect(rowsOf(c)[0]!.stopping).toBeUndefined();
	});

	it('takes back stops an older engine refuses, with a note', () => {
		const c = new ChatState();
		c.handle(life('/root/a', 'running'));
		c.closeAgent('/root/a');
		c.handle({ type: 'error', message: 'unknown op: close_agent' });
		expect(c.stopRequested).toEqual({});
		expect(c.lastError).toBeNull();
		expect(c.messages).toEqual([{ kind: 'system', text: t('chat.team.stopUnsupported') }]);
	});

	it('takes back a stop or a pick the engine refuses with team v2 switched off', () => {
		const off = (op: string) => `${op} is not available: agent team v2 (Beta) is switched off (agents.team_v2 is false)`;
		const c = new ChatState();
		c.handle(life('/root/a', 'running'));
		c.closeAgent('/root/a');
		c.handle({ type: 'error', message: off('close_agent') });
		expect(c.stopRequested).toEqual({});
		expect(c.lastError).toBeNull();
		c.handle(attempt(1, 'completed'));
		c.handle(attempt(2, 'completed'));
		c.pickAttempt('fix_login', '/root/login_2');
		c.handle({ type: 'error', message: off('pick_attempt') });
		expect(c.attemptPicks).toEqual({});
		expect(c.team['/root/login_1']!.pending).toBeNull();
		expect(c.team['/root/login_2']!.pending).toBeNull();
		expect(c.lastError).toBeNull();
		expect(c.messages).toEqual([
			{ kind: 'system', text: t('chat.team.v2Off') },
			{ kind: 'system', text: t('chat.team.v2Off') }
		]);
	});

	it('counts the unmerged changes a stop asks about', () => {
		const c = new ChatState();
		c.handle(attempt(1, 'running', { files_changed: ['src/auth.ts'] }));
		c.handle(life('/root/b', 'running', { workdir: '/repo', isolation: 'none', files_changed: ['a.ts'] }));
		const [w, plain] = rowsOf(c);
		expect(unmergedFiles(w!)).toBe(1);
		expect(unmergedFiles(plain!)).toBe(0);
		c.handle({ type: 'merge_result', target: '/root/login_1', action: 'apply', ok: true, files: ['src/auth.ts'], conflicts: [] });
		expect(unmergedFiles(rowsOf(c)[0]!)).toBe(0);
	});
});

describe('agent team v2: best-of-N', () => {
	it('groups attempts by number and picks one', () => {
		const c = new ChatState();
		c.handle(attempt(2, 'running'));
		c.handle(attempt(1, 'running'));
		c.handle(attempt(3, 'running'));
		c.handle(life('/root/other', 'running'));
		for (const n of [1, 2]) c.handle(attempt(n, 'completed', { files_changed: ['src/auth.ts'] }));
		c.handle(attempt(3, 'errored'));
		const groups = attemptGroups(rowsOf(c));
		expect([...groups.keys()]).toEqual(['fix_login']);
		expect(groups.get('fix_login')!.map((r) => [r.attempt, r.state])).toEqual([
			[1, 'done'],
			[2, 'done'],
			[3, 'failed']
		]);
		expect(groups.get('fix_login')!.map(attemptState)).toEqual(['open', 'open', 'open']);

		expect(c.pickAttempt('fix_login', '/root/login_2')).toEqual({ op: 'pick_attempt', group: 'fix_login', target: '/root/login_2' });
		expect(c.attemptPicks).toEqual({ fix_login: '/root/login_2' });
		expect(attemptGroups(rowsOf(c)).get('fix_login')!.map(attemptState)).toEqual(['discarding', 'merging', 'discarding']);
		// One merge_result per attempt.
		c.handle({ type: 'merge_result', target: '/root/login_2', action: 'apply', ok: true, files: ['src/auth.ts'], conflicts: [] });
		c.handle({ type: 'merge_result', target: '/root/login_1', action: 'discard', ok: true, files: [], conflicts: [] });
		c.handle({ type: 'merge_result', target: '/root/login_3', action: 'discard', ok: true, files: [], conflicts: [] });
		expect(attemptGroups(rowsOf(c)).get('fix_login')!.map(attemptState)).toEqual(['discarded', 'merged', 'discarded']);
		// The merge keeps what was known of the attempt.
		expect(c.team['/root/login_2']).toMatchObject({ attemptGroup: 'fix_login', attempt: 2, role: 'worker', worktree: true });
	});

	it('marks a pick an older engine refuses as failed', () => {
		const c = new ChatState();
		c.handle(attempt(1, 'completed', { files_changed: ['a.ts'] }));
		c.handle(attempt(2, 'completed', { files_changed: ['a.ts'] }));
		c.pickAttempt('fix_login', '/root/login_1');
		c.handle({ type: 'error', message: 'unknown op: pick_attempt' });
		expect(c.messages).toEqual([]);
		expect(c.attemptPicks).toEqual({});
		expect(attemptGroups(rowsOf(c)).get('fix_login')!.map(attemptState)).toEqual(['failed', 'failed']);
	});

	it('sums the lines of a worktree diff', () => {
		expect(numstatTotals('12\t3\tsrc/auth.ts\n-\t-\tlogo.png\n0\t7\tsrc/old.ts\n')).toEqual({ added: 12, removed: 10 });
		expect(numstatTotals('')).toEqual({ added: 0, removed: 0 });
	});
});

describe('agent team v2: a result that starts a turn', () => {
	beforeEach(() => setLocale('zh'));

	it('reads the marked result, one block per agent', () => {
		expect(parseSubagentResult("<subagent_result path='/root/a'>done</subagent_result>")).toEqual({ paths: ['/root/a'], failed: false, body: 'done' });
		const two = '<subagent_result path="/root/a" status="completed">A ok</subagent_result>\n<subagent_result path=/root/b status=errored>\nB broke\n</subagent_result>';
		expect(parseSubagentResult(two)).toEqual({ paths: ['/root/a', '/root/b'], failed: true, body: 'A ok\n\nB broke' });
		expect(parseDelivery(two)).toEqual({ kind: 'message', label: '子智能体 a、b 出错，继续处理', body: 'A ok\n\nB broke' });
		// No closing tag: the rest is its result.
		expect(parseSubagentResult('<subagent_result path="/root/a">cut short')).toMatchObject({ body: 'cut short' });
		// What the user wrote stays a bubble.
		expect(parseSubagentResult('看看 <subagent_result path="/root/a">')).toBeNull();
		expect(parseSubagentResult('<subagent_result>no path</subagent_result>')).toBeNull();
		expect(parseDelivery('修复登录跳转')).toBeNull();
	});

	it('renders it the same in a reloaded transcript, and the team’s messages come back', () => {
		const c = new ChatState();
		c.handle({
			type: 'transcript',
			items: [
				{ role: 'user', content: 'Fix the login' },
				{ role: 'agent_message', from: '/root/fix', to: '/root', summary: 'Tests pass' },
				{ role: 'user', content: '<subagent_result path="/root/fix">Fixed.</subagent_result>' },
				{ role: 'assistant', content: 'Merged the fix.' }
			]
		});
		const marked = c.messages[2];
		expect(marked?.kind === 'user' && parseDelivery(marked.text)?.kind).toBe('message');
		expect(c.agentMessages.map((m) => [m.from, m.to, m.summary])).toEqual([['/root/fix', '/root', 'Tests pass']]);
		// The turn list names that turn by its line.
		c.turnEdits = { 1: { 'src/auth.ts': { added: 3, removed: 1 } } };
		expect(c.turnTimeline[0]!.text).toBe('子智能体 fix 完成，继续处理');
		expect(agentName('/root')).toBe('主智能体');
	});
});

describe('agent team v2: settings', () => {
	it('reads and writes wake_on_result and review_on_complete', () => {
		expect(readTeamConfig({})).toMatchObject({ wake_on_result: true, review_on_complete: false });
		expect(readTeamConfig({ agents: { wake_on_result: false, review_on_complete: 'yes' } })).toMatchObject({ wake_on_result: false, review_on_complete: false });
		expect(teamPatch({ fanout: 'auto', other: 1 }, { wake_on_result: false, review_on_complete: true })).toEqual({
			fanout: 'auto',
			other: 1,
			wake_on_result: false,
			review_on_complete: true
		});
	});

	it('finds the new rows in the settings search', () => {
		setLocale('zh');
		expect(searchRows('自动继续', t).map((r) => r.id)).toContain('team-wake');
		expect(searchRows('审查', t).map((r) => r.id)).toContain('team-review');
		expect(searchRows('钩子', t).map((r) => r.id)).toContain('team-hooks');
		expect(searchRows('Beta', t).map((r) => r.id)).toContain('team-v2');
		expect(searchRows('任务板', t).map((r) => r.id)).toContain('team-v2');
		setLocale('en');
		expect(searchRows('team v2', t).map((r) => r.id)).toContain('team-v2');
		expect(searchRows('idle', t).map((r) => r.id)).toContain('team-hook-agent_idle');
	});

	it('edits the two hook keys and leaves the rest of hooks.json alone', () => {
		const hooks = {
			stop: [{ command: 'say done' }],
			task_completed: [{ command: 'notify.sh' }, { note: 'kept as it is' }, { command: 'log.sh', tools: ['bash'] }]
		};
		expect(listHooks(hooks, 'task_completed')).toEqual([
			{ index: 0, command: 'notify.sh', tools: null },
			{ index: 2, command: 'log.sh', tools: ['bash'] }
		]);
		expect(listHooks(hooks, 'agent_idle')).toEqual([]);
		expect(withHook(hooks, 'agent_idle', '  ping.sh ')).toEqual([{ command: 'ping.sh' }]);
		expect(withHook(hooks, 'task_completed', 'notify.sh')).toBeNull();
		expect(withHook(hooks, 'task_completed', '   ')).toBeNull();
		expect(withoutHook(hooks, 'task_completed', 2, 'log.sh')).toEqual([{ command: 'notify.sh' }, { note: 'kept as it is' }]);
		// The file changed under the page: nothing is removed.
		expect(withoutHook(hooks, 'task_completed', 0, 'log.sh')).toBeNull();
		expect(validHookList([{ command: 'a' }, { note: 1 }])).toBe(true);
		expect(validHookList([{ command: 3 }])).toBe(false);
		expect(validHookList([undefined])).toBe(false);
	});
});

describe('hook output in team messages', () => {
	it('names the hook instead of a path', async () => {
		const { agentName } = await import('$lib/agents/teamText');
		expect(agentName('hook:task_completed')).toContain('task_completed');
		expect(agentName('hook:task_completed')).not.toContain('hook:');
		expect(agentName('/root/w1')).toBe('w1');
	});
});
