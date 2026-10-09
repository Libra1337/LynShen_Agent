// How the agent team's words read in the cards: a role, an agent named in a
// message, a state the engine words beyond the usual five.

import { t } from '$lib/i18n';
import { BUILTIN_ROLES } from './roles';
import { shortPath, type AgentRow } from '$lib/agentProgress';

/** A built-in role in the interface language; a custom one as it is named. */
export const roleLabel = (role: string) => ((BUILTIN_ROLES as readonly string[]).includes(role) ? t(`chat.team.role.${role}`) : role);

/** An agent a message names: `parent` (or `/root`, its path) is the main
 *  agent, `hook:<event>` a hook's output, a path its own name. */
export const agentName = (path: string) =>
	path === 'parent' || path === '' || path === '/root'
		? t('chat.team.parent')
		: path.startsWith('hook:')
			? t('chat.team.hook', { name: path.slice(5) })
			: shortPath(path);

/** A line for a state the five run states do not tell: the team's budget
 *  stopped it, or its changes did not merge ('' otherwise). */
export function teamNote(row: Pick<AgentRow, 'status'>): string {
	if (row.status === 'budget_exhausted') return t('chat.team.budgetExhausted');
	if (row.status === 'conflict') return t('chat.team.conflict');
	return '';
}
