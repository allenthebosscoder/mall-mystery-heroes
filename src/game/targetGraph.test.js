import { maxTargetsFor, shuffle, buildTargetGraph } from './targetGraph';

/** Deterministic stand-in for Math.random: cycles a fixed sequence. */
const seededRng = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
};

const rosterOf = (n) => Array.from({ length: n }, (_, i) => `player${i + 1}`);

describe('maxTargetsFor', () => {
    it('gives 1 target in a small game', () => {
        expect(maxTargetsFor(5)).toBe(1);
    });

    it('gives 2 targets above 5 players', () => {
        expect(maxTargetsFor(6)).toBe(2);
        expect(maxTargetsFor(15)).toBe(2);
    });

    it('gives 3 targets above 15 players', () => {
        expect(maxTargetsFor(16)).toBe(3);
    });

    it('never asks for more targets than there are other players', () => {
        expect(maxTargetsFor(1)).toBe(0);
        expect(maxTargetsFor(2)).toBe(1);
    });
});

describe('shuffle', () => {
    it('returns a new array and leaves the input untouched', () => {
        const input = ['a', 'b', 'c'];
        const result = shuffle(input, seededRng([0.9, 0.1, 0.5]));

        expect(result).not.toBe(input);
        expect(input).toEqual(['a', 'b', 'c']);
    });

    it('preserves every element exactly once', () => {
        const input = rosterOf(20);
        expect(shuffle(input, Math.random).sort()).toEqual([...input].sort());
    });

    it('can produce every permutation of a 3-element array', () => {
        // The pre-existing implementation looped to `length - 1`, which left the
        // final element pinned in place and made 4 of these 6 unreachable.
        const seen = new Set();
        for (let i = 0; i < 2000; i++) {
            seen.add(shuffle(['a', 'b', 'c'], Math.random).join(''));
        }

        expect([...seen].sort()).toEqual(['abc', 'acb', 'bac', 'bca', 'cab', 'cba']);
    });

    it('does not pin the last element', () => {
        const lastPositions = new Set();
        for (let i = 0; i < 2000; i++) {
            lastPositions.add(shuffle(['a', 'b', 'c', 'd'], Math.random)[3]);
        }

        expect(lastPositions.size).toBe(4);
    });
});

describe('buildTargetGraph', () => {
    const invariants = (graph, players, maxTargets) => {
        for (const player of players) {
            expect(graph.targets[player]).toHaveLength(maxTargets);
            expect(graph.assassins[player]).toHaveLength(maxTargets);
            expect(graph.targets[player]).not.toContain(player);
            expect(new Set(graph.targets[player]).size).toBe(maxTargets);
        }
    };

    it.each([3, 6, 7, 16, 20])('gives every player the full target count (%i players)', (n) => {
        const players = rosterOf(n);
        const graph = buildTargetGraph(players, { rng: Math.random });

        invariants(graph, players, maxTargetsFor(n));
    });

    it('keeps targets and assassins mutually consistent', () => {
        const players = rosterOf(16);
        const { targets, assassins } = buildTargetGraph(players, { rng: Math.random });

        for (const [player, playerTargets] of Object.entries(targets)) {
            for (const target of playerTargets) {
                expect(assassins[target]).toContain(player);
            }
        }
        for (const [player, playerAssassins] of Object.entries(assassins)) {
            for (const assassin of playerAssassins) {
                expect(targets[assassin]).toContain(player);
            }
        }
    });

    it('avoids mutual target pairs when the roster is large enough', () => {
        const { targets } = buildTargetGraph(rosterOf(16), { rng: Math.random });

        for (const [player, playerTargets] of Object.entries(targets)) {
            for (const target of playerTargets) {
                expect(targets[target]).not.toContain(player);
            }
        }
    });

    it('is reproducible for a given rng', () => {
        const players = rosterOf(10);
        const seed = [0.42, 0.17, 0.93, 0.05, 0.61, 0.28, 0.77, 0.34, 0.88, 0.11];

        expect(buildTargetGraph(players, { rng: seededRng(seed) })).toEqual(
            buildTargetGraph(players, { rng: seededRng(seed) })
        );
    });

    it('assigns no targets in a one-player room rather than throwing', () => {
        expect(buildTargetGraph(['solo'], { rng: Math.random })).toEqual({
            targets: { solo: [] },
            assassins: { solo: [] },
        });
    });

    it('returns empty maps for an empty roster', () => {
        expect(buildTargetGraph([], { rng: Math.random })).toEqual({ targets: {}, assassins: {} });
    });

    it('pairs the only two players with each other', () => {
        const { targets } = buildTargetGraph(['a', 'b'], { rng: Math.random });

        expect(targets.a).toEqual(['b']);
        expect(targets.b).toEqual(['a']);
    });
});
