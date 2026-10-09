// A worktree subagent's changes open beside the chat in the Changes panel,
// pointed at the agent's workdir: one tab per agent, as a plan's page is.
// The tab's panel names the session and the agent
// (`agentdiff:<session>:<agent path, URI-encoded>`).

const PREFIX = 'agentdiff:';

export const agentChangesPanel = (sessionId: string, agent: string) => `${PREFIX}${sessionId}:${encodeURIComponent(agent)}`;

/** The session and agent an `agentdiff:` panel shows; null for any other panel. */
export function agentChangesOf(panel: string): { sessionId: string; agent: string } | null {
	if (!panel.startsWith(PREFIX)) return null;
	const rest = panel.slice(PREFIX.length);
	const at = rest.indexOf(':');
	if (at <= 0) return null;
	try {
		return { sessionId: rest.slice(0, at), agent: decodeURIComponent(rest.slice(at + 1)) };
	} catch {
		return null;
	}
}

class AgentChanges {
	/** The last view asked for; the page shell opens (or shows) its tab. */
	request = $state<{ sessionId: string; agent: string; n: number } | null>(null);

	open(sessionId: string, agent: string) {
		this.request = { sessionId, agent, n: (this.request?.n ?? 0) + 1 };
	}
}

export const agentChanges = new AgentChanges();
