import React, { useState } from 'react';
import { Button, Input, Stack, Heading, Flex, Alert, AlertIcon } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { joinRoom } from '../components/joinRoom';
import { writePlayerSession } from '../utils/playerSession';

const JoinGame = () => {
    const navigate = useNavigate();
    const [gameId, setGameId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        const trimmedGameId = gameId.trim();
        setErrorMessage('');
        setIsSubmitting(true);

        try {
            await signInAnonymously(auth);
            await joinRoom(trimmedGameId, playerName);
            writePlayerSession(trimmedGameId, playerName);
            navigate(`/rooms/${trimmedGameId}/waiting`);
        } catch (err) {
            setErrorMessage(err.message);
            console.error('Error joining game:', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center" p={4}>
            <Stack as="form" onSubmit={handleSubmit} spacing={4} width="100%" maxWidth="320px">
                <Heading size="lg" textAlign="center">
                    Join Game
                </Heading>
                {errorMessage && (
                    <Alert borderRadius="2xl" status="error" bg="#FF5252">
                        <AlertIcon color="white" />
                        {errorMessage}
                    </Alert>
                )}
                <Input
                    placeholder="Game ID"
                    value={gameId}
                    onChange={(e) => setGameId(e.target.value)}
                    borderWidth="3px"
                />
                <Input
                    placeholder="Your name"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    borderWidth="3px"
                />
                <Button type="submit" colorScheme="teal" isLoading={isSubmitting}>
                    Join
                </Button>
            </Stack>
        </Flex>
    );
};

export default JoinGame;
