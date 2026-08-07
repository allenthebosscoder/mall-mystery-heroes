import React, { useEffect } from 'react';
import { Button, Stack, Image, Flex } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/mall-logo-white-2.png';
import { readPlayerSession } from '../utils/playerSession';

const Homepage = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const session = readPlayerSession();
        if (session) {
            navigate(`/rooms/${session.roomID}/waiting`, { replace: true });
        }
    }, [navigate]);

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center" direction="column" p={4}>
            <Image src={logo} maxWidth="250px" maxHeight="250px" alt="logo white" mb={8} />
            <Stack direction="column" spacing={4} width="100%" maxWidth="320px">
                <Button colorScheme="teal" variant="solid" onClick={() => navigate('/host')}>
                    Host Game
                </Button>
                <Button colorScheme="teal" variant="outline" onClick={() => navigate('/join')}>
                    Join Game
                </Button>
            </Stack>
        </Flex>
    );
};

export default Homepage;
