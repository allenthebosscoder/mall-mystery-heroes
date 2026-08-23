import React, { useEffect } from 'react';
import { Button, Stack, Image, Flex, Heading } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import logo from '../assets/mall-logo-white-2.png';
import { readPlayerSession, writePlayerSession } from '../utils/playerSession';
import { auth, db } from '../utils/firebase';

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
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            const session = readPlayerSession();
            if (session && user) {
                navigate(`/rooms/${session.roomID}/waiting`, { replace: true });
                return;
            }
            if (!session && user) {
                // localStorage's room/name pair is gone (cleared, or never
                // written) but the Firebase Auth session survived — find
                // the room this uid already joined, if any, via a
                // collection-group query scoped to the caller's own uid
                // (firestore.rules' new players list rule), rather than
                // treating a returning player as brand new. Restoring the
                // session (not just navigating) matters: PlayerGame.js
                // reads the player's *name* from readPlayerSession(), so a
                // bare redirect would land on the right room with an
                // empty playerName
                // (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
                // Best-effort: any failure here just falls through to the
                // normal Host/Join buttons, same as "no match" — never an
                // error shown to what might just be a first-time visitor.
                try {
                    const playersQuery = query(
                        collectionGroup(db, 'players'),
                        where('uid', '==', user.uid)
                    );
                    const snapshot = await getDocs(playersQuery);
                    if (!snapshot.empty) {
                        const playerDoc = snapshot.docs[0];
                        const roomID = playerDoc.ref.parent.parent.id;
                        writePlayerSession(roomID, playerDoc.data().name);
                        navigate(`/rooms/${roomID}/waiting`, { replace: true });
                    }
                } catch (error) {
                    console.error('Error recovering player session:', error);
                }
            }
        });
        return unsubscribe;
    }, [navigate]);

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center" direction="column" p={4}>
            <Image src={logo} maxWidth="250px" maxHeight="250px" alt="logo white" mb={4} />
            <Heading mb={8} color="brand.100" textAlign="center">
                Mall Mystery Heroes
            </Heading>
            <Stack direction="row" spacing={4} width="100%" maxWidth="320px">
                <Button
                    colorScheme="teal"
                    variant="solid"
                    flex={1}
                    onClick={() => navigate('/login')}
                >
                    Host Game
                </Button>
                <Button
                    colorScheme="teal"
                    variant="outline"
                    flex={1}
                    onClick={() => navigate('/join')}
                >
                    Join Game
                </Button>
            </Stack>
        </Flex>
    );
};

export default Homepage;
