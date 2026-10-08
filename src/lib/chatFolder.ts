// A conversation outside any project gets a folder of its own under
// ~/Documents/LynShen, named when its first message is sent: the date, then
// the start of that message, so the folders sort by day and read at a glance.

/** Characters no folder name may hold on macOS, Windows or Linux. */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
/** Code points of the message kept in the name. */
const MAX_WORDS = 24;

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10-09 帮我做一个贪吃蛇的游戏`; the time instead of the words when the
 *  message has none to keep. */
export function chatFolderName(firstMessage: string, at: Date): string {
	const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
	const words = [...firstMessage.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim()]
		.slice(0, MAX_WORDS)
		.join('')
		.trim()
		// A trailing dot or space is dropped by Windows and hard to type.
		.replace(/[. ]+$/, '');
	return `${day} ${words || `${pad(at.getHours())}${pad(at.getMinutes())}`}`;
}
