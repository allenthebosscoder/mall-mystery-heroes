import { Box, Heading, Image } from '@chakra-ui/react';
import { useContext, useEffect, useState } from 'react';
import { gameContext } from '../Contexts';
import {
    addPlayerMessageForRoom,
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
    // Photo IDs the GM has clicked Approve/Deny on but Firestore hasn't
    // confirmed yet — executeKill/updatePhotoStatusForRoom can take
    // several real seconds against a cold Cloud Function, and this app
    // never displays a "judged" history list to reconcile against (only
    // the current unjudged photo), so suppressing these IDs from
    // unjudgedPhotos is enough to make the queue advance instantly.
    const [optimisticallyJudgedIds, setOptimisticallyJudgedIds] = useState([]);
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
                // Once Firestore's own data no longer lists a photo as
                // pending, any optimistic suppression of it is redundant —
                // drop it, so this list never grows past what's actually
                // still in flight.
                setOptimisticallyJudgedIds((previous) =>
                    previous.filter((id) => unjudged.some((photo) => photo.id === id))
                );
            },
            (error) => {
                console.error('Error fetching photos: ', error);
            }
        );

        return () => unsubscribe();
    }, [roomID]);

    const visibleUnjudgedPhotos = unjudgedPhotos.filter(
        (photo) => !optimisticallyJudgedIds.includes(photo.id)
    );

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
        if (visibleUnjudgedPhotos.length === 0) return;
        const [currentPhoto] = visibleUnjudgedPhotos;
        // Suppress this photo from the queue immediately — executeKill can
        // take several real seconds against a cold Cloud Function, and
        // there's no reason to make the GM stare at the same photo while
        // it runs. Rolled back in the catch block if it ultimately fails.
        setOptimisticallyJudgedIds((previous) => [...previous, currentPhoto.id]);

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
            await addPlayerMessageForRoom(
                {
                    type: 'killResult',
                    recipient: null,
                    text: `${currentPhoto.target} was killed by ${currentPhoto.assassin}`,
                    standings: null,
                    mission: null,
                    sender: null,
                    assassin: currentPhoto.assassin,
                    target: currentPhoto.target,
                    outcome: 'approved',
                },
                roomID
            );

            for (const log of remapLogs) {
                await handleRemapping(log);
            }
            handleAddNewAssassins(addedAssassins);
            handleAddNewTargets(addedTargets);
            handleSetShowMessageToTrue();
        } catch (error) {
            console.error('Error approving photo: ', error);
            setOptimisticallyJudgedIds((previous) =>
                previous.filter((id) => id !== currentPhoto.id)
            );
            createAlert('error', 'Error approving photo', error.message, 1500);
        }
    };

    const handleDeny = async () => {
        if (visibleUnjudgedPhotos.length === 0) return;
        const [currentPhoto] = visibleUnjudgedPhotos;
        setOptimisticallyJudgedIds((previous) => [...previous, currentPhoto.id]);

        try {
            await updatePhotoStatusForRoom(roomID, currentPhoto.id, 'denied');
            await addLog(
                `${currentPhoto.assassin}'s attempt to kill ${currentPhoto.target} was denied`,
                'gray'
            );
            await addPlayerMessageForRoom(
                {
                    type: 'killResult',
                    recipient: null,
                    text: `${currentPhoto.assassin}'s attempt to kill ${currentPhoto.target} was denied`,
                    standings: null,
                    mission: null,
                    sender: null,
                    assassin: currentPhoto.assassin,
                    target: currentPhoto.target,
                    outcome: 'denied',
                },
                roomID
            );
        } catch (error) {
            console.error('Error denying photo: ', error);
            setOptimisticallyJudgedIds((previous) =>
                previous.filter((id) => id !== currentPhoto.id)
            );
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
                await addPlayerMessageForRoom(
                    {
                        type: 'killResult',
                        recipient: null,
                        text: `Undo: ${photo.target}'s death by ${photo.assassin} was reverted`,
                        standings: null,
                        mission: null,
                        sender: null,
                        assassin: photo.assassin,
                        target: photo.target,
                        outcome: 'undoneApproval',
                    },
                    roomID
                );
            }

            if (action === 'deny') {
                await updatePhotoStatusForRoom(roomID, photo.id, 'pending');
                await addLog(
                    `Undo: denial of ${photo.assassin}'s claim on ${photo.target} was reverted.`,
                    'blue.200'
                );
                await addPlayerMessageForRoom(
                    {
                        type: 'killResult',
                        recipient: null,
                        text: `Undo: denial of ${photo.assassin}'s claim on ${photo.target} was reverted.`,
                        standings: null,
                        mission: null,
                        sender: null,
                        assassin: photo.assassin,
                        target: photo.target,
                        outcome: 'undoneDenial',
                    },
                    roomID
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
                    {visibleUnjudgedPhotos.length > 0
                        ? ` (${visibleUnjudgedPhotos.length} pending)`
                        : ''}
                </Heading>
                <Box sx={styles.photosBox}>
                    <GamePhotos photo={visibleUnjudgedPhotos[0]} />
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
