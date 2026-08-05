import React, { useState } from 'react';
import { Box, Flex, Image, Input } from '@chakra-ui/react';
import CreateAlert from '../CreateAlert';
import enter from '../../assets/enter-black.png';
import { addPlayerForRoom } from '../firebase_calls/dbCalls';

//adds player to database
const PlayerAddition = (props) => {
    const [playerName, setPlayerName] = useState(''); //defines player name
    const roomID = props.roomID;
    const onPlayerAdded = props.onPlayerAdded;
    const createAlert = CreateAlert();
    const [isHover, setIsHover] = useState(false);
    // Guards against a second submit firing before the first resolves — e.g.
    // pressing Enter twice while the request is in flight. addPlayerForRoom
    // is now atomic regardless (see its comment in dbCalls.js), but there's
    // no reason to send a request that's going to be rejected as a duplicate.
    const [isSubmitting, setIsSubmitting] = useState(false);

    //setes playerName to input
    const handleInputChange = (event) => {
        setPlayerName(event.target.value);
    };

    //handles function to add player
    const handleAddPlayer = async () => {
        if (isSubmitting) return;
        if (playerName.replace(/\s/g, '') === '') {
            return createAlert('error', 'Error', 'name cannot be blank', 1500);
        }
        setIsSubmitting(true);
        try {
            await addPlayerForRoom(playerName, roomID);
        } catch (error) {
            console.error('Error adding player: ', error);
            // addPlayerForRoom now awaits its write, so a failed save reaches
            // here too — not just the duplicate-name rejection.
            const message =
                error.message === 'Player already exists'
                    ? 'name already exists'
                    : 'could not add player, please try again';
            return createAlert('error', 'Error', message, 1500);
        } finally {
            setIsSubmitting(false);
        }
        setPlayerName('');
        if (onPlayerAdded) onPlayerAdded(playerName);
    };

    //handles submission
    const handleSubmit = (event) => {
        event.preventDefault();
        handleAddPlayer();
    };

    return (
        <div>
            <form onSubmit={handleSubmit}>
                <Flex padding="10px" w="100%">
                    <Input
                        placeholder="Enter Player Name"
                        fontSize="16"
                        value={playerName}
                        onChange={handleInputChange}
                        isDisabled={isSubmitting}
                        size="lg"
                        borderRadius="3xl"
                        ml="30%"
                        borderColor="black"
                        color="black"
                        borderWidth="2px"
                        bg="#9FF0AB"
                        _hover={{ borderColor: 'gray', bg: '#9FF0AB' }}
                    />
                    <Box ml="6px">
                        <Image
                            src={enter}
                            alt="Enter Image"
                            onMouseEnter={() => setIsHover(true)}
                            onMouseLeave={() => setIsHover(false)}
                            onClick={handleSubmit}
                            w="30%"
                            h="100%"
                            opacity={isHover ? '40%' : '100%'}
                            transition="opacity 0.2s ease"
                        />
                    </Box>
                </Flex>
            </form>
        </div>
    );
};

export default PlayerAddition;
