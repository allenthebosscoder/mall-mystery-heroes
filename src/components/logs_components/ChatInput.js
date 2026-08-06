import { Box, Image } from '@chakra-ui/react';
import { useContext, useState } from 'react';
import Autosuggest from 'react-autosuggest';
import enter from '../../assets/enter-green.png';
import { executionContext, gameContext } from '../Contexts';
import {
    addPlayerMessageForRoom,
    addPlayerToCompletedByForTask,
    fetchAlivePlayerNamesForRoom,
    fetchPlayersByStatusForRoom,
    fetchReferenceByIndexForTask,
    fetchTaskByIndexForRoom,
    fetchTasksByCompletionForRoom,
    setOpenSznOfPlayerToValueForRoom,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
} from '../firebase_calls/dbCalls';
import commandCompletion from '../../game/commandCompletion';
import RemapPlayers from '../RemapPlayers';
import { executeKill } from '../executeKill';
import { parseCommand, UNIMPLEMENTED_COMMANDS } from '../../game/commands';
import { normalizePlayerName, resolvePlayerDisplayName } from '../../game/playerNames';
import CreateAlert from '../CreateAlert';

// handling for command execution
//
// `players` comes from `gameContext` — GameMasterView's own live roster
// subscription (docs/superpowers/specs/2026-08-05-shell-style-command-
// completion-design.md) — rather than a fresh `fetchAllPlayersForRoom` call
// on every submission. One live source of truth instead of two.
const handleCommandExecution = async (
    value,
    setValue,
    roomID,
    players,
    xecutionContext,
    createAlert
) => {
    // Parsing lives in src/game/commands.js and is unit tested there.
    const parsed = parseCommand(value);

    if (!parsed.ok) {
        if (parsed.error === 'UNKNOWN_COMMAND') {
            createAlert(
                'error',
                'Error',
                `The follow command is not legal: ${parsed.command}`,
                1500
            );
            console.error(`Error executing command. Not a legal command: ${parsed.command}`);
        }
        setValue('');
        return null;
    }

    const commandLine = parsed.command;
    const args = parsed.args;

    // Whitelisted but not implemented — previously these passed the
    // whitelist, cleared the input, and did nothing with zero feedback
    // (improvements item 21). Checked before the roster fetch below since
    // none of these commands need it.
    if (UNIMPLEMENTED_COMMANDS.includes(commandLine)) {
        createAlert('info', 'Not implemented', `${commandLine} is not implemented yet`, 1500);
        setValue('');
        return;
    }

    const {
        handleRemapping,
        handleKillPlayer,
        handleSetShowMessageToTrue,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleOpenSznstarted,
        handleOpenSznended,
        handlePlayerRevive,
        handleTaskCompleted,
        handleShowMissionCreation,
        handleShowMissionList,
        addLog,
    } = xecutionContext; // retrieve contexts

    // dbCalls functions throw on failure rather than swallowing errors
    // (docs/improvements.md item 10), so this needs to catch them somewhere —
    // wrapping the whole switch (and the roster name list every case depends
    // on), rather than every individual call, since there's no single case
    // body simple enough to inline a try/catch without the branching logic
    // becoming unreadable.
    try {
        const arrayOfPlayerNames = players.map((player) => normalizePlayerName(player.name));
        const handleTargetRegeneration = RemapPlayers(handleRemapping, createAlert); // initial remapping of players function
        let arrayOfAlivePlayers;
        let arrayOfDeadPlayers;
        let playerName;
        let arg;
        let missionIndex;

        switch (commandLine) {
            case '/add':
                // sanity check player input — args aren't lowercased by parseCommand,
                // unlike every other command here (improvements item 1)
                const addPlayerName = args[0] ? normalizePlayerName(args[0]) : '';
                if (arrayOfPlayerNames.includes(addPlayerName)) {
                    // sanity check point input
                    if (!isNaN(Number(args[1]))) {
                        await updatePointsForPlayer(addPlayerName, Number(args[1]), roomID);
                    } else {
                        createAlert('error', 'Error', 'Please input valid points', 1500);
                        console.error('Please input valid points');
                    }
                } else {
                    createAlert('error', 'Error', `Player ${args[0]} is invalid`, 1500);
                    console.error(`Player ${args[0]} is invalid.`);
                }
                break;

            case '/kill':
                const targetName = args[0] ? normalizePlayerName(args[0]) : '';
                const assassinName = args[1] ? normalizePlayerName(args[1]) : '';
                if (
                    arrayOfPlayerNames.includes(targetName) &&
                    arrayOfPlayerNames.includes(assassinName)
                ) {
                    const { targetWasOpenSzn, addedTargets, addedAssassins, remapLogs } =
                        await executeKill(targetName, assassinName, roomID);
                    // targetName/assassinName are the normalized (lowercased)
                    // matching keys — resolved back to actual stored casing
                    // here since this is the point where they become chat
                    // log text, not a lookup key.
                    await handleKillPlayer(
                        resolvePlayerDisplayName(targetName, players),
                        resolvePlayerDisplayName(assassinName, players),
                        targetWasOpenSzn
                    );

                    for (const log of remapLogs) {
                        await handleRemapping(log);
                    }
                    handleAddNewAssassins(addedAssassins);
                    handleAddNewTargets(addedTargets);
                    handleSetShowMessageToTrue();
                } else {
                    createAlert('error', 'Error', `Invalid players: ${args[0]}, ${args[1]}`, 1500);
                    console.error(
                        `One of the following inputs are invalid: Target - "${args[0]}", Assassin - "${args[1]}"`
                    );
                }
                break;

            case '/mission':
                arg = args[0] ? args[0].toLowerCase() : '';
                switch (arg) {
                    case 'done':
                        playerName = args[1] ? normalizePlayerName(args[1]) : '';
                        missionIndex = args[2] ? Number(args[2]) : -1;
                        if (missionIndex === -1) {
                            createAlert('error', 'Error', `${args[2]} is not a valid index`, 1500);
                            console.error(`${args[2]} is not a valid index`);
                            break;
                        }

                        // sanity check player input
                        if (arrayOfPlayerNames.includes(playerName)) {
                            // sanity check mission index
                            const task = await fetchTaskByIndexForRoom(missionIndex, roomID);
                            const taskDocRef = await fetchReferenceByIndexForTask(
                                missionIndex,
                                roomID
                            );
                            if (!task) {
                                createAlert('error', 'Error', 'Invalid task index', 1500);
                                console.error('invalid task');
                                break;
                            }

                            // A mission /mission end already closed can't be
                            // completed again — this only used to check
                            // whether THIS player had already done it, not
                            // whether the mission itself was still open.
                            if (task.isComplete) {
                                createAlert(
                                    'error',
                                    'Error',
                                    `Mission ${missionIndex} has already ended`,
                                    1500
                                );
                                console.error(`Mission ${missionIndex} has already ended`);
                                break;
                            }

                            // check if player has completed task
                            if (!task.completedBy.includes(playerName)) {
                                //updates player scores for task types
                                if (task.taskType === 'Task') {
                                    const points = parseInt(task.pointValue);
                                    await updatePointsForPlayer(playerName, points, roomID);
                                } else if (task.taskType === 'Revival Mission') {
                                    //updates player live status for revival missions.
                                    // fetchPlayersByStatusForRoom returns case-preserved
                                    // names, so this needs normalizing against the
                                    // normalized playerName (improvements items 1, 35).
                                    arrayOfDeadPlayers = (
                                        await fetchPlayersByStatusForRoom(false, roomID)
                                    ).map((name) => normalizePlayerName(name));
                                    if (arrayOfDeadPlayers.includes(playerName)) {
                                        await updateIsAliveForPlayer(playerName, true, roomID);
                                        handlePlayerRevive(
                                            resolvePlayerDisplayName(playerName, players)
                                        );
                                        arrayOfAlivePlayers =
                                            await fetchAlivePlayerNamesForRoom(roomID);
                                        const [targets, assassins] = await handleTargetRegeneration(
                                            [playerName],
                                            [playerName],
                                            arrayOfAlivePlayers,
                                            roomID
                                        );
                                        handleAddNewAssassins(assassins);
                                        handleAddNewTargets(targets);
                                        handleSetShowMessageToTrue();
                                    } else {
                                        createAlert(
                                            'error',
                                            'Error',
                                            `Player ${args[1]} is not dead`,
                                            1500
                                        );
                                        console.error(`Player ${args[1]} is not dead`);
                                    }
                                }
                                await addPlayerToCompletedByForTask(taskDocRef, playerName);
                                await addLog(
                                    `${resolvePlayerDisplayName(playerName, players)} completed mission: ${task.title}`,
                                    'green.400'
                                );

                                // Optional per-mission completion cap — unset
                                // or 0 means unlimited, matching every
                                // mission created before this field existed.
                                const completedCount = task.completedBy.length + 1;
                                if (task.maxCompletions && completedCount >= task.maxCompletions) {
                                    await updateIsCompleteToTrueForTaskByIndex(
                                        missionIndex,
                                        roomID
                                    );
                                    await addLog(
                                        `Mission "${task.title}" auto-ended — reached its ${task.maxCompletions}-completion cap`,
                                        'purple.400'
                                    );
                                }
                            } else {
                                createAlert(
                                    'error',
                                    'Error',
                                    `Player ${args[1]} has already completed the mission`,
                                    1500
                                );
                                console.error(
                                    `Player ${args[1]} has already completed the mission`
                                );
                            }
                        } else {
                            createAlert('error', 'Error', `Player ${args[1]} is invalid`, 1500);
                            console.error(`Player ${args[1]} is invalid.`);
                        }
                        break;

                    case 'end':
                        missionIndex = args[1] ? Number(args[1]) : -1;
                        if (missionIndex === -1) {
                            createAlert('error', 'Error', `${args[2]} is not a valid index`, 1500);
                            console.error(`${args[2]} is not a valid index`);
                            break;
                        }

                        // sanity check mission index — mirrors "/mission
                        // done"'s guard above. Previously missing here, so a
                        // bad index threw on task.title below, after the
                        // success toast had already fired (improvements
                        // item 20).
                        const task = await fetchTaskByIndexForRoom(missionIndex, roomID);
                        if (!task) {
                            createAlert('error', 'Error', 'Invalid task index', 1500);
                            console.error('invalid task');
                            break;
                        }

                        await updateIsCompleteToTrueForTaskByIndex(missionIndex, roomID);
                        createAlert('info', 'Completed', 'Task has been saved as completed', 1500);
                        handleTaskCompleted(task.title);
                        break;
                    case 'start':
                        handleShowMissionCreation();
                        break;
                    case 'view':
                        handleShowMissionList();
                        break;
                    default:
                        createAlert('error', 'Error', `Inavlid argument: ${args[0]}`, 1500);
                        console.error(`Inavlid argument: ${args[0]}`);
                        break;
                }
                break;

            case '/openseason':
                // TO DO: double check szn alrdy on/off
                // sanity check openSeason target
                playerName = args[0] ? normalizePlayerName(args[0]) : '';
                arg = args[1] ? args[1].toLowerCase() : '';
                if (arrayOfPlayerNames.includes(playerName)) {
                    switch (arg) {
                        case 'start':
                            await setOpenSznOfPlayerToValueForRoom(playerName, true, roomID);
                            handleOpenSznstarted(resolvePlayerDisplayName(playerName, players));
                            break;
                        case 'end':
                            await setOpenSznOfPlayerToValueForRoom(playerName, false, roomID);
                            handleOpenSznended(resolvePlayerDisplayName(playerName, players));
                            break;
                        default:
                            createAlert('error', 'Error', `${args[1]} is not a valid input`, 1500);
                            console.error(`${args[1]} is not a valid input`);
                            break;
                    }
                } else {
                    createAlert('error', 'Error', `${args[0]} is not a valid player`, 1500);
                    console.error(`${args[0]} is not a valid player`);
                }
                break;

            case '/revive':
                // fetchPlayersByStatusForRoom returns case-preserved names, so
                // this needs normalizing against the normalized playerName
                // (improvements items 1, 35).
                arrayOfDeadPlayers = (await fetchPlayersByStatusForRoom(false, roomID)).map(
                    (name) => normalizePlayerName(name)
                );
                playerName = args[0] ? normalizePlayerName(args[0]) : '';
                // sanity check if player exists as dead player
                if (arrayOfDeadPlayers.includes(playerName)) {
                    await updateIsAliveForPlayer(playerName, true, roomID);
                    const activePlayers = await fetchAlivePlayerNamesForRoom(roomID);
                    const [target, assassin] = await handleTargetRegeneration(
                        [playerName],
                        [playerName],
                        activePlayers,
                        roomID
                    );
                    handleAddNewAssassins(assassin);
                    handleAddNewTargets(target);
                    handleSetShowMessageToTrue();
                    handlePlayerRevive(resolvePlayerDisplayName(playerName, players), createAlert);
                } else {
                    // Previously no else branch here at all — reviving a
                    // player who isn't dead (e.g. a typo, or a player
                    // already revived) did nothing with zero feedback
                    // (improvements item 21).
                    createAlert('error', 'Error', `${args[0]} is not dead`, 1500);
                    console.error(`${args[0]} is not dead`);
                }
                break;

            case '/whisper':
                const whisperPlayerName = args[0] ? normalizePlayerName(args[0]) : '';
                const whisperMessage = args.slice(1).join(' ').trim();
                if (arrayOfPlayerNames.includes(whisperPlayerName)) {
                    if (whisperMessage) {
                        const whisperRecipientName = resolvePlayerDisplayName(
                            whisperPlayerName,
                            players
                        );
                        await addPlayerMessageForRoom(
                            {
                                type: 'whisper',
                                recipient: whisperRecipientName,
                                text: whisperMessage,
                                standings: null,
                            },
                            roomID
                        );
                        await addLog(
                            `Whisper sent to ${whisperRecipientName}: "${whisperMessage}"`,
                            'teal.400'
                        );
                    } else {
                        createAlert('error', 'Error', 'Whisper message cannot be blank', 1500);
                        console.error('Whisper message cannot be blank');
                    }
                } else {
                    createAlert('error', 'Error', `Player ${args[0]} is invalid`, 1500);
                    console.error(`Player ${args[0]} is invalid.`);
                }
                break;

            default:
                createAlert('error', 'Error', `Unknown command: ${commandLine}`, 1500);
                console.error('Unknown command:', commandLine);
                break;
        }
    } catch (error) {
        console.error(`Error executing ${commandLine}: `, error);
        createAlert('error', 'Error', `${commandLine} failed: ${error.message}`, 1500);
    }

    setValue('');
};

