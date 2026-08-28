import {
    addPlayerMessageForRoom,
    addPlayerToCompletedByForTask,
    fetchAliveRosterForRoom,
    fetchPlayersByStatusForRoom,
    fetchReferenceByIndexForTask,
    fetchTaskByIndexForRoom,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
} from './firebase_calls/dbCalls';
import { normalizePlayerName, resolvePlayerDisplayName } from '../game/playerNames';
import { playersNeedingConnections } from '../game/targetGraph';
import { planMissionCompletion } from '../game/missionCompletion';

/**
 * The I/O shell around src/game/missionCompletion.js's planMissionCompletion
 * — matches src/components/RemapPlayers.js's shape (a function of the
 * caller's handlers, returning the actual worker function). Shared by
 * ChatInput.js's /mission done command and PhotosDisplay.js's
 * photo-approval flow, so completing a mission behaves identically no
 * matter which way it was approved
 * (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).
 *
 * Throws on any invalid attempt (bad index, ended mission, already
 * completed, Revival Mission attempted by a player who is not dead) or
 * on any write failure — never catches its own errors, matching
 * src/components/executeKill.js's convention. Each caller keeps its own
 * try/catch and alert style.
 */
const CompleteMission = (handlers) => {
    const {
        addLog,
        handleTargetRegeneration,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleSetShowMessageToTrue,
        handlePlayerRevive,
    } = handlers;

    return async (playerName, missionIndex, roomID, players) => {
        const normalizedPlayerName = normalizePlayerName(playerName);
        const task = await fetchTaskByIndexForRoom(missionIndex, roomID);

        let isPlayerDead = false;
        if (task && task.taskType === 'Revival Mission') {
            const deadPlayers = (await fetchPlayersByStatusForRoom(false, roomID)).map(
                normalizePlayerName
            );
            isPlayerDead = deadPlayers.includes(normalizedPlayerName);
        }

        const plan = planMissionCompletion(task, normalizedPlayerName, { isPlayerDead });
        if (plan.error) throw new Error(plan.error);

        const taskDocRef = await fetchReferenceByIndexForTask(missionIndex, roomID);
        const displayName = resolvePlayerDisplayName(normalizedPlayerName, players);

        await addPlayerToCompletedByForTask(taskDocRef, normalizedPlayerName);
        await addLog(`${displayName} completed mission: ${task.title}`, 'green.400');
        await addPlayerMessageForRoom(
            {
                type: 'broadcast',
                recipient: null,
                text: `${displayName} completed mission: ${task.title}`,
                standings: null,
            },
            roomID
        );

        if (plan.awardsPoints !== null) {
            await updatePointsForPlayer(normalizedPlayerName, plan.awardsPoints, roomID);
        }

        if (plan.revivesPlayer) {
            await updateIsAliveForPlayer(normalizedPlayerName, true, roomID);
            handlePlayerRevive(displayName);
            const roster = await fetchAliveRosterForRoom(roomID);
            const { needTargets, needAssassins } = playersNeedingConnections(roster);
            const [targets, assassins] = await handleTargetRegeneration(
                needTargets,
                needAssassins,
                roster.map((player) => player.name),
                roomID
            );
            handleAddNewAssassins(assassins);
            handleAddNewTargets(targets);
            handleSetShowMessageToTrue();
        }

        if (plan.autoEnds) {
            await updateIsCompleteToTrueForTaskByIndex(missionIndex, roomID);
            await addLog(
                `Mission "${task.title}" auto-ended — reached its ${task.maxCompletions}-completion cap`,
                'purple.400'
            );
            await addPlayerMessageForRoom(
                {
                    type: 'broadcast',
                    recipient: null,
                    text: `Mission ${task.title} has been completed!`,
                    standings: null,
                },
                roomID
            );
        }
    };
};

export default CompleteMission;
