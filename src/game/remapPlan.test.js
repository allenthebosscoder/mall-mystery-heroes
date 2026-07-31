import { planRemap } from './remapPlan';

const seededRng = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
};

/** Builds an alive roster where nobody is mapped to anybody yet. */
const emptyRoster = (names) => names.map((name) => ({ name, targets: [], assassins: [] }));

const writeFor = (plan, name) => plan.writes.find((w) => w.player === name);

describe('planRemap', () => {
    it('fills a player up to the roster max target count', () => {
        const roster = emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(writeFor(plan, 'a').targets).toHaveLength(2);
    });

    it('never assigns a player themselves', () => {
        const roster = emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(writeFor(plan, 'a').targets).not.toContain('a');
    });

    it('records the reciprocal assassin on every player it hands out as a target', () => {
        const roster = emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        for (const target of writeFor(plan, 'a').targets) {
            expect(writeFor(plan, target).assassins).toContain('a');
        }
    });

    it('keeps targets a player already has', () => {
        const roster = [
            { name: 'a', targets: ['b'], assassins: [] },
            ...emptyRoster(['b', 'c', 'd', 'e', 'f', 'g']),
        ];

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(writeFor(plan, 'a').targets).toContain('b');
        expect(writeFor(plan, 'a').targets).toHaveLength(2);
    });

    it('does not hand a player a target they already hold', () => {
        const roster = [
            { name: 'a', targets: ['b'], assassins: [] },
            ...emptyRoster(['b', 'c', 'd', 'e', 'f', 'g']),
        ];

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        const occurrences = writeFor(plan, 'a').targets.filter((t) => t === 'b');
        expect(occurrences).toHaveLength(1);
    });

    it('skips candidates that already hold the maximum number of assassins', () => {
        // 'saturated' already has 2 assassins, the max for a 7-player game.
        const roster = [
            ...emptyRoster(['a']),
            { name: 'saturated', targets: [], assassins: ['x', 'y'] },
            ...emptyRoster(['c', 'd', 'e', 'f', 'g']),
        ];

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(writeFor(plan, 'a').targets).not.toContain('saturated');
    });

    it('avoids creating a mutual pair when another candidate is available', () => {
        // 'b' already hunts 'a', so making 'b' a target of 'a' would pair them.
        const roster = [
            ...emptyRoster(['a']),
            { name: 'b', targets: ['a'], assassins: [] },
            ...emptyRoster(['c', 'd', 'e', 'f', 'g']),
        ];

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(writeFor(plan, 'a').targets).not.toContain('b');
    });

    it('reports only newly added names as the delta, not the pre-existing ones', () => {
        const roster = [
            { name: 'a', targets: ['b'], assassins: [] },
            ...emptyRoster(['b', 'c', 'd', 'e', 'f', 'g']),
        ];

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(plan.added.targets.a).toHaveLength(1);
        expect(plan.added.targets.a).not.toContain('b');
    });

    it('assigns assassins to a player who needs them', () => {
        const roster = emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

        const plan = planRemap(roster, { needAssassins: ['a'], rng: Math.random });

        expect(writeFor(plan, 'a').assassins).toHaveLength(2);
        for (const assassin of writeFor(plan, 'a').assassins) {
            expect(writeFor(plan, assassin).targets).toContain('a');
        }
    });

    it('emits one log line per newly created hunt', () => {
        const roster = emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(plan.logs).toHaveLength(2);
        expect(plan.logs[0]).toMatch(/^New target for a: /);
    });

    it('leaves untouched players out of the write set', () => {
        const roster = emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        // 'a' plus its two new targets — not the whole roster.
        expect(plan.writes).toHaveLength(3);
    });

    it('does not mutate the roster it was given', () => {
        const roster = emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

        planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(roster.every((p) => p.targets.length === 0 && p.assassins.length === 0)).toBe(true);
    });

    it('is reproducible for a given rng', () => {
        const seed = [0.42, 0.17, 0.93, 0.05, 0.61, 0.28, 0.77];
        const build = () =>
            planRemap(emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']), {
                needTargets: ['a'],
                rng: seededRng(seed),
            });

        expect(build()).toEqual(build());
    });

    it('terminates and assigns nothing when no candidate is eligible', () => {
        const roster = [{ name: 'a', targets: [], assassins: [] }];

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(plan.writes).toEqual([]);
        expect(plan.logs).toEqual([]);
    });

    it('handles a player needing both targets and assassins in one pass', () => {
        const roster = emptyRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

        const plan = planRemap(roster, {
            needTargets: ['a'],
            needAssassins: ['a'],
            rng: Math.random,
        });

        expect(writeFor(plan, 'a').targets).toHaveLength(2);
        expect(writeFor(plan, 'a').assassins).toHaveLength(2);
    });

    it('relaxes the saturation rule rather than leaving a player unhunted', () => {
        // Everyone but 'a' is already at max assassins. The old fallback path
        // existed for exactly this; it must still produce a target.
        const roster = [
            { name: 'a', targets: [], assassins: [] },
            ...['b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({
                name,
                targets: [],
                assassins: ['x', 'y'],
            })),
        ];

        const plan = planRemap(roster, { needTargets: ['a'], rng: Math.random });

        expect(writeFor(plan, 'a').targets.length).toBeGreaterThan(0);
    });
});
