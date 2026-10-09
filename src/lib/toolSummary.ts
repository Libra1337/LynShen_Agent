// A tool call's one-line summary — icon, verb and target — shared by the tool
// card and the header of a run of calls (which shows the latest one).
import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
import FilePlusIcon from 'phosphor-svelte/lib/FilePlusIcon';
import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
import ListBulletsIcon from 'phosphor-svelte/lib/ListBulletsIcon';
import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
import LinkIcon from 'phosphor-svelte/lib/LinkIcon';
import BrowserIcon from 'phosphor-svelte/lib/BrowserIcon';
import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
import PlugIcon from 'phosphor-svelte/lib/PlugIcon';
import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
import ChatsIcon from 'phosphor-svelte/lib/ChatsIcon';
import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
import { t } from '$lib/i18n';

const VERBS: Record<string, string> = {
	read: 'Read',
	write: 'Wrote',
	str_replace: 'Edited',
	hashline_edit: 'Edited',
	apply_patch: 'Edited',
	bash: 'Ran',
	exec_command: 'Ran',
	write_stdin: 'Wrote stdin',
	ls: 'Listed',
	ripgrep: 'Searched',
	outline: 'Outlined',
	web_search: 'Searched web',
	web_fetch: 'Fetched',
	generate_image: 'Generated image',
	spawn_agent: 'Started subagent',
	wait_agent: 'Waited for subagents',
	list_agents: 'Listed subagents',
	send_message: 'Messaged subagent',
	close_agent: 'Closed subagent',
	agent_wait: 'Waited for subagents',
	agent_sendInput: 'Messaged subagent',
	agent_sendMessage: 'Messaged subagent',
	agent_closeAgent: 'Closed subagent',
	agent_interruptAgent: 'Interrupted subagent',
	agent_resumeAgent: 'Resumed subagent',
	agent_listAgents: 'Listed subagents'
};

// One glyph per kind of tool, so a run of calls scans at a glance.
const ICONS: Record<string, typeof WrenchIcon> = {
	bash: TerminalWindowIcon,
	exec_command: TerminalWindowIcon,
	write_stdin: TerminalWindowIcon,
	read: FileTextIcon,
	write: FilePlusIcon,
	str_replace: PencilSimpleIcon,
	hashline_edit: PencilSimpleIcon,
	apply_patch: PencilSimpleIcon,
	ls: FolderOpenIcon,
	ripgrep: MagnifyingGlassIcon,
	outline: ListBulletsIcon,
	web_search: GlobeIcon,
	web_fetch: LinkIcon,
	generate_image: ImageIcon,
	Task: RobotIcon,
	Agent: RobotIcon,
	spawn_agent: RobotIcon,
	wait_agent: RobotIcon,
	list_agents: RobotIcon,
	send_message: RobotIcon,
	close_agent: RobotIcon,
	agent_wait: RobotIcon,
	TodoWrite: ListChecksIcon,
	update_plan: ListChecksIcon,
	list_sessions: ChatsIcon,
	read_session: ChatsIcon,
	send_to_session: PaperPlaneTiltIcon
};

// The tools that reach other conversations say what they did in the
// interface language (a send card is titled by the conversation it wrote
// to, see sessions/sessionMessage.ts sendCardProps).
const LOCAL_VERBS: Record<string, string> = {
	list_sessions: 'chat.sessionTools.list',
	read_session: 'chat.sessionTools.read',
	send_to_session: 'chat.sessionTools.send'
};

export const toolVerb = (name: string) => (LOCAL_VERBS[name] ? t(LOCAL_VERBS[name]) : (VERBS[name] ?? name));

export function toolIcon(name: string): typeof WrenchIcon {
	return (
		ICONS[name] ??
		(name.startsWith('browser_') ? BrowserIcon : name.startsWith('mcp__') || name.includes('.') ? PlugIcon : WrenchIcon)
	);
}

/** Codex reports commands as run: `/bin/zsh -lc '<command>'`. The command. */
export function unwrapShell(c: string): string {
	const m = /^\/bin\/(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/.exec(c.trim());
	if (!m) return c;
	return m[1] === '"' ? m[2]!.replace(/\\(["\\$`])/g, '$1') : m[2]!;
}

export function parseToolOutput(output: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(output);
		return v && typeof v === 'object' ? v : null;
	} catch {
		return null;
	}
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** What the call acted on: the command, search, file name or query. */
export function toolTarget(name: string, parsed: Record<string, unknown> | null): string {
	if (!parsed) return '';
	if (name === 'bash' || name === 'exec_command' || name === 'ripgrep') {
		const cmd = unwrapShell(str(parsed.command) || str(parsed.pattern)).replace(/\s+/g, ' ');
		return cmd.length > 64 ? cmd.slice(0, 64) + '…' : cmd;
	}
	if (name === 'read_session' || name === 'send_to_session')
		return str(parsed.to_title) || str(parsed.title) || str(parsed.session_title) || str(parsed.to) || str(parsed.session);
	if (name === 'list_sessions') {
		const list = Array.isArray(parsed) ? parsed : parsed.sessions;
		return Array.isArray(list) ? t('chat.sessionTools.count', { n: list.length }) : '';
	}
	if (typeof parsed.path === 'string') return parsed.path.split('/').pop() || parsed.path;
	if (name === 'web_search') return str(parsed.query);
	if (name === 'generate_image' && Array.isArray(parsed.paths)) return parsed.paths.map(String).join(', ');
	return '';
}
