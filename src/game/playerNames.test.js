import { normalizePlayerName } from './playerNames';

describe('normalizePlayerName', () => {
    it('lowercases a single-word name', () => {
        expect(normalizePlayerName('Alice')).toBe('alice');
    });

    it('strips all internal whitespace from a multi-word name (improvements item 35)', () => {
        expect(normalizePlayerName('Alice Smith')).toBe('alicesmith');
    });

    it('strips leading and trailing whitespace too', () => {
        expect(normalizePlayerName('  Alice  ')).toBe('alice');
    });

    it('collapses names that differ only in whitespace/case to the same key', () => {
        expect(normalizePlayerName('Alice Smith')).toBe(normalizePlayerName('alice   smith'));
    });
});
