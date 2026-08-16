import { Box, Heading, Image } from '@chakra-ui/react';
import { useContext, useEffect, useState } from 'react';
import { gameContext } from '../Contexts';
import {
    approvePhotoForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    updatePhotoStatusForRoom,
} from '../firebase_calls/dbCalls';
import { onSnapshot } from 'firebase/firestore';
import { splitPhotosByStatus } from '../../game/photoJudgments';
import { executeKill } from '../executeKill';
import { undoKill } from '../undoKill';
import confirm from '../../assets/enter-green.png';
import deny from '../../assets/red-x.png';
import undo from '../../assets/arrow-left.png';
import GamePhotos from './GamePhotos';
import { executionContext } from '../Contexts';
import CreateAlert from '../CreateAlert';

const PhotosDisplay = () => {
    const [unjudgedPhotos, setUnjudgedPhotos] = useState([]);
    const [judgedPhotos, setJudgedPhotos] = useState([]);
    const { roomID } = useContext(gameContext);
    const {
        addLog,
        handleRemapping,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleSetShowMessageToTrue,
    } = useContext(executionContext);
    const createAlert = CreateAlert();

    // Both lists are derived from Firestore on every snapshot, not
    // accumulated locally (docs/improvements.md item 6) — judgedPhotos used
    // to live only in React state, built up as the GM clicked through a
    // session, so reloading the console lost every prior judgment (and the
    // originalPlayerData an undo needs) even though the photo documents
    // were already approved/denied in Firestore. splitPhotosByStatus is the
    // pure, unit-tested piece of this (src/game/photoJudgments.js).
    useEffect(() => {
        const photosQuery = fetchPhotosQueryByAscendingTimestampForRoom(roomID);
        const unsubscribe = onSnapshot(
            photosQuery,
            (snapshot) => {
                const allPhotos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                const { unjudged, judged } = splitPhotosByStatus(allPhotos);
                setUnjudgedPhotos(unjudged);
                setJudgedPhotos(judged);
            },
            (error) => {
                console.error('Error fetching photos: ', error);
            }
        );

        return () => unsubscribe();
    }, [roomID]);

    // Approving a photo used to kill the target unconditionally — no check
    // that the assassin was actually hunting them, and no remap of the
    // target's own assassins/targets onto new ones (docs/improvements.md
    // item 5). executeKill now runs the validate/transfer-points/kill/
    // unmap/remap sequence atomically server-side (item 4) — the same
    // Cloud Function /kill (ChatInput.js) calls, so the two paths can't
    // diverge; its preKillSnapshot is exactly the map of every touched
    // player's pre-kill data that undoKillPlayer needs to fully reverse a
    // kill (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
    const handlePass = async () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto] = unjudgedPhotos;

        try {
            const { preKillSnapshot, addedTargets, addedAssassins, remapLogs } = await executeKill(
                currentPhoto.target,
                currentPhoto.assassin,
                roomID
            );

            // Persists preKillSnapshot onto the photo doc so undo survives a
            // reload (docs/improvements.md item 6) — the onSnapshot listener
            // above picks up the resulting status change and recomputes
            // judgedPhotos, so no local state update is needed here.
            await approvePhotoForRoom(roomID, currentPhoto.id, preKillSnapshot);
            await addLog(
                `${currentPhoto.target} was killed by ${currentPhoto.assassin}`,
                'red.400'
            );

            for (const log of remapLogs) {
                await handleRemapping(log);
            }
            handleAddNewAssassins(addedAssassins);
            handleAddNewTargets(addedTargets);
            handleSetShowMessageToTrue();
        } catch (error) {
            console.error('Error approving photo: ', error);
            createAlert('error', 'Error approving photo', error.message, 1500);
        }
    };

    const handleDeny = async () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto] = unjudgedPhotos;

        try {
            await updatePhotoStatusForRoom(roomID, currentPhoto.id, 'denied');
            await addLog(
                `${currentPhoto.assassin}'s attempt to kill ${currentPhoto.target} was denied`,
                'gray'
            );
        } catch (error) {
            console.error('Error denying photo: ', error);
            createAlert('error', 'Error denying photo', error.message, 1500);
        }
    };

    // For an approved kill, the full reversal (every player killPlayer.js's
    // transaction touched, not just the target) now happens atomically
    // inside undoKillPlayer, which also resets the photo's status back to
    // pending as part of the same transaction — so this function no longer
    // needs to know anything about individual player fields, and no longer
    // calls updatePhotoStatusForRoom for that path
    // (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md). A
    // denied judgment never touched player data, so undoing one is still
    // just a status reset here.
    const handleUndo = async () => {
        if (judgedPhotos.length === 0) return;

        const last = judgedPhotos[judgedPhotos.length - 1];
        const { photo, action } = last;

        try {
            if (action === 'pass') {
                await undoKill(roomID, photo.id);
                await addLog(
                    `Undo: ${photo.target}'s death by ${photo.assassin} was reverted`,
                    'blue.200'
                );
            }

            if (action === 'deny') {
                await updatePhotoStatusForRoom(roomID, photo.id, 'pending');
                await addLog(
                    `Undo: denial of ${photo.assassin}'s claim on ${photo.target} was reverted.`,
                    'blue.200'
                );
            }
            // unjudgedPhotos/judgedPhotos update via the onSnapshot listener
            // once the writes above land — no local update needed.
        } catch (error) {
            console.error('Error undoing photo judgment:', error);
            createAlert('error', 'Error undoing photo judgment', error.message, 1500);
        }
    };

    return (
        <>
            <Box sx={styles.photosContainer}>
                <Heading size="lg" m="4px">
                    Photos
                </Heading>
                <Box sx={styles.photosBox}>
                    <GamePhotos photo={unjudgedPhotos[0]} />
                </Box>
                <Box sx={styles.buttonsBox}>
                    <Image src={deny} alt="Deny" sx={styles.buttonImage} onClick={handleDeny} />
                    <Image src={undo} alt="Undo" sx={styles.buttonImage} onClick={handleUndo} />
                    <Image
                        src={confirm}
                        alt="Approve"
                        sx={styles.buttonImage}
                        onClick={handlePass}
                    />
                </Box>
            </Box>
        </>
    );
};

const styles = {
    photosContainer: {
        h: '100%',
        w: '100%',
        borderWidth: 2,
        borderRadius: '3xl',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    photosBox: {
        w: '94%',
        h: '75%',
        textAlign: 'center',
        flexGrow: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginX: '2px',
        borderWidth: 1,
    },
    buttonsBox: {
        display: 'flex',
        flexDirection: 'row',
        w: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonImage: {
        w: '10%',
        m: '4px',
        marginX: '30px',
        transition: 'opacity 0.3s',
        '&:hover': {
            opacity: 0.7,
        },
    },
};
export default PhotosDisplay;
