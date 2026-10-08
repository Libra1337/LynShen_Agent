import { describe, it, expect } from 'vitest';
import { chatFolderName } from './chatFolder';

const at = new Date(2026, 9, 9, 1, 34);

describe('chatFolderName', () => {
	it('names the folder by the day and the start of the first message', () => {
		expect(chatFolderName('帮我做一个贪吃蛇的游戏', at)).toBe('2026-10-09 帮我做一个贪吃蛇的游戏');
		expect(chatFolderName('  fix   the\nlogin page  ', at)).toBe('2026-10-09 fix the login page');
	});

	it('keeps 24 characters and nothing a file system refuses', () => {
		expect(chatFolderName('a/b\\c:d*e?f"g<h>i|j', at)).toBe('2026-10-09 a b c d e f g h i j');
		expect(chatFolderName('一二三四五六七八九十一二三四五六七八九十一二三四五六', at)).toBe('2026-10-09 一二三四五六七八九十一二三四五六七八九十一二三四');
		expect(chatFolderName('done...', at)).toBe('2026-10-09 done');
	});

	it('uses the time when the message has no words to keep', () => {
		expect(chatFolderName('', at)).toBe('2026-10-09 0134');
		expect(chatFolderName(' /// ', at)).toBe('2026-10-09 0134');
	});
});
