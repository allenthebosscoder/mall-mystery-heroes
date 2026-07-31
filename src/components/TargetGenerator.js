import React, { useState } from 'react';
import {
    AlertDialog,
    Button,
    AlertDialogBody,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    AlertDialogContent,
    useDisclosure,
    TableContainer,
    Tr,
    Td,
    Th,
    Tbody,
    Table,
    Thead,
} from '@chakra-ui/react';
import { updateAssassinsForPlayer, updateTargetsForPlayer } from './firebase_calls/dbCalls';
import { buildTargetGraph } from '../game/targetGraph';
const TargetGenerator = ({ arrayOfPlayers, roomID, handleLobbyRoom }) => {
    // The target/assassin adjacency lists for the round, built on open.
    const [graph, setGraph] = useState({ targets: {}, assassins: {} });

    //reference to players subcollection
    const { isOpen, onOpen, onClose } = useDisclosure();
    const cancelRef = React.useRef();

    //actions that occur when clicking generate button
    const handleClick = () => {
        onOpen();
        setGraph(buildTargetGraph(arrayOfPlayers));
    };
    //actions that occur when clicking yes
    const onYesClose = async () => {
        await UpdateDatabase(arrayOfPlayers, graph);
        onClose();
        handleLobbyRoom();
    };
    //updates targets in database
    const UpdateDatabase = async (players, { targets, assassins }) => {
        try {
            for (const player of players) {
                await updateTargetsForPlayer(player, targets[player] ?? [], roomID);
                await updateAssassinsForPlayer(player, assassins[player] ?? [], roomID);
            }
        } catch (error) {
            console.error('Error adding targets to database: ', error);
        }
    };

    const tableOfPlayers = arrayOfPlayers.map((eachName) => (
        <Tr key={eachName}>
            <Td>{eachName}</Td>
            <Td>{graph.targets[eachName]?.join(', ') || 'no targets'}</Td>
        </Tr>
    ));

    return (
        <div>
            <Button
                bg="black"
                color="white"
                variant="solid"
                size="lg"
                borderRadius="3xl"
                _hover={{ bg: 'white', color: 'black' }}
                mt="8px"
                onClick={handleClick}
            >
                Begin Game
            </Button>
            <AlertDialog
                isOpen={isOpen}
                leastDestructiveRef={cancelRef}
                onClose={onClose}
                size="3xl"
            >
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader>Generate Targets</AlertDialogHeader>

                    <AlertDialogBody>
                        The following will be the initial targets for the the round:
                        <TableContainer>
                            <Table>
                                <Thead>
                                    <Tr>
                                        <Th color="#FFFFFF">Player</Th>
                                        <Th color="#FFFFFF">Targets</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>{tableOfPlayers}</Tbody>
                            </Table>
                        </TableContainer>
                    </AlertDialogBody>

                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={onYesClose}>
                            Confirm and Begin Game
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default TargetGenerator;
