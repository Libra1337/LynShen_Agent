import { describe, expect, it } from 'vitest';
import { avatarInitial, cacheHitText, liveCount, roleBadgeKey } from './account';

describe('account row', () => {
	it('puts the first letter of the name in the avatar', () => {
		expect(avatarInitial('yang')).toBe('Y');
		expect(avatarInitial('  Chad')).toBe('C');
		expect(avatarInitial('林深')).toBe('林');
		expect(avatarInitial('')).toBe('');
		expect(avatarInitial(undefined)).toBe('');
	});

	it('badges admins only', () => {
		expect(roleBadgeKey('admin')).toBe('shell.account.roles.admin');
		expect(roleBadgeKey('super_admin')).toBe('shell.account.roles.superAdmin');
		expect(roleBadgeKey('user')).toBeNull();
		expect(roleBadgeKey(undefined)).toBeNull();
	});
});

describe('live usage tiles', () => {
	it('show counts, or a dash without data', () => {
		expect(liveCount(12)).toBe('12');
		expect(liveCount(12345)).toBe('12,345');
		expect(liveCount(null)).toBe('—');
		expect(liveCount(Number.NaN)).toBe('—');
	});

	it('show the cache hit rate with one decimal at most', () => {
		expect(cacheHitText(0.425)).toBe('42.5%');
		expect(cacheHitText(1)).toBe('100%');
		expect(cacheHitText(0)).toBe('0%');
		expect(cacheHitText(null)).toBe('—');
	});
});
