import { Flex, HStack, Select, Image, Spinner, useToast, Button } from "@chakra-ui/react";
import { useContext, useState } from "react";
import { db } from '../utils/firebase';
import { collection, query, getDocs, where, updateDoc } from "firebase/firestore";
import opensznimg from '../assets/openseason-white.svg';
import { executionContext, gameContext } from "./Contexts";

const OpenSeason = ({ handleOpenSzn }) => {
    const { arrayOfAlivePlayers,
            handleOpenSznstarted,
            handleOpenSznended
        } = useContext(executionContext);
    const { roomID } = useContext(gameContext);
    const [selectedOpenSeasonPlayer, setSelectedOpenSeasonPlayer] = useState('');
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    const handleChange = (event) => {
        setSelectedOpenSeasonPlayer(event.target.value);
    };

    const handleClick = async () => {
        if (!selectedOpenSeasonPlayer) {
            toast({
                title: "No player selected.",
                description: "Please select a player to open season.",
                status: "warning",
                duration: 5000,
                isClosable: true,
            });
            return;
        }

        setLoading(true);

        try {
            handleOpenSzn(selectedOpenSeasonPlayer);
            const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
            const sznQuery = query(playerCollectionRef, where('name', '==', selectedOpenSeasonPlayer));
            const sznSnapshot = await getDocs(sznQuery);

            if (!sznSnapshot.empty) {
                const sznRef = sznSnapshot.docs[0].ref;
                await updateDoc(sznRef, { openSeason: true }); 
                toast({
                    title: "Open season set.",
                    description: `${selectedOpenSeasonPlayer} is now open season.`,
                    status: "success",
                    duration: 5000,
                    isClosable: true,
                });
                if (sznSnapshot.docs[0].get('openSeason') === false) {
                    handleOpenSznstarted(selectedOpenSeasonPlayer);
                }
            } else {
                toast({
                    title: "Player not found.",
                    description: "The selected player could not be found.",
                    status: "error",
                    duration: 5000,
                    isClosable: true,
                });
            }
        } catch (error) {
            toast({
                title: "An error occurred.",
                description: "Unable to set open season.",
                status: "error",
                duration: 5000,
                isClosable: true,
            });
            console.error('Error fetching player documents:', error);
        } finally {
            setLoading(false);
        }
    };

    const endOpenSzn = async () => {
        try {
            const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
            const sznQuery = query(playerCollectionRef, where('name', '==', selectedOpenSeasonPlayer));
            const sznSnapshot = await getDocs(sznQuery);

            // const openSeasonPlayers = openSeasonSnapshot.docs.map(doc => doc.data().name); // All the open season players

            if (!sznSnapshot.empty) {
                const sznRef = sznSnapshot.docs[0].ref;
                await updateDoc(sznRef, { openSeason: false }); // sets player as open season in the database
                toast({
                    title: "Open season ended.",
                    description: `${selectedOpenSeasonPlayer} is no longer open season.`,
                    status: "success",
                    duration: 5000,
                    isClosable: true,
                });
                if (sznSnapshot.docs[0].get('openSeason') === true) {
                    handleOpenSznended(selectedOpenSeasonPlayer);
                }
            } else {
                toast({
                    title: "Player not found.",
                    description: "The selected player could not be found.",
                    status: "error",
                    duration: 5000,
                    isClosable: true,
                });
            }
           
        } catch (error) {
          console.log('Error fetching player documents:', error);
        }
    }
    return (
        <Flex>
            <HStack>
                <Select
                    id='assassin'
                    placeholder='Player Name'
                    value={selectedOpenSeasonPlayer}
                    onChange={handleChange}
                >
                    {arrayOfAlivePlayers.map((player, index) => (
                        <option key={index} value={player}>
                            {player}
                        </option>
                    ))}
                </Select>
                <Image
                    src={opensznimg}
                    alt="Open Season"
                    onClick={handleClick}
                    style={{ cursor: 'pointer', marginLeft: '1rem', width: '50px', height: '50px' }}
                />
                <Button
                    variant="solid"
                    colorScheme="red"
                    onClick={endOpenSzn}
                    style={{ cursor: 'pointer', marginLeft: '1rem', width: '200px', height: '45px' }}
                    size='lg'
                >
                    End Season
                </Button>
                {loading && <Spinner />}
            </HStack>
        </Flex>
    );
};

export default OpenSeason;
