import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    Button,
    Flex,
    Heading,
    Text,
    useDisclosure,
} from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
} from '../components/firebase_calls/dbCalls';
import { leaveGame } from '../components/leaveGame';
import CreateAlert from '../components/CreateAlert';
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';
import MessageFeed from '../components/player_messages_components/MessageFeed';
import MessageComposer from '../components/player_messages_components/MessageComposer';

const PlayerGame = () => {
    const { roomID } = useParams();
    const navigate = useNavigate();
    const [gameStarted, setGameStarted] = useState(false);
    const [isGameActive, setIsGameActive] = useState(true);
    const [playerData, setPlayerData] = useState(null);
    // This player's own chat sends that MessageComposer has fired off but
    // Firestore hasn't confirmed yet — submitChatMessage writes server-side
    // now, so this browser no longer gets an automatic local echo of its
    // own write the way a direct client write used to give it. Lifted here
    // since MessageFeed (which renders them) and MessageComposer (which
    // adds them) are siblings with no other shared state.
    const [pendingMessages, setPendingMessages] = useState([]);
    const session = readPlayerSession();
    const playerName = session && session.roomID === roomID ? session.playerName : '';
    const { isOpen, onOpen, onClose } = useDisclosure();
    const cancelRef = useRef();
    const createAlert = CreateAlert();

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

    const handleLeaveClick = () => {
        onOpen();
    };

    const handleConfirmLeave = async () => {
        try {
            await leaveGame(roomID);
        } catch (err) {
            console.error('Error leaving game:', err);
            onClose();
            createAlert('error', 'Error leaving game', err.message, 1500);
            return;
        }

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
                <Button size="sm" colorScheme="red" variant="outline" onClick={handleLeaveClick}>
                    Leave
                </Button>
            </Flex>
            <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose}>
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader color="red">WARNING</AlertDialogHeader>
                    <AlertDialogBody color="#FFFFFF">
                        Leave the game? You&apos;ll be removed and cannot rejoin.
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={handleConfirmLeave}>
                            Confirm
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {/* Once the game has ended, the target/status text no longer
                applies — the "please head back" and final-standings
                announcements arrive as real chat messages instead
                (Endgamebutton.js posts them). Chat itself stays mounted
                either way, so players can keep talking on the way back. */}
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
                isGameActive={isGameActive}
                onOptimisticSend={handleOptimisticSend}
                onOptimisticSendFailed={handleOptimisticSendFailed}
            />
        </Flex>
    );
};

export default PlayerGame;
