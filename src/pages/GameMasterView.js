import React from 'react';
import { useState, useEffect } from 'react';
import PlayersList from '../components/player_listing/PlayersList';
import { useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { HStack, Heading, VStack, Box, Divider } from '@chakra-ui/react';
import TaskCreationModal from '../components/task_components/TaskCreationModal';
import TaskListModal from '../components/task_components/TaskListModal';
import HeaderExecution from '../components/header_components/HeaderExecution';
import Log from '../components/logs_components/Log';
import CreateAlert from '../components/CreateAlert';
import {
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchLogsQueryByAscendingTimestampForRoom,
    addLogForRoom,
    updateIsAliveForPlayer,
} from '../components/firebase_calls/dbCalls';
import RemapPlayerModal from '../components/RemapPlayerModal';
import { gameContext, executionContext } from '../components/Contexts';
import ChatInput from '../components/logs_components/ChatInput';
import PhotosDisplay from '../components/photos_display_component/PhotosDisplay';

const GameMasterView = () => {
    const { roomID } = useParams();
    const [players, setPlayers] = useState([]);
    const [, setCompletedTasks] = useState([]);
    const [logList, setLogList] = useState([]);
    const createAlert = CreateAlert();
    const [newTargets, setNewTargets] = useState({});
    const [newAssassins, setNewAssassins] = useState({});
    const [showRemapModal, setShowRemapModal] = useState(false);
    const [showTaskCreationModal, setShowTaskCreationModal] = useState(false);
    const [showTaskListModal, setShowTaskListModal] = useState(false);
    const aliveNames = players.filter((player) => player.isAlive).map((player) => player.name);

    // Players and logs are both live subscriptions now, not fetched once and
    // mutated by hand (docs/improvements.md items 13 and 22) — this is what
    // used to disagree with PlayersList's own independent subscription and
    // go stale across reloads/other tabs.
    useEffect(() => {
        if (!roomID) return undefined;
        const playersQuery = fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID);
        const unsubscribe = onSnapshot(playersQuery, (snapshot) => {
            setPlayers(
                snapshot.docs.map((doc) => ({
                    name: doc.data().name,
                    score: doc.data().score,
                    targets: doc.data().targets,
                    openSeason: doc.data().openSeason,
                    isAlive: doc.data().isAlive,
                }))
            );
        });
        return () => unsubscribe();
    }, [roomID]);

    useEffect(() => {
        if (!roomID) return undefined;
        const logsQuery = fetchLogsQueryByAscendingTimestampForRoom(roomID);
        const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
            setLogList(snapshot.docs.map((doc) => doc.data()));
        });
        return () => unsubscribe();
    }, [roomID]);

    //adds a new log entry. The logs subcollection subscription above picks
    // up the write and updates logList — no local append needed.
    //
    // Catches its own errors (docs/improvements.md item 10) rather than
    // letting them propagate: addLog is called from many places (kills,
    // revives, open season toggles, photo judgments), and a failed log write
    // shouldn't block or appear to fail the primary action that triggered it.
    const addLog = async (newLog, color) => {
        try {
            await addLogForRoom(newLog, color, roomID);
        } catch (error) {
            console.error('Error adding log: ', error);
            createAlert('warning', 'Log not saved', error.message, 1500);
        }
    };

    // The players subscription above picks up the kill once executeKill's
    // write lands — no local array mutation needed.
    const handleKillPlayer = async (killedPlayerName, assassinName, openSznstatus) => {
        if (openSznstatus === true) {
            handleOpenSznended(killedPlayerName);
            await addLog('open season has ended for ' + killedPlayerName, 'pink.400');
        }
        await addLog(killedPlayerName + ' was killed by ' + assassinName, 'red.400');
    };

    const handleOpenSznstarted = async (openSznplayer) => {
        await addLog(openSznplayer + ' has open season on them', 'lightblue');
    };

    const handleOpenSznended = async (openSznplayer) => {
        await addLog('open season has ended for ' + openSznplayer, 'pink.400');
    };

    // The players subscription above picks up the revive once
    // updateIsAliveForPlayer's write lands — no local array mutation needed.
    const handlePlayerRevive = async (revivedPlayerName) => {
        await updateIsAliveForPlayer(revivedPlayerName, true, roomID);
        await addLog(revivedPlayerName + ' was revived', 'blue.300');
    };

    // TaskList (docs/improvements.md item 15) owns its own live subscription
    // to the tasks collection, so a new task shows up there without this
    // needing to track a parallel copy — this only logs the event and
    // closes the creation modal (docs/superpowers/specs/2026-08-04-
    // mission-modal-ui-design.md — creation closes automatically on
    // success).
    const handleNewTaskAdded = async (newTask) => {
        setShowTaskCreationModal(false);
        await addLog('Added new task: ' + newTask.title, 'yellow.400');
    };

    const handleShowMissionCreation = () => {
        setShowTaskCreationModal(true);
    };

    const handleShowMissionList = () => {
        setShowTaskListModal(true);
    };

    //updates completedTasks
    const handleTaskCompleted = async (task) => {
        setCompletedTasks((completedTasks) => [...completedTasks, task]);
        await addLog('Completed task: ' + task, 'green.400');
    };

    //updates logList with remapped targets
    const handleRemapping = async (log) => {
        await addLog(log, 'blue.500');
    };

    //updates newTargets and newAssassins, and shows RemapPlayerModal
    const handleAddNewTargets = (targets) => {
        setNewTargets(targets);
    };
    const handleAddNewAssassins = (assassins) => {
        setNewAssassins(assassins);
    };
    const handleSetShowMessageToTrue = () => {
        setShowRemapModal(true);
        console.log('set show message to true');
    };

    // values for executionContext Provider
    const executionContextProviderValues = {
        handleKillPlayer,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleRemapping,
        handlePlayerRevive,
        handleTaskCompleted,
        handleSetShowMessageToTrue,
        handleShowMissionCreation,
        handleShowMissionList,
        handleOpenSznstarted,
        handleOpenSznended,
        addLog,
    };

    return (
        <gameContext.Provider value={{ roomID }}>
            <Box sx={styles.container}>
                <RemapPlayerModal
                    showRemapModal={showRemapModal}
                    newTargets={newTargets}
                    newAssassins={newAssassins}
                    onClose={() => setShowRemapModal(false)}
                />
                <TaskCreationModal
                    isOpen={showTaskCreationModal}
                    onClose={() => setShowTaskCreationModal(false)}
                    handleNewTaskAdded={handleNewTaskAdded}
                />
                <TaskListModal
                    isOpen={showTaskListModal}
                    onClose={() => setShowTaskListModal(false)}
                />

                <Box h="6%" m="2px" marginX="4px">
                    <HeaderExecution addLog={addLog} arrayOfAlivePlayers={aliveNames} />
                </Box>

                <HStack sx={styles.gameDisplayWrapper}>
                    <Box sx={styles.playersListWrapper}>
                        <Heading sx={styles.playerListHeader}>Players ({players.length})</Heading>
                        <Divider />
                        <PlayersList players={players} />
                    </Box>

                    <Box sx={styles.logsWrapper}>
                        <Heading sx={styles.chatHeaderText}>Logs</Heading>
                        <Divider />
                        <Box sx={styles.logsBox}>
                            <Log logList={logList} />
                        </Box>
                        <Divider />
                        <executionContext.Provider value={executionContextProviderValues}>
                            <Box sx={styles.logInput}>
                                <ChatInput />
                            </Box>
                        </executionContext.Provider>
                    </Box>

                    <executionContext.Provider value={executionContextProviderValues}>
                        <VStack sx={styles.rightHandStack}>
                            <Box sx={styles.photosBox}>
                                <PhotosDisplay />
                            </Box>
                        </VStack>
                    </executionContext.Provider>
                </HStack>
            </Box>
        </gameContext.Provider>
    );
};

