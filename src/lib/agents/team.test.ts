import { describe, it, expect } from 'vitest';
import { listRoles, parseRole, type RoleInfo } from './roles';
import { readTeamConfig, teamNumber, teamPatch, TEAM_DEFAULTS } from './teamConfig';
import { agentChangesOf, agentChangesPanel } from './agentChanges.svelte';
import { searchRows } from '$lib/settings/nav';
import { t, setLocale } from '$lib/i18n';

describe('roles', () => {
	it('reads a role file’s frontmatter, the name falling back to the file’s', () => {
		const text = ['---', 'name: db-migrator', 'description: "Writes and checks schema migrations"', 'model: gpt-5.5-mini', 'access: inherit', 'isolation: worktree', '---', 'Run the migration tests.'].join('\n');
		expect(parseRole(text, 'migrator.md')).toEqual({
			name: 'db-migrator',
			description: 'Writes and checks schema migrations',
			model: 'gpt-5.5-mini',
			access: 'inherit',
			isolation: 'worktree'
		});
		expect(parseRole('No frontmatter here', '/u/.lynshen/roles/docs.md')).toMatchObject({ name: 'docs', description: '' });
		expect(parseRole('---\ndescription: >\n  Reads the code\n  and reports.\n---\n', 'scout.md')).toMatchObject({ name: 'scout', description: 'Reads the code and reports.' });
	});

	it('lists built-in, user and project roles, marking the replaced ones', () => {
		const role = (name: string, source: 'user' | 'project'): RoleInfo => ({
			name,
			description: '',
			source,
			path: `/${source}/${name}.md`,
			model: '',
			access: '',
			isolation: '',
			shadowedBy: null
		});
		const roles = listRoles([role('worker', 'user'), role('docs', 'user')], [role('docs', 'project')]);
		expect(roles.map((r) => [r.source, r.name, r.shadowedBy])).toEqual([
			['builtin', 'explorer', null],
			['builtin', 'worker', 'user'],
			['builtin', 'reviewer', null],
			['user', 'docs', 'project'],
			['user', 'worker', null],
			['project', 'docs', null]
		]);
	});
});

describe('team settings', () => {
	it('reads agents.* with defaults for what is missing or wrong', () => {
		expect(readTeamConfig({})).toEqual(TEAM_DEFAULTS);
		expect(readTeamConfig({ agents: { fanout: 'plan', max_live: 6, max_depth: 0, turn_token_budget: 400000, keep_worktrees_days: '3' } })).toEqual({
			fanout: 'plan',
			max_live: 6,
			max_depth: 2,
			turn_token_budget: 400000,
			keep_worktrees_days: 3
		});
		expect(readTeamConfig({ agents: { fanout: 'sometimes' } }).fanout).toBe('auto');
	});

	it('writes the valid fields over what config.json has', () => {
		const agents = { fanout: 'auto', max_live: 4, default_timeout_secs: 600 };
		expect(teamPatch(agents, { fanout: 'off', max_live: '8', max_depth: '', turn_token_budget: 0, keep_worktrees_days: 2.7 })).toEqual({
			fanout: 'off',
			max_live: 8,
			default_timeout_secs: 600,
			turn_token_budget: 0,
			keep_worktrees_days: 2
		});
		expect(teamNumber('max_live', 0)).toBeNull();
		expect(teamNumber('turn_token_budget', -5)).toBeNull();
		expect(teamNumber('turn_token_budget', 0)).toBe(0);
	});

	it('finds its rows in the settings search', () => {
		setLocale('zh');
		expect(searchRows('预算', t).map((r) => r.id)).toContain('team-budget');
		expect(searchRows('角色', t).map((r) => r.section)).toContain('team');
	});
});

describe('agent changes tab', () => {
	it('names the session and the agent', () => {
		const panel = agentChangesPanel('s1', '/root/auth_fix');
		expect(agentChangesOf(panel)).toEqual({ sessionId: 's1', agent: '/root/auth_fix' });
		expect(agentChangesOf('changes')).toBeNull();
		expect(agentChangesOf('agentdiff:')).toBeNull();
	});
});
