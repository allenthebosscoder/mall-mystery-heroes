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