export default GameMasterView;

const styles = {
    gameDisplayWrapper: {
        alignItems: 'left',
        p: '5px',
        flex: '1',
        m: '2px',
        overflow: 'hidden',
    },
    container: {
        h: '100vh',
        display: 'flex',
        flexDirection: 'column',
    },
    playersListWrapper: {
        w: '20%',
        minW: '20%',
        h: '95%',
        borderWidth: '2px',
        borderRadius: '1.5rem',
        px: '2px',
        mx: '8px',
    },
    playerListHeader: {
        fontSize: '26px',
        textAlign: 'center',
        m: '4px',
    },
    chatHeaderText: {
        size: 'lg',
        textAlign: 'center',
        mb: '4px',
    },
    logsWrapper: {
        borderWidth: '2px',
        borderRadius: '2xl',
        p: '4px',
        w: '55%',
        h: '95%',
        mx: '4px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
    },
    logsBox: {
        overflow: 'auto',
        h: '85%',
        minH: '85%',
    },
    logInput: {
        flex: '1',
    },
    rightHandStack: {
        ml: '10px',
        mr: '16px',
        w: '25%',
        minW: '25%',
        // 95%, not 100% — matches playersListWrapper/logsWrapper, its
        // siblings in the same row. The mismatch used to make the photos
        // box's border extend past the players/logs boxes below them.
        h: '95%',
    },
    photosBox: {
        w: { base: '100%', md: '100%' },
        // PhotosDisplay is the only child of rightHandStack again — the
        // mission panel that used to share this space moved into on-demand
        // modals instead (docs/superpowers/specs/2026-08-04-mission-modal-
        // ui-design.md), so there's no sibling to split height with anymore.
        h: '100%',
    },
};
