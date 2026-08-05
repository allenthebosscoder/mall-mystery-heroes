import {
    Flex,
    Button,
    AlertDialog,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    AlertDialogContent,
    useDisclosure,
} from '@chakra-ui/react';
import React, { useContext } from 'react';
import { endGame } from '../firebase_calls/dbCalls';
import { useNavigate } from 'react-router-dom';
import CreateAlert from '../CreateAlert';
import { gameContext } from '../Contexts';

const Endgamebutton = () => {
    const { roomID } = useContext(gameContext);
    const cancelRef = React.useRef();
    const navigate = useNavigate();
    const createAlert = CreateAlert();

    const { isOpen, onOpen, onClose } = useDisclosure();

    // endGame throws on failure rather than swallowing (docs/improvements.md
    // item 10) — previously this fired-and-forgot the write and navigated
    // away immediately regardless, so a failure was invisible and the GM
    // would land on /dashboard believing the game had ended when it hadn't.
    const onYesEnd = async () => {
        onClose();
        try {
            await endGame(roomID);
            navigate('/dashboard');
        } catch (error) {
            console.error('Error ending game: ', error);
            createAlert('error', 'Error ending game', error.message, 1500);
        }
    };

    const handleClick = () => {
        onOpen();
    };

    return (
        <Flex>
            <Button
                bg="red.500"
                color="white"
                variant="solid"
                size="md"
                borderRadius="3xl"
                _hover={{ bg: 'white', color: 'black' }}
                onClick={handleClick}
                mr="12px"
            >
                End Game
            </Button>
            <AlertDialog
                isOpen={isOpen}
                leastDestructiveRef={cancelRef}
                onClose={onClose}
                size="3xl"
            >
                <AlertDialogOverlay alignItems="center" justifyContent="center" />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader
                        alignItems="center"
                        justifyContent="center"
                        textAlign="center"
                    >
                        Are you sure you want to end the Game?
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={onYesEnd}>
                            Confirm End Game
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Flex>
    );
};
export default Endgamebutton;
