import React, { useEffect } from 'react';
import { Button, Stack, Image, Flex } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/mall-logo-white-2.png';
import { readPlayerSession } from '../utils/playerSession';
import { auth } from '../utils/firebase';

const Homepage = () => {
    const navigate = useNavigate();

    // Only redirect when there's an actual signed-in Firebase user backing
    // the stored session, not just a localStorage entry — RequireAuth (which
    // guards /rooms/:roomID/waiting) redirects back here whenever there's no
    // signed-in Firebase user, and a stale localStorage session with no
    // matching auth.currentUser (anonymous account deleted, IndexedDB
    // cleared but localStorage wasn't, a token refresh failed) would
    // otherwise bounce the visitor between here and there forever.
    // auth.currentUser may briefly be null while Firebase Auth's async
    // initialization is still resolving on a fresh page load — an
    // acceptable tradeoff: worst case, a returning player very briefly sees
    // the Host/Join buttons before Firebase Auth resolves, which is far
    // better than an infinite redirect loop.
    useEffect(() => {
        const session = readPlayerSession();
        if (session && auth.currentUser) {
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
