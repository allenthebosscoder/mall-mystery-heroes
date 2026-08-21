/**
 * Decides what player score adjustment, if any, results from editing a
 * mission's pointValue. Performs no I/O — the caller applies the result
 * via dbCalls.updatePointsForPlayer, which is additive (Firestore
 * increment()), so `delta` is added directly, once per name in `players`.
 *
 * Returns null when no adjustment is needed: the mission isn't (or
 * didn't stay) a 'Task' — a Revival Mission's completion revives a
 * player rather than awarding points, so its pointValue is never
 * score-relevant — or the pointValue didn't actually change.
 *
 * CommonJS require/exports, matching src/game/remapPlan.js and
 * targetGraph.js's convention in this directory.
 */
const planScoreAdjustment = (oldTask, newTask) => {
    if (newTask.taskType !== 'Task') return null;
    const delta = newTask.pointValue - oldTask.pointValue;
    if (delta === 0) return null;
    return { delta, players: oldTask.completedBy };
};

module.exports = { planScoreAdjustment };
