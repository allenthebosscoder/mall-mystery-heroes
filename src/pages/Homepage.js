import React, { useEffect } from 'react';
import { Button, Stack, Image, Flex } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import logo from '../assets/mall-logo-white-2.png';
import { readPlayerSession } from '../utils/playerSession';
import { auth } from '../utils/firebase';

const Homepage = () => {
    const navigate = useNavigate();

    // Only redirect when there's an actual signed-in Firebase user backing
    // the stored session, not just a localStorage entry — RequireAuth (which
    // guards /rooms/:roomID/waiting) redirects back here whenever there's no
    // signed-in Firebase user, and a stale localStorage session with no
    // matching signed-in user (anonymous account deleted, IndexedDB cleared
    // but localStorage wasn't, a token refresh failed) would otherwise
    // bounce the visitor between here and there forever.
    // Firebase Auth restores a previously-signed-in user from IndexedDB
    // asynchronously on page load, so a one-time synchronous read of
    // auth.currentUser here would almost always see `null` even for a
    // genuinely still-signed-in returning player. Subscribe via
    // onAuthStateChanged instead — the same pattern RequireAuth uses to
    // solve this same async-initialization problem — so the redirect fires
    // once the real auth state is known. If it resolves to no user, just
    // let the Host Game / Join Game buttons render; unlike RequireAuth this
    // page has a legitimate "nothing to show yet" state that IS the
    // buttons, so no loading spinner is needed here.
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            const session = readPlayerSession();
            if (session && user) {
                navigate(`/rooms/${session.roomID}/waiting`, { replace: true });
            }
        });
        return unsubscribe;
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
