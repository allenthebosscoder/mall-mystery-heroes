import { complete } from './commandCompletion';

const players = [
    { name: 'Alice Smith', isAlive: true },
    { name: 'Alex', isAlive: true },
    { name: 'Bob', isAlive: false },
];

const missions = [
    { taskIndex: 1, isComplete: false },
    { taskIndex: 2, isComplete: false },
    { taskIndex: 3, isComplete: true },
];

describe('complete — command word (slot 0)', () => {
    it('completes a unique command word', () => {
        const result = complete('/ki', {});
        expect(result).toEqual({
            applied: true,
            tokenStart: 0,
            tokenEnd: 3,
            commonPrefix: '/kill',
            candidates: ['/kill'],
            isUnique: true,
        });
    });

    it('completes to the longest common prefix across ambiguous commands', () => {
        // /add and /openseason share no prefix beyond "/", but /revive is the
        // only known command starting with "/r".
        const result = complete('/', {});
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(false);
        expect(result.commonPrefix).toBe('/');
    });

    it('does nothing for a command word matching no known command', () => {
        const result = complete('/xyz', {});
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — player-name slots', () => {
    it('completes to the longest common prefix when ambiguous', () => {
        const result = complete('/kill Al', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(false);
        expect(result.commonPrefix).toBe('Al');
        expect(result.candidates).toEqual(['Alice Smith', 'Alex']);
    });

    it('completes a unique match and wraps a multi-word name in brackets', () => {
        const result = complete('/kill Alice', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('[Alice Smith]');
    });

    it('completes the second player-name slot for /kill independently of the first', () => {
        const result = complete('/kill [Alice Smith] Al', { players });
        expect(result.applied).toBe(true);
        expect(result.tokenStart).toBe('/kill [Alice Smith] '.length);
        expect(result.commonPrefix).toBe('Al');
    });

    it('offers every player when nothing has been typed yet for the slot', () => {
        const result = complete('/add ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['Alice Smith', 'Alex', 'Bob']);
    });

    it('does not suggest players for /add\'s second (numeric) slot', () => {
        const result = complete('/add alice 5', { players });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — /revive only suggests dead players', () => {
    it('offers only dead players, not the full roster', () => {
        const result = complete('/revive ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['Bob']);
    });

    it('completes a unique dead-player match', () => {
        const result = complete('/revive B', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('Bob');
    });

    it('does nothing when the typed prefix matches no dead player', () => {
        // "Al" matches two *living* players, but neither is a candidate here.
        const result = complete('/revive Al', { players });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — /openseason', () => {
    it('completes the player slot', () => {
        const result = complete('/openseason B', { players });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('Bob');
    });

    it('completes the start/end literal slot', () => {
        const result = complete('/openseason bob s', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('start');
    });
});

describe('complete — /mission sub-command completes to the bare word, not a full skeleton', () => {
    it('offers all four sub-commands when nothing has been typed yet', () => {
        const result = complete('/mission ', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['done', 'end', 'start', 'view']);
    });

    it('completes "/mission s" to the bare word "start"', () => {
        const result = complete('/mission s', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('start');
    });

    it('completes "/mission d" to the bare word "done"', () => {
        const result = complete('/mission d', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('done');
    });
});

describe('complete — /mission done', () => {
    it('completes the player slot', () => {
        const result = complete('/mission done Al', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('Al');
        expect(result.candidates).toEqual(['Alice Smith', 'Alex']);
    });

    it('completes the mission-index slot, offering only active missions', () => {
        const result = complete('/mission done alice ', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['1', '2']);
    });

    it('does not offer an already-ended mission index', () => {
        const result = complete('/mission done alice 3', { players, missions });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — /mission end offers only active missions', () => {
    it('offers every active mission index', () => {
        const result = complete('/mission end ', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['1', '2']);
    });

    it('completes a unique index', () => {
        const result = complete('/mission end 1', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('1');
    });
});

describe('complete — /mission start and /mission view take no arguments', () => {
    it('has nothing to complete after "/mission start "', () => {
        const result = complete('/mission start ', { players, missions });
        expect(result).toEqual({ applied: false });
    });

    it('has nothing to complete after "/mission view "', () => {
        const result = complete('/mission view ', { players, missions });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — unimplemented commands only complete the command word', () => {
    it.each(['/whisper', '/broadcast', '/leaderboard'])(
        'does not suggest arguments for %s',
        (command) => {
            const result = complete(`${command} al`, { players });
            expect(result).toEqual({ applied: false });
        }
    );
});

describe('complete — no data provided', () => {
    it('does not throw when players/missions are omitted', () => {
        expect(() => complete('/kill al')).not.toThrow();
        expect(complete('/kill al')).toEqual({ applied: false });
    });
});
