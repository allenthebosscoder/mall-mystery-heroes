const { planScoreAdjustment } = require('./missionEdit');

describe('planScoreAdjustment', () => {
    it('returns the delta and affected players when a Task point value changes with existing completions', () => {
        const oldTask = { taskType: 'Task', pointValue: 10, completedBy: ['alice', 'bob'] };
        const newTask = { taskType: 'Task', pointValue: 15 };

        expect(planScoreAdjustment(oldTask, newTask)).toEqual({
            delta: 5,
            players: ['alice', 'bob'],
        });
    });

    it('returns null when nobody has completed the mission, even if the point value changed', () => {
        // Fixing a mistyped point value before anyone has played the
        // mission is the common case — there are no scores to adjust, so
        // the GM must not be asked to confirm an adjustment affecting
        // zero players.
        const oldTask = { taskType: 'Task', pointValue: 10, completedBy: [] };
        const newTask = { taskType: 'Task', pointValue: 15 };

        expect(planScoreAdjustment(oldTask, newTask)).toBeNull();
    });

    it('treats string point values numerically, matching how they are stored', () => {
        // pointValue is stored as the raw string from the Chakra
        // NumberInput on both the create and the edit path
        // (docs/data-model.md), so the delta math has to hold for
        // strings, not just numbers.
        const oldTask = { taskType: 'Task', pointValue: '10', completedBy: ['alice'] };
        const newTask = { taskType: 'Task', pointValue: '15' };

        expect(planScoreAdjustment(oldTask, newTask)).toEqual({
            delta: 5,
            players: ['alice'],
        });
        expect(
            planScoreAdjustment({ ...oldTask, pointValue: 10 }, { ...newTask, pointValue: '10' })
        ).toBeNull();
    });

    it('returns null when the point value is unchanged', () => {
        const oldTask = { taskType: 'Task', pointValue: 10, completedBy: ['alice'] };
        const newTask = { taskType: 'Task', pointValue: 10 };

        expect(planScoreAdjustment(oldTask, newTask)).toBeNull();
    });

    it('returns null when the mission is not a Task', () => {
        const oldTask = { taskType: 'Revival Mission', pointValue: 0, completedBy: ['alice'] };
        const newTask = { taskType: 'Revival Mission', pointValue: 0 };

        expect(planScoreAdjustment(oldTask, newTask)).toBeNull();
    });

    it('returns null for a Revival Mission even if its point value somehow changed', () => {
        const oldTask = { taskType: 'Revival Mission', pointValue: 0, completedBy: ['alice'] };
        const newTask = { taskType: 'Revival Mission', pointValue: 5 };

        expect(planScoreAdjustment(oldTask, newTask)).toBeNull();
    });
});
