import React, { useCallback, useEffect, useState } from 'react';
import { Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
} from '../components/firebase_calls/dbCalls';
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';
import MessageFeed from '../components/player_messages_components/MessageFeed';
import MessageComposer from '../components/player_messages_components/MessageComposer';

const PlayerGame = () => {
    const { roomID } = useParams();
    const navigate = useNavigate();
    const [gameStarted, setGameStarted] = useState(false);
    const [playerData, setPlayerData] = useState(null);
    const session = readPlayerSession();
    const playerName = session && session.roomID === roomID ? session.playerName : '';

    // Shared by both subscriptions below: a permission error or the watched
    // doc disappearing both mean this session no longer belongs here (room
    // deleted, or — for the player doc — the GM removed this player from the
    // roster), so both bounce the same way a deleted room already does.
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

    const handleLeave = async () => {
        try {
            await signOut(auth);
        } catch (err) {
            console.error('Error signing out:', err);
        }
        clearPlayerSession();
        navigate('/');
    };

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
            <MessageFeed roomID={roomID} playerName={playerName} />
            <MessageComposer
                roomID={roomID}
                playerName={playerName}
                targets={playerData?.targets ?? []}
            />
        </Flex>
    );
};

export default PlayerGame;