export default function ChatInput() {
    const [value, setValue] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [highlightedSuggestion, setHighlightedSuggestion] = useState(null);
    const { roomID, players = [], isGameActive = true } = useContext(gameContext) || {};
    // Active missions for /mission done|end's mission-index completion —
    // fetched on demand the first time typing needs them, not an always-on
    // subscription (docs/superpowers/specs/2026-08-05-shell-style-command-
    // completion-design.md). Reset once the command bar clears so the next
    // mission command starts from fresh data.
    const [activeMissions, setActiveMissions] = useState([]);
    const [missionsFetchedForSession, setMissionsFetchedForSession] = useState(false);
    const xecutionContext = useContext(executionContext);
    const createAlert = CreateAlert();

    // Single source of truth for "what completes the slot being typed right
    // now" — used by both the autosuggest dropdown and Tab, so they can
    // never disagree with each other.
    const resolveCompletion = async (currentValue) => {
        let completion = commandCompletion.complete(currentValue, {
            players,
            missions: activeMissions,
        });
        if (
            !completion.applied &&
            !missionsFetchedForSession &&
            roomID &&
            /^\/mission\b/i.test(currentValue.trim())
        ) {
            try {
                const snapshot = await fetchTasksByCompletionForRoom(false, roomID);
                const missions = snapshot.docs.map((doc) => doc.data());
                setActiveMissions(missions);
                setMissionsFetchedForSession(true);
                completion = commandCompletion.complete(currentValue, { players, missions });
            } catch (error) {
                console.error('Error fetching missions for completion: ', error);
            }
        }
        return completion;
    };

    // Splices one specific candidate into `currentValue` at the slot
    // `completion` describes — always with a trailing space, since picking
    // an exact candidate (as opposed to Tab's partial narrowing) fully
    // resolves that slot.
    const applyCandidate = (currentValue, completion, candidate) => {
        const before = currentValue.slice(0, completion.tokenStart);
        const after = currentValue.slice(completion.tokenEnd);
        const needsBrackets = /\s/.test(candidate);
        const value = needsBrackets ? `[${candidate}]` : candidate;
        return `${before}${value} ${after}`;
    };

    const buildSuggestionList = (currentValue, completion) => {
        if (!completion.applied) return [];
        return completion.candidates.map((candidate, index) => ({
            // The dropdown shows the whole command in context (e.g.
            // "/mission start", not just "start") via suggestionLines —
            // accepting it still only fills the one slot being typed.
            text: completion.suggestionLines[index],
            replacement: applyCandidate(currentValue, completion, candidate),
        }));
    };

    const onChange = (event, { newValue }) => {
        setValue(newValue);
    };

    const onSuggestionsFetchRequested = async ({ value: currentValue }) => {
        const completion = await resolveCompletion(currentValue);
        setSuggestions(buildSuggestionList(currentValue, completion));
        setHighlightedSuggestion(null);
    };

    const onSuggestionsClearRequested = () => {
        setSuggestions([]);
        setHighlightedSuggestion(null);
    };

    // react-autosuggest tracks arrow-key highlighting internally but only
    // exposes it via this callback — mirrored into local state so Tab can
    // read it. react-autosuggest has no built-in Tab handling of its own;
    // Tab otherwise just blurs the input.
    const onSuggestionHighlighted = ({ suggestion }) => {
        setHighlightedSuggestion(suggestion);
    };

    const onSuggestionSelected = (event, { suggestion }) => {
        setValue(suggestion.replacement);
        setSuggestions([]);
    };

    // Applies `newValue` and refreshes the dropdown to match it — e.g.
    // after "/mission" + Tab produces "/mission ", the very next thing a GM
    // needs is the sub-command list (done/end/start/view), not an empty
    // dropdown that only refills once they type a literal space themselves.
    // Recomputing against `newValue` (not the pre-Tab `value` still in
    // scope) is what `onSuggestionsFetchRequested` does for a typed change;
    // Tab needs the same step since setValue here doesn't go through
    // react-autosuggest's own onChange.
    const applyValueAndRefreshSuggestions = async (newValue) => {
        setValue(newValue);
        const nextCompletion = await resolveCompletion(newValue);
        setSuggestions(buildSuggestionList(newValue, nextCompletion));
    };

    const submitCommand = async () => {
        // The text input is disabled once the game has ended, but the
        // send icon next to it isn't a native <input> — nothing stops a
        // click on it otherwise.
        if (!isGameActive) return;
        await handleCommandExecution(
            value,
            setValue,
            roomID,
            players,
            xecutionContext,
            createAlert
        );
        // The command bar just cleared — the mission cache is scoped to one
        // typing session, not the whole time the console is open.
        setActiveMissions([]);
        setMissionsFetchedForSession(false);
    };

    const inputProps = {
        placeholder: isGameActive ? 'Input Texts/Commands Here ' : 'This game has ended',
        value,
        disabled: !isGameActive,
        onChange,
        onKeyDown: async (event) => {
            if (event.key === 'Enter') {
                // react-autosuggest has its own built-in Enter handling: if
                // a suggestion is highlighted (arrow keys, or just the
                // mouse resting over the dropdown) it accepts that
                // suggestion and calls preventDefault() *before* this
                // handler runs, but still calls this handler afterward.
                // Without this check, that meant submitting `value` from
                // its state *before* the accepted suggestion applied — a
                // stale, still-ambiguous command (e.g. "/mission s"
                // instead of the just-accepted "/mission start ").
                // Accepting a suggestion should never also submit it in
                // the same keystroke; a second, unambiguous Enter does.
                if (event.defaultPrevented) return;
                submitCommand();
                return;
            }

            if (event.key !== 'Tab') return;

            // Accepts the arrow-key-highlighted suggestion if there is one;
            // otherwise completes the current slot to the longest common
            // prefix across whatever's showing, same rule
            // `commandCompletion.complete` itself uses.
            event.preventDefault();

            if (highlightedSuggestion) {
                await applyValueAndRefreshSuggestions(highlightedSuggestion.replacement);
                return;
            }

            const completion = await resolveCompletion(value);
            if (!completion.applied) return;

            const before = value.slice(0, completion.tokenStart);
            const after = value.slice(completion.tokenEnd);
            const space = completion.isUnique ? ' ' : '';
            await applyValueAndRefreshSuggestions(
                `${before}${completion.commonPrefix}${space}${after}`
            );
        },
    };

    return (
        <Box sx={styles.inputBox}>
            <Autosuggest
                suggestions={suggestions}
                onSuggestionsFetchRequested={onSuggestionsFetchRequested}
                onSuggestionsClearRequested={onSuggestionsClearRequested}
                onSuggestionHighlighted={onSuggestionHighlighted}
                onSuggestionSelected={onSuggestionSelected}
                getSuggestionValue={getSuggestionValue}
                renderSuggestion={renderSuggestion}
                inputProps={inputProps}
                theme={{
                    ...inputTheme,
                    suggestionsContainer: inputTheme.suggestionsContainer(suggestions),
                }}
            />
            <Image
                src={enter}
                alt="Send"
                style={styles.enterImage}
                onClick={submitCommand}
                _hover={{ opacity: '.3' }}
                transition="opacity 0.1s ease-in-out"
            />
        </Box>
    );
}

// Get Name for Display Purposes
const getSuggestionValue = (suggestion) => {
    return suggestion.replacement;
};

// Rending for each display
const renderSuggestion = (suggestion) => {
    return <Box listStyleType="none">{suggestion.text}</Box>;
};

const styles = {
    inputBox: {
        h: '100%',
        w: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    enterImage: {
        width: '6%',
        height: '70%',
    },
};

const inputTheme = {
    container: {
        width: '78%',
        height: '60%',
        margin: '8px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    input: {
        width: '100%',
        height: '100%',
        background: 'transparent',
        borderWidth: 1,
        borderRadius: 8,
        padding: 8,
    },
    suggestionsList: {
        listStyleType: 'none',
    },
    suggestionsContainer: (suggestions) => ({
        position: 'absolute',
        zIndex: '10',
        bottom: '100%',
        width: '100%',
        padding: '4px',
        background: '#202030',
        listStyleType: 'none',
        borderWidth: 1,
        borderRadius: 8,
        display: suggestions.length === 0 ? 'none' : 'block',
    }),
    suggestion: {
        padding: '4px',
        cursor: 'pointer',
    },
    suggestionHighlighted: {
        background: '#8b8bb2',
    },
};
