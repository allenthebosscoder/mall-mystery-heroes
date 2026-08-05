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
} from '../firebase_calls/dbCalls';
import RemapPlayers from '../RemapPlayers';
import { executeKill } from '../executeKill';
import { parseCommand, UNIMPLEMENTED_COMMANDS } from '../../game/commands';
import { normalizePlayerName } from '../../game/playerNames';
import CreateAlert from '../CreateAlert';

export default function ChatInput() {
    const [value, setValue] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const { roomID } = useContext(gameContext);
    const xecutionContext = useContext(executionContext);
    const createAlert = CreateAlert();

    const onChange = (event, { newValue }) => {
        setValue(newValue);
    };

    const onSuggestionsFetchRequested = () => {
        setSuggestions(getSuggestions(value));
    };

    const onSuggestionsClearRequested = () => {
        setSuggestions([]);
    };

    const inputProps = {
        placeholder: 'Input Texts/Commands Here ',
        value,
        onChange,
        onKeyDown: (event) => {
            if (event.key === 'Enter') {
                handleCommandExecution(value, setValue, roomID, xecutionContext, createAlert);
            }
        },
    };

    return (
        <Box sx={styles.inputBox}>
            <Autosuggest
                suggestions={suggestions}
                onSuggestionsFetchRequested={onSuggestionsFetchRequested}
                onSuggestionsClearRequested={onSuggestionsClearRequested}
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

// handling for command execution
const handleCommandExecution = async (value, setValue, roomID, xecutionContext, createAlert) => {
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
    } = xecutionContext; // retrieve contexts

    // dbCalls functions throw on failure rather than swallowing errors
    // (docs/improvements.md item 10), so this needs to catch them somewhere —
    // wrapping the whole switch (and the roster fetch every case depends on),
    // rather than every individual call, since there's no single case body
    // simple enough to inline a try/catch without the branching logic
    // becoming unreadable.
    try {
        const arrayOfPlayerNames = (await fetchAllPlayersForRoom(roomID)).map((name) =>
            normalizePlayerName(name)
        );
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
                // sanity check target and assassin input
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
                    // Validation, point transfer, the kill, unmapping, and
                    // the remap that follows all happen atomically inside
                    // executeKill now — a Cloud Function running in one
                    // Firestore transaction (docs/improvements.md item 4),
                    // shared with photo approval (item 5) so the two paths
                    // can't diverge on what counts as a valid kill. It
                    // throws — rather than returning an "invalid target"
                    // result — for "not a valid target", which the outer
                    // try/catch below turns into the same alert this used
                    // to raise inline.
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
                                        handlePlayerRevive(playerName);
                                        arrayOfAlivePlayers =
                                            await fetchAlivePlayerNamesForRoom(roomID);
                                        console.log('xxx: ', playerName);
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
                    handlePlayerRevive(playerName, createAlert);
                } else {
                    // Previously no else branch here at all — reviving a
                    // player who isn't dead (e.g. a typo, or a player
                    // already revived) did nothing with zero feedback
                    // (improvements item 21).
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
        createAlert('error', 'Error', `${commandLine} failed: ${error.message}`, 1500);
    }

    setValue('');
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
