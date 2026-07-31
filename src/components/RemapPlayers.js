import {
    fetchAliveRosterForRoom,
    updateAssassinsForPlayer,
    updateTargetsForPlayer,
} from './firebase_calls/dbCalls';
import { planRemap } from '../game/remapPlan';

/**
 * Applies a remap to Firestore.
 *
 * All of the matching rules now live in `src/game/remapPlan.js` as pure
 * functions; this is the thin I/O shell around them — read the roster once,
 * plan, write. Previously it fetched a player document per candidate inside a
 * nested loop and wrote to Firestore mid-decision, which is why the rules could
 * not be tested and why one kill in a 20-player game cost dozens of reads.
 */
const RemapPlayers = (handleRemapping, createAlert) => {
    const handleRegeneration = async (
        playersNeedingTarget,
        playersNeedingAssassins,
        arrayOfAlivePlayers,
        roomID
    ) => {
        try {
            const roster = await fetchAliveRosterForRoom(roomID);

            // Callers that already hold the alive list pass it in; when they do
            // it is the authority on who is in play.
            const inPlay = arrayOfAlivePlayers?.length
                ? roster.filter((player) => arrayOfAlivePlayers.includes(player.name))
                : roster;

            const plan = planRemap(inPlay, {
                needTargets: playersNeedingTarget ?? [],
                needAssassins: playersNeedingAssassins ?? [],
            });

            for (const write of plan.writes) {
                await updateTargetsForPlayer(write.player, write.targets, roomID);
                await updateAssassinsForPlayer(write.player, write.assassins, roomID);
            }

            for (const log of plan.logs) {
                await handleRemapping(log);
            }

            return [plan.added.targets, plan.added.assassins];
        } catch (error) {
            console.error('Error regenerating: ', error);
            createAlert('error', 'Error Regenerating Targets', 'Check console', 1500);
            return [{}, {}];
        }
    };

    return handleRegeneration;
};

export default RemapPlayers;
