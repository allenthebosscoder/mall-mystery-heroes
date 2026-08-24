import React, { useCallback, useEffect, useState } from 'react';
import { Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
    fetchAllPlayersQueryForRoom,
} from '../components/firebase_calls/dbCalls';
import { buildLeaderboardStandings } from '../game/leaderboard';
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';
import MessageFeed from '../components/player_messages_components/MessageFeed';
import MessageComposer from '../components/player_messages_components/MessageComposer';
import GameOverScreen from '../components/game_end_components/GameOverScreen';

const PlayerGame = () => {
    const { roomID } = useParams();
    const navigate = useNavigate();
    const [gameStarted, setGameStarted] = useState(false);
    const [isGameActive, setIsGameActive] = useState(true);
    const [playerData, setPlayerData] = useState(null);
    const [players, setPlayers] = useState([]);
    // This player's own chat sends that MessageComposer has fired off but
    // Firestore hasn't confirmed yet — submitChatMessage writes server-side
    // now, so this browser no longer gets an automatic local echo of its
    // own write the way a direct client write used to give it. Lifted here
    // since MessageFeed (which renders them) and MessageComposer (which
    // adds them) are siblings with no other shared state.
    const [pendingMessages, setPendingMessages] = useState([]);
    const session = readPlayerSession();
    const playerName = session && session.roomID === roomID ? session.playerName : '';

    useEffect(() => {
        setPendingMessages([]);
    }, [roomID]);

    const handleOptimisticSend = useCallback((message) => {
        setPendingMessages((previous) => [...previous, message]);
    }, []);

    const handleOptimisticSendFailed = useCallback((id) => {
        setPendingMessages((previous) => previous.filter((message) => message.id !== id));
    }, []);

    // MessageFeed calls this once per real, server-confirmed chat message
    // it sees from this player — oldest pending entry first, so the
    // hand-off from "my local preview" to "the real thing" never needs to
    // match on content, just consume in the order they were sent.
    const handlePendingMessageConfirmed = useCallback(() => {
        setPendingMessages((previous) => previous.slice(1));
    }, []);

    // Shared by every subscription below: a permission error or the
    // watched doc disappearing both mean this session no longer belongs
    // here (room deleted, or — for the player doc — the GM removed this
    // player from the roster), so both bounce the same way a deleted room
    // already does.
    const handleSubscriptionError = useCallback(
        (err) => {
            console.error('Error watching game state:', err);
            clearPlayerSession();
            navigate('/', { replace: true });
        },
        [navigate]
    );

    // "Leave" (below) only ends this device's local session: it does not
    // remove the player from the room's roster, touch joinedUids, or
    // affect their targets/assassins. Actually leaving a game is a
    // separate, larger feature not addressed here
    // (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
    useEffect(() => {
        if (!roomID) return undefined;
        const roomRef = fetchRoomReferenceForRoom(roomID);
        const unsubscribe = onSnapshot(
            roomRef,
            (snapshot) => {
                if (!snapshot.exists()) {
                    clearPlayerSession();
                    navigate('/', { replace: true });
                    return;
                }
                setGameStarted(snapshot.data()?.gameStarted ?? false);
                setIsGameActive(snapshot.data()?.isGameActive ?? true);
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, navigate, handleSubscriptionError]);

    // Only starts once the game has actually begun — no need to read the
    // player's own doc while still in the waiting room, and it keeps the
    // waiting screen's read footprint unchanged from before this doc.
    useEffect(() => {
        if (!roomID || !gameStarted || !playerName) return undefined;
        const playerRef = fetchPlayerReferenceForRoom(playerName, roomID);
        const unsubscribe = onSnapshot(
            playerRef,
            (snapshot) => {
                if (!snapshot.exists()) {
                    clearPlayerSession();
                    navigate('/', { replace: true });
                    return;
                }
                setPlayerData(snapshot.data());
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, gameStarted, playerName, navigate, handleSubscriptionError]);

    // Only subscribes once the game has ended — GameOverScreen is the only
    // consumer of the full roster, so this costs nothing during normal
    // gameplay (docs/superpowers/specs/2026-08-17-player-game-over-screen-design.md).
    useEffect(() => {
        if (!roomID || isGameActive) return undefined;
        const playersQuery = fetchAllPlayersQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            playersQuery,
            (snapshot) => {
                setPlayers(snapshot.docs.map((doc) => doc.data()));
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, isGameActive, handleSubscriptionError]);

    const handleLeave = async () => {
        try {
            await signOut(auth);
        } catch (err) {
            console.error('Error signing out:', err);
        }
        clearPlayerSession();
        navigate('/');
    };

    const standings = buildLeaderboardStandings(players);

    return (
        <Flex height="100vh" direction="column" p={4}>
            <Flex justifyContent="space-between" alignItems="center" mb={2}>
                <Heading size="md">
                    {playerName || 'You'} joined {roomID}
                </Heading>
                <Button size="sm" colorScheme="red" variant="outline" onClick={handleLeave}>
                    Leave
                </Button>
            </Flex>
            {!isGameActive && <GameOverScreen standings={standings} />}
            {isGameActive && (
                <>
                    {!gameStarted && <Text mb={4}>Waiting for the host to start...</Text>}
                    {gameStarted && playerData?.isAlive && (
                        <Text mb={4}>
                            {(playerData.targets ?? []).length > 0
                                ? `Your target: ${(playerData.targets ?? []).join(', ')}`
                                : 'Waiting for your target...'}
                        </Text>
                    )}
                    {gameStarted && playerData && !playerData.isAlive && (
                        <>
                            <Heading size="md" mb={2}>
                                You&apos;ve been eliminated
                            </Heading>
                            <Text mb={4}>
                                You may be revived if the host assigns you a revival mission.
                            </Text>
                        </>
                    )}
                    <MessageFeed
                        roomID={roomID}
                        playerName={playerName}
                        pendingMessages={pendingMessages}
                        onPendingMessageConfirmed={handlePendingMessageConfirmed}
                    />
                    <MessageComposer
                        roomID={roomID}
                        playerName={playerName}
                        targets={playerData?.targets ?? []}
                        onOptimisticSend={handleOptimisticSend}
                        onOptimisticSendFailed={handleOptimisticSendFailed}
                    />
                </>
            )}
        </Flex>
    );
};

export default PlayerGame;
