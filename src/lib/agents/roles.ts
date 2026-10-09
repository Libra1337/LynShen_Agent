// The agent team's roles as the settings page lists them: the engine's
// built-in ones, then the role files of the user (`~/.lynshen/roles/*.md`)
// and of the project (`<project>/.lynshen/roles/*.md`). A role file is
// Markdown with a frontmatter (`name`, `description`, `model`, `access`,
// `isolation`, …); its body is added to the subagent's system prompt.

export type RoleSource = 'builtin' | 'user' | 'project';

export interface RoleInfo {
	name: string;
	/** '' for a built-in one (the page words it) or a file without one. */
	description: string;
	source: RoleSource;
	/** The role file ('' for a built-in one). */
	path: string;
	model: string;
	access: string;
	isolation: string;
	/** A role of the same name from a later source replaces this one. */
	shadowedBy: Exclude<RoleSource, 'builtin'> | null;
}

export const BUILTIN_ROLES = ['explorer', 'worker', 'reviewer'] as const;

/** The frontmatter fields of a role file; the name falls back to the file's. */
export function parseRole(text: string, file: string): Pick<RoleInfo, 'name' | 'description' | 'model' | 'access' | 'isolation'> {
	const fields: Record<string, string> = {};
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
	if (lines[0]?.trim() === '---') {
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i]!;
			if (line.trim() === '---') break;
			const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
			if (!m) continue;
			let value = m[2]!.trim();
			// A folded or literal block: its indented lines, as one line.
			if (value === '>' || value === '|' || value === '>-' || value === '|-') {
				const block: string[] = [];
				while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
				value = block.join(' ');
			}
			fields[m[1]!.toLowerCase()] = unquote(value);
		}
	}
	const base = file.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? '';
	return {
		name: fields.name || base,
		description: fields.description ?? '',
		model: fields.model ?? '',
		access: fields.access ?? '',
		isolation: fields.isolation ?? ''
	};
}

const unquote = (v: string) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v);

const ORDER: Record<RoleSource, number> = { builtin: 0, user: 1, project: 2 };

/** Every role found, built-in first, then the user's and the project's (by
 *  name), each marked when a later source has one of the same name. */
export function listRoles(user: RoleInfo[], project: RoleInfo[]): RoleInfo[] {
	const builtin: RoleInfo[] = BUILTIN_ROLES.map((name) => ({
		name,
		description: '',
		source: 'builtin',
		path: '',
		model: '',
		access: '',
		isolation: '',
		shadowedBy: null
	}));
	const all = [...builtin, ...user, ...project].sort(
		(a, b) => ORDER[a.source] - ORDER[b.source] || (a.source === 'builtin' ? 0 : a.name.localeCompare(b.name))
	);
	return all.map((r) => {
		const later = all.filter((x) => x.name === r.name && ORDER[x.source] > ORDER[r.source]).pop();
		return { ...r, shadowedBy: later ? (later.source as Exclude<RoleSource, 'builtin'>) : null };
	});
}
