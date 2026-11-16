import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlayersList from '../components/player_listing/PlayersList';
import { useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import {
    HStack,
    Heading,
    VStack,
    Box,
    Divider,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
} from '@chakra-ui/react';
import TaskCreationModal from '../components/task_components/TaskCreationModal';
import TaskList from '../components/task_components/TaskList';
import TaskListModal from '../components/task_components/TaskListModal';
import LeaderboardModal from '../components/game_end_components/LeaderboardModal';
import HeaderExecution from '../components/header_components/HeaderExecution';
import Log from '../components/logs_components/Log';
import CreateAlert from '../components/CreateAlert';
import {
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchRoomReferenceForRoom,
    addLogForRoom,
    addPlayerMessageForRoom,
    updateIsAliveForPlayer,
} from '../components/firebase_calls/dbCalls';
import { gameContext, executionContext } from '../components/Contexts';
import ChatInput from '../components/logs_components/ChatInput';
import PhotosDisplay from '../components/photos_display_component/PhotosDisplay';
import GMChatPanel from '../components/player_messages_components/GMChatPanel';
import ReconnectRequests from '../components/ReconnectRequests';
import { buildLeaderboardStandings } from '../game/leaderboard';

// Truly stable — module scope, not recreated per render or per instance.
// Previously `() => {}` defined inside the component, which (despite doing
// nothing) still got a brand new function identity every render, which
// would have defeated executionContextProviderValues' own memoization
// below if it had been added as a dependency.
const noop = () => {};

const GameMasterView = () => {
    const { roomID } = useParams();
    const [players, setPlayers] = useState([]);
    const [, setCompletedTasks] = useState([]);
    const [logList, setLogList] = useState([]);
    const createAlert = CreateAlert();
    const [showTaskCreationModal, setShowTaskCreationModal] = useState(false);
    const [showTaskListModal, setShowTaskListModal] = useState(false);
    const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
    const [isGameActive, setIsGameActive] = useState(true);
    const [gameBoundary, setGameBoundary] = useState(undefined);
    // Memoized on `players` — these three (plus the context value built
    // from the callbacks below) used to get a brand new array/object
    // identity every render regardless of whether `players` actually
    // changed, which cascaded into every consumer (ChatInput,
    // PhotosDisplay, TaskList, ReconnectRequests, HeaderExecution,
    // LeaderboardModal) re-rendering on every GameMasterView render —
    // including on every unrelated state change (opening a modal,
    // logList ticking), not just when something relevant to them changed.
    const aliveNames = useMemo(
        () => players.filter((player) => player.isAlive).map((player) => player.name),
        [players]
    );
    // Every player's name, alive or not — HeaderExecution threads this to
    // LivePlayerMapButton (unlike aliveNames, which the live map must NOT
    // use: an eliminated player's status doc needs its real name resolved
    // too, not a fallback to the raw normalized id).
    const allPlayerNames = useMemo(() => players.map((player) => player.name), [players]);
    const leaderboardStandings = useMemo(() => buildLeaderboardStandings(players), [players]);
    const logsBoxRef = useRef(null);

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
                    avatarUrl: doc.data().avatarUrl,
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

    // Keeps the logs panel pinned to the newest entry as it grows, instead
    // of leaving the GM scrolled to wherever they happened to be when the
    // next message arrived.
    useEffect(() => {
        const logsBox = logsBoxRef.current;
        if (!logsBox) return;
        logsBox.scrollTop = logsBox.scrollHeight;
    }, [logList]);

    // isGameActive is set true at room creation and false by endGame
    // (docs/improvements.md item 15's "relatedly" note) — this is what
    // reads it, so a room whose game has ended stops accepting commands
    // from any tab still open on it, not just the one that clicked "End
    // Game" (which navigates itself away separately).
    useEffect(() => {
        if (!roomID) return undefined;
        const roomRef = fetchRoomReferenceForRoom(roomID);
        const unsubscribe = onSnapshot(roomRef, (snapshot) => {
            setIsGameActive(snapshot.data()?.isGameActive ?? true);
            setGameBoundary(snapshot.data()?.gameBoundary);
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
    const addLog = useCallback(
        async (newLog, color) => {
            try {
                await addLogForRoom(newLog, color, roomID);
            } catch (error) {
                console.error('Error adding log: ', error);
                createAlert('warning', 'Log not saved', error.message, 1500);
            }
        },
        [roomID, createAlert]
    );

    // Mirrors addLog's error isolation (docs/improvements.md item 10) — a
    // failed player-facing broadcast shouldn't block or appear to fail the
    // primary action that triggered it, same reasoning as addLog itself.
    const broadcast = useCallback(
        async (text) => {
            try {
                await addPlayerMessageForRoom(
                    { type: 'broadcast', recipient: null, text, standings: null },
                    roomID
                );
            } catch (error) {
                console.error('Error broadcasting to players: ', error);
            }
        },
        [roomID]
    );

    // Sibling to broadcast(text) above, same error-isolation reasoning — this
    // one carries structured mission data instead of free text (see the
    // 'mission' render branch in MessageFeed.js).
    const broadcastMission = useCallback(
        async (mission) => {
            try {
                await addPlayerMessageForRoom(
                    { type: 'mission', recipient: null, text: null, standings: null, mission },
                    roomID
                );
            } catch (error) {
                console.error('Error broadcasting mission to players: ', error);
            }
        },
        [roomID]
    );

    const handleOpenSznstarted = useCallback(
        async (openSznplayer) => {
            await addLog(openSznplayer + ' has open season on them', 'lightblue');
            await broadcast(openSznplayer + ' has open season on them');
        },
        [addLog, broadcast]
    );

    const handleOpenSznended = useCallback(
        async (openSznplayer) => {
            await addLog('open season has ended for ' + openSznplayer, 'pink.400');
            await broadcast('open season has ended for ' + openSznplayer);
        },
        [addLog, broadcast]
    );

    // The players subscription above picks up the kill once executeKill's
    // write lands — no local array mutation needed.
    const handleKillPlayer = useCallback(
        async (killedPlayerName, assassinName, openSznstatus) => {
            if (openSznstatus === true) {
                await handleOpenSznended(killedPlayerName);
                await addLog('open season has ended for ' + killedPlayerName, 'pink.400');
            }
            await addLog(killedPlayerName + ' was killed by ' + assassinName, 'red.400');
            await broadcast(killedPlayerName + ' was killed by ' + assassinName);
        },
        [handleOpenSznended, addLog, broadcast]
    );

    // The players subscription above picks up the revive once
    // updateIsAliveForPlayer's write lands — no local array mutation needed.
    const handlePlayerRevive = useCallback(
        async (revivedPlayerName) => {
            await updateIsAliveForPlayer(revivedPlayerName, true, roomID);
            await addLog(revivedPlayerName + ' was revived', 'blue.300');
            await broadcast(revivedPlayerName + ' was revived');
        },
        [roomID, addLog, broadcast]
    );

    // TaskList (docs/improvements.md item 15) owns its own live subscription
    // to the tasks collection, so a new task shows up there without this
    // needing to track a parallel copy — this only logs the event and
    // closes the creation modal (docs/superpowers/specs/2026-08-04-
    // mission-modal-ui-design.md — creation closes automatically on
    // success).
    const handleNewTaskAdded = useCallback(
        async (newTask) => {
            setShowTaskCreationModal(false);
            await addLog('Added new task: ' + newTask.title, 'yellow.400');
            await broadcastMission({
                title: newTask.title,
                description: newTask.description,
                taskType: newTask.taskType,
                pointValue: newTask.pointValue,
                maxCompletions: newTask.maxCompletions,
            });
        },
        [addLog, broadcastMission]
    );

    const handleShowMissionCreation = useCallback(() => {
        setShowTaskCreationModal(true);
    }, []);

    const handleShowMissionList = useCallback(() => {
        setShowTaskListModal(true);
    }, []);

    const handleShowLeaderboardView = useCallback(() => {
        setShowLeaderboardModal(true);
    }, []);

    //updates completedTasks
    const handleTaskCompleted = useCallback(
        async (task) => {
            setCompletedTasks((completedTasks) => [...completedTasks, task]);
            await addLog('Completed task: ' + task, 'green.400');
            await broadcast('Completed task: ' + task);
        },
        [addLog, broadcast]
    );

    //updates logList with remapped targets
    const handleRemapping = useCallback(
        async (log) => {
            await addLog(log, 'blue.500');
        },
        [addLog]
    );

    // values for executionContext Provider — memoized so every consumer
    // (ChatInput, PhotosDisplay, TaskList, ReconnectRequests, TaskAccordion,
    // LeaderboardModal) only re-renders when one of these callbacks or
    // `addLog` actually changes identity, not on every GameMasterView
    // render. handleAddNewTargets/handleAddNewAssassins/
    // handleSetShowMessageToTrue used to feed RemapPlayerModal — a blocking
    // popup that fired on every kill/revive/mission completion that
    // reassigned targets, which the GM found "very annoying, not
    // necessary" since every remap it announces is already logged to the
    // GM log (handleRemapping, above). The popup and the state it
    // displayed are gone; these three stay as the shared module-scope
    // `noop` rather than being removed outright, since ChatInput.js and
    // PhotosDisplay.js still call all three from several call sites each —
    // a deeper cleanup, not needed to fix this bug.
    const executionContextProviderValues = useMemo(
        () => ({
            handleKillPlayer,
            handleAddNewAssassins: noop,
            handleAddNewTargets: noop,
            handleRemapping,
            handlePlayerRevive,
            handleTaskCompleted,
            handleNewTaskAdded,
            handleSetShowMessageToTrue: noop,
            handleShowLeaderboardView,
            handleShowMissionCreation,
            handleShowMissionList,
            handleOpenSznstarted,
            handleOpenSznended,
            addLog,
        }),
        [
            handleKillPlayer,
            handleRemapping,
            handlePlayerRevive,
            handleTaskCompleted,
            handleNewTaskAdded,
            handleShowLeaderboardView,
            handleShowMissionCreation,
            handleShowMissionList,
            handleOpenSznstarted,
            handleOpenSznended,
            addLog,
        ]
    );

    return (
        <gameContext.Provider value={{ roomID, players, isGameActive }}>
            <Box sx={styles.container}>
                <TaskCreationModal
                    isOpen={showTaskCreationModal}
                    onClose={() => setShowTaskCreationModal(false)}
                    handleNewTaskAdded={handleNewTaskAdded}
                />
                <TaskListModal
                    isOpen={showTaskListModal}
                    onClose={() => setShowTaskListModal(false)}
                />
                {/* TaskAccordion needs addLog for mission edit/delete
                    announcements, so it shares the execution context here. */}
                <executionContext.Provider value={executionContextProviderValues}>
                    <LeaderboardModal
                        isOpen={showLeaderboardModal}
                        onClose={() => setShowLeaderboardModal(false)}
                        standings={leaderboardStandings}
                    />
                </executionContext.Provider>

                <Box h="6%" m="2px" marginX="4px">
                    <HeaderExecution
                        addLog={addLog}
                        arrayOfAlivePlayers={aliveNames}
                        allPlayerNames={allPlayerNames}
                        gameBoundary={gameBoundary}
                    />
                </Box>

                {/* ReconnectRequests needs addLog from executionContext, but
                    belongs visually in the header area, which sits outside
                    both narrower executionContext.Provider scopes below —
                    same situation as TaskAccordion above, same fix. */}
                <executionContext.Provider value={executionContextProviderValues}>
                    <ReconnectRequests />
                </executionContext.Provider>

                <HStack sx={styles.gameDisplayWrapper}>
                    <Box sx={styles.playersListWrapper}>
                        <Heading sx={styles.playerListHeader}>Players ({players.length})</Heading>
                        <Divider />
                        <PlayersList players={players} />
                    </Box>

                    <Box sx={styles.logsWrapper}>
                        <Tabs
                            display="flex"
                            flexDirection="column"
                            h="100%"
                            minH={0}
                            variant="unstyled"
                        >
                            <TabList flexShrink={0}>
                                <Tab sx={styles.tabHeader}>Player Chat</Tab>
                                <Tab sx={styles.tabHeader}>Logs</Tab>
                            </TabList>
                            <TabPanels flex="1" minH={0}>
                                <TabPanel h="100%" display="flex" flexDirection="column" p={2}>
                                    <GMChatPanel roomID={roomID} />
                                </TabPanel>
                                <TabPanel h="100%" display="flex" flexDirection="column" p={2}>
                                    <Box
                                        sx={styles.logsBox}
                                        ref={logsBoxRef}
                                        data-testid="logs-box"
                                    >
                                        <Log logList={logList} />
                                    </Box>
                                </TabPanel>
                            </TabPanels>
                            <Divider />
                            <executionContext.Provider value={executionContextProviderValues}>
                                <Box sx={styles.logInput}>
                                    <ChatInput />
                                </Box>
                            </executionContext.Provider>
                        </Tabs>
                    </Box>

                    <executionContext.Provider value={executionContextProviderValues}>
                        <VStack sx={styles.rightHandStack}>
                            <Box sx={styles.photosBox}>
                                <PhotosDisplay players={players} />
                            </Box>
                            <Box sx={styles.missionPanelWrapper}>
                                <Heading sx={styles.chatHeaderText}>Missions</Heading>
                                <Divider />
                                <TaskList onStartMission={handleShowMissionCreation} />
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
        fontSize: '28px',
        fontWeight: 'bold',
        textAlign: 'center',
        m: '4px',
        my: '8px',
    },
    chatHeaderText: {
        size: 'lg',
        textAlign: 'center',
        mb: '4px',
        fontSize: '26px',
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
        flex: '1',
        minH: 0,
    },
    logInput: {
        flex: '0 0 56px',
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
        h: '58%',
    },
    missionPanelWrapper: {
        w: '100%',
        flex: '1',
        mt: '8px',
        borderWidth: '2px',
        borderRadius: '2xl',
        p: '4px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
    },
    tabHeader: {
        fontSize: '28px',
        fontWeight: 'bold',
        textAlign: 'center',
        w: '50%',
        outline: 'none',
        boxShadow: 'none',
        _selected: { borderBottom: '2px solid', borderColor: 'blue.300', color: 'blue.300' },
        borderBottom: '2px solid',
        borderColor: 'gray.300',
    },
};
