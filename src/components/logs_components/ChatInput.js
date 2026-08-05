import { Box, Image } from '@chakra-ui/react';
import { useContext, useState } from 'react';
import Autosuggest from 'react-autosuggest';
import enter from '../../assets/enter-green.png';
import { executionContext, gameContext } from '../Contexts';
import {
    addPlayerToCompletedByForTask,
    fetchAlivePlayerNamesForRoom,
    fetchAllPlayersForRoom,
    fetchPlayersByStatusForRoom,
    fetchReferenceByIndexForTask,
    fetchTaskByIndexForRoom,
    setOpenSznOfPlayerToValueForRoom,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
    fetchTasksByCompletionForRoom,
} from '../firebase_calls/dbCalls';
import commandCompletion from '../../game/commandCompletion';
import RemapPlayers from '../RemapPlayers';
import { executeKill } from '../executeKill';
import { parseCommand, UNIMPLEMENTED_COMMANDS } from '../../game/commands';
import { normalizePlayerName } from '../../game/playerNames';
import CreateAlert from '../CreateAlert';

export default function ChatInput() {
    const [value, setValue] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [highlightedSuggestion, setHighlightedSuggestion] = useState(null);
    const { roomID, players } = useContext(gameContext);
    const [activeMissions, setActiveMissions] = useState([]);
    const [missionsLoadedForSession, setMissionsLoadedForSession] = useState(false);
    const [fetchedPlayers, setFetchedPlayers] = useState(null);

    const getPlayersForUse = async () => {
        if (players && players.length > 0) return players;
        if (fetchedPlayers) return fetchedPlayers;
        try {
            const list = await fetchAllPlayersForRoom(roomID);
            // normalize to same shape as live `players` (objects with name)
            const asObjects = list.map((name) => ({ name }));
            setFetchedPlayers(asObjects);
            return asObjects;
        } catch (err) {
            return [];
        }
    };
    const xecutionContext = useContext(executionContext);
    const createAlert = CreateAlert();
    
    // Handle command execution here so it can close over `players` and
    // `getPlayersForUse` from this component's scope (avoids ReferenceError
    // when tests mount the component without players in context).
    const handleCommandExecution = async (valueToExecute) => {
        const parsed = parseCommand(valueToExecute);

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
        } = xecutionContext;

        try {
            const resolvedPlayers = players && players.length > 0 ? players : await getPlayersForUse();
            const arrayOfPlayerNames = (resolvedPlayers || []).map((p) => normalizePlayerName(p.name));
            const handleTargetRegeneration = RemapPlayers(handleRemapping, createAlert);
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
                    if (!args || args.length < 2) {
                        createAlert('error', 'Error', 'Missing Arguments', 1500);
                        console.error('Missing Arguments');
                        break;
                    }

                    const targetName = args[0] ? normalizePlayerName(args[0]) : '';
                    const assassinName = args[1] ? normalizePlayerName(args[1]) : '';
                    if (
                        arrayOfPlayerNames.includes(targetName) &&
                        arrayOfPlayerNames.includes(assassinName)
                    ) {
                        const { targetWasOpenSzn, addedTargets, addedAssassins, remapLogs } =
                            await executeKill(targetName, assassinName, roomID);
                        await handleKillPlayer(targetName, assassinName, targetWasOpenSzn);

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

                            if (arrayOfPlayerNames.includes(playerName)) {
                                const task = await fetchTaskByIndexForRoom(missionIndex, roomID);
                                const taskDocRef = await fetchReferenceByIndexForTask(missionIndex, roomID);
                                if (!task) {
                                    createAlert('error', 'Error', 'Invalid task index', 1500);
                                    console.error('invalid task');
                                    break;
                                }

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

                                if (!task.completedBy.includes(playerName)) {
                                    if (task.taskType === 'Task') {
                                        const points = parseInt(task.pointValue);
                                        await updatePointsForPlayer(playerName, points, roomID);
                                    } else if (task.taskType === 'Revival Mission') {
                                        arrayOfDeadPlayers = (
                                            await fetchPlayersByStatusForRoom(false, roomID)
                                        ).map((name) => normalizePlayerName(name));
                                        if (arrayOfDeadPlayers.includes(playerName)) {
                                            await updateIsAliveForPlayer(playerName, true, roomID);
                                            handlePlayerRevive(playerName);
                                            arrayOfAlivePlayers = await fetchAlivePlayerNamesForRoom(roomID);
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
                                            createAlert('error', 'Error', `Player ${args[1]} is not dead`, 1500);
                                            console.error(`Player ${args[1]} is not dead`);
                                        }
                                    }
                                    await addPlayerToCompletedByForTask(taskDocRef, playerName);
                                    await addLog(`${playerName} completed mission: ${task.title}`, 'green.400');

                                    const completedCount = task.completedBy.length + 1;
                                    if (task.maxCompletions && completedCount >= task.maxCompletions) {
                                        await updateIsCompleteToTrueForTaskByIndex(missionIndex, roomID);
                                        await addLog(
                                            `Mission "${task.title}" auto-ended — reached its ${task.maxCompletions}-completion cap`,
                                            'purple.400'
                                        );
                                    }
                                } else {
                                    createAlert('error', 'Error', `Player ${args[1]} has already completed the mission`, 1500);
                                    console.error(`Player ${args[1]} has already completed the mission`);
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
                    playerName = args[0] ? normalizePlayerName(args[0]) : '';
                    arg = args[1] ? args[1].toLowerCase() : '';
                    if (arrayOfPlayerNames.includes(playerName)) {
                        switch (arg) {
                            case 'start':
                                await setOpenSznOfPlayerToValueForRoom(playerName, true, roomID);
                                handleOpenSznstarted(playerName);
                                break;
                            case 'end':
                                await setOpenSznOfPlayerToValueForRoom(playerName, false, roomID);
                                handleOpenSznended(playerName);
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
                    arrayOfDeadPlayers = (await fetchPlayersByStatusForRoom(false, roomID)).map(
                        (name) => normalizePlayerName(name)
                    );
                    playerName = args[0] ? normalizePlayerName(args[0]) : '';
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
                        handlePlayerRevive(playerName, createAlert);
                    } else {
                        createAlert('error', 'Error', `${args[0]} is not dead`, 1500);
                        console.error(`${args[0]} is not dead`);
                    }
                    break;

                default:
                    createAlert('error', 'Error', `Unknown command: ${commandLine}`, 1500);
                    console.error('Unknown command:', commandLine);
                    break;
            }
        } catch (error) {
            console.error(`Error executing ${commandLine}: `, error);
            console.error(error && error.stack);
            createAlert('error', 'Error', `${commandLine} failed: ${error.message}`, 1500);
        }

        setValue('');
    };
    const onChange = (event, { newValue }) => {
        setValue(newValue);
    };

    // react-autosuggest passes the up-to-date input value as an argument —
    // reading the outer `value` state instead (as this did previously)
    // reads last render's value, since this callback and the onChange that
    // updates `value` both fire from the same, not-yet-re-rendered closure.
    // That made the suggestion list always one keystroke stale.
    const onSuggestionsFetchRequested = async ({ value: currentValue }) => {
        // Try completion first (fast, pure). If it needs missions and none
        // are loaded yet, fetch active missions once for this typing session
        const playersForCompletion = players || fetchedPlayers || [];
        const completion = commandCompletion.complete(currentValue, {
            players: playersForCompletion,
            missions: activeMissions,
        });

        if (completion.applied) {
            const before = currentValue.slice(0, completion.tokenStart);
            const after = currentValue.slice(completion.tokenEnd);
            setSuggestions(
                (completion.candidates || []).map((c) => ({ text: before + String(c) + (completion.appendSpace ? ' ' : '') + after }))
            );
            return;
        }

        if (
            !completion.applied &&
            currentValue.trim().toLowerCase().startsWith('/mission') &&
            !missionsLoadedForSession &&
            roomID
        ) {
            try {
                const docs = await fetchTasksByCompletionForRoom(false, roomID);
                const missions = docs.docs.map((d) => d.data());
                setActiveMissions(missions);
                setMissionsLoadedForSession(true);
                const completion2 = commandCompletion.complete(currentValue, { players: playersForCompletion, missions });
                if (completion2.applied) {
                    const before2 = currentValue.slice(0, completion2.tokenStart);
                    const after2 = currentValue.slice(completion2.tokenEnd);
                    setSuggestions(
                        (completion2.candidates || []).map((c) => ({ text: before2 + String(c) + (completion2.appendSpace ? ' ' : '') + after2 }))
                    );
                    return;
                }
            } catch (err) {
                // ignore suggestion fetch failure
            }
        }

        setSuggestions(getSuggestions(currentValue));
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

    const inputProps = {
        placeholder: 'Input Texts/Commands Here ',
        value,
        onChange,
        onKeyDown: async (event) => {
            if (event.key === 'Enter') {
                handleCommandExecution(value, setValue, roomID, xecutionContext, createAlert);
            } else if (event.key === 'Tab') {
                event.preventDefault();
                    // Prefer accepting the currently displayed suggestion (if any),
                    // since react-autosuggest manages highlighting and display.
                    if (suggestions.length > 0) {
                        setValue(getSuggestionValue(highlightedSuggestion ?? suggestions[0]).trimEnd());
                        setSuggestions([]);
                        return;
                    }

                    const playersForCompletion = (players && players.length > 0) ? players : (fetchedPlayers || (await getPlayersForUse()));

                    let completion = commandCompletion.complete(value, { players: playersForCompletion, missions: activeMissions });

                if (
                    !completion.applied &&
                    value.trim().toLowerCase().startsWith('/mission') &&
                    !missionsLoadedForSession &&
                    roomID
                ) {
                    try {
                        const docs = await fetchTasksByCompletionForRoom(false, roomID);
                        const missions = docs.docs.map((d) => d.data());
                        setActiveMissions(missions);
                        setMissionsLoadedForSession(true);
                        completion = commandCompletion.complete(value, { players: playersForCompletion, missions });
                    } catch (err) {
                        // ignore
                    }
                }

                if (completion.applied) {
                    const before = value.slice(0, completion.tokenStart);
                    const after = value.slice(completion.tokenEnd);
                    const newValue = before + completion.replacement + (completion.appendSpace ? ' ' : '') + after;
                    setValue(newValue.trimEnd());
                    setSuggestions((completion.candidates || []).map((c) => ({ text: String(c) })));
                } else if (suggestions.length > 0) {
                    setValue(getSuggestionValue(highlightedSuggestion ?? suggestions[0]));
                }
            }
        },
    };

    return (
        <Box sx={styles.inputBox}>
            <Autosuggest
                suggestions={suggestions}
                onSuggestionsFetchRequested={onSuggestionsFetchRequested}
                onSuggestionsClearRequested={onSuggestionsClearRequested}
                onSuggestionHighlighted={onSuggestionHighlighted}
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
                style={styles.enterImage}
                onClick={() =>
                    handleCommandExecution(value, setValue, roomID, xecutionContext, createAlert)
                }
                _hover={{ opacity: '.3' }}
                transition="opacity 0.1s ease-in-out"
            />
        </Box>
    );
}

// Commands used for game purposes — autosuggest options. `text` is the only
// field ever read (getSuggestions/getSuggestionValue/renderSuggestion); this
// used to also carry a `command: console.log('running')` field that did
// nothing but print nine "running" lines at import time and store `undefined`
// (improvements.md item 29).
const commands = [
    { text: '/add [player] points' },
    { text: '/broadcast [message]' },
    { text: '/kill [player] [assassin]' },
    { text: '/leaderboard send' },
    { text: '/mission done [player name] mission_index' },
    { text: '/mission end mission_index' },
    { text: '/mission start' },
    { text: '/mission view' },
    { text: '/openSeason [player] start/end' },
    { text: '/revive [player]' },
    { text: '/whisper [player] [message]' },
];

// Filter suggestions based on current input
const getSuggestions = (value) => {
    const inputValue = value.trim().toLowerCase();
    const inputLength = inputValue.length;

    return inputLength === 0
        ? []
        : commands.filter(
              (command) => command.text.toLowerCase().slice(0, inputLength) === inputValue
          );
};

// Get Name for Display Purposes
const getSuggestionValue = (suggestion) => {
    return suggestion.text;
};

// Rending for each display
const renderSuggestion = (suggestion) => {
    return <Box listStyleType="none">{suggestion.text}</Box>;
};

// handling for command execution is implemented inside the ChatInput
// component so it can access component-local state (players, getPlayersForUse).

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
