import React, { useEffect, useState } from 'react';
import { Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { fetchRoomReferenceForRoom } from '../components/firebase_calls/dbCalls';
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';

const PlayerGame = () => {
    const { roomID } = useParams();
    const navigate = useNavigate();
    const [gameStarted, setGameStarted] = useState(false);
    const session = readPlayerSession();
    const playerName = session && session.roomID === roomID ? session.playerName : '';

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
            (err) => {
                // Defense-in-depth: a room-scoped read can also fail as an
                // error event rather than a not-exists snapshot — e.g. in
                // the moment between a room's deletion and any propagation
                // delay, or any other permission error. Without this
                // callback, onSnapshot swallows that error silently and the
                // screen freezes forever with the local session never
                // cleared.
                console.error('Error watching room:', err);
                clearPlayerSession();
                navigate('/', { replace: true });
            }
        );
        return () => unsubscribe();
    }, [roomID, navigate]);

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
        <Flex height="100vh" alignItems="center" justifyContent="center" direction="column" p={4}>
            <Heading size="lg" mb={2}>
                {playerName || 'You'} joined {roomID}
            </Heading>
            <Text mb={6}>
                {gameStarted ? 'The game has started!' : 'Waiting for the host to start...'}
            </Text>
            <Button colorScheme="red" variant="outline" onClick={handleLeave}>
                Leave
            </Button>
        </Flex>
    );
};

export default PlayerGame;
