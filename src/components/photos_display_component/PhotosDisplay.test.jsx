/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 6 end to end: judgedPhotos is now derived
 * from Firestore on every snapshot (via src/game/photoJudgments.js), not
 * accumulated in local state. This proves the actual bug scenario — undo
 * works for a photo judged in an *earlier* session, reconstructed purely
 * from what onSnapshot reports on mount, never clicked through here.
 *
 * `executeKill` is a thin wrapper around a Cloud Function call now
 * (docs/improvements.md item 4) — validation, scoring, unmapping, and
 * remapping all happen server-side, so this mocks `executeKill` itself
 * rather than the individual Firestore calls it used to make.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onSnapshot } from 'firebase/firestore';
import PhotosDisplay from './PhotosDisplay';
import { gameContext, executionContext } from '../Contexts';
import * as dbCalls from '../firebase_calls/dbCalls';
import { executeKill } from '../executeKill';
import { undoKill } from '../undoKill';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

// Explicit factory, not auto-mock — see ChatInput.test.jsx for why.
jest.mock('../firebase_calls/dbCalls', () => ({
    approvePhotoForRoom: jest.fn(),
    fetchPhotosQueryByAscendingTimestampForRoom: jest.fn(() => 'photos-query'),
    updatePhotoStatusForRoom: jest.fn(),
}));
jest.mock('../executeKill', () => ({ executeKill: jest.fn() }));
jest.mock('../undoKill', () => ({ undoKill: jest.fn() }));

const executionHandlers = {
    addLog: jest.fn(),
    handleRemapping: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
};

/** Simulates the given photo docs as what onSnapshot reports immediately on mount. */
const mountWithSnapshot = (photoDocs) => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: photoDocs.map((data, i) => ({ id: `photo-${i}`, data: () => data })),
        });
        return () => {};
    });

    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <executionContext.Provider value={executionHandlers}>
                    <PhotosDisplay />
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );
};

beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.updatePhotoStatusForRoom.mockResolvedValue(undefined);
    undoKill.mockResolvedValue(undefined);
    executeKill.mockResolvedValue({
        targetWasOpenSzn: false,
        preKillSnapshot: {
            alice: { score: 0, targets: [], assassins: [], isAlive: true, openSeason: false },
        },
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
});

describe('reconstructing judged photos from Firestore (improvements item 6)', () => {
    it('can undo a photo approved in an earlier session, using its persisted snapshot', async () => {
        // Nothing was clicked in this render — this photo's approval and its
        // originalPlayerData snapshot both come purely from what Firestore
        // reports, simulating a reload after the approval happened earlier.
        mountWithSnapshot([
            {
                status: 'approved',
                target: 'alice',
                assassin: 'bob',
                originalPlayerData: {
                    alice: { score: 7, targets: ['carol'], assassins: ['dave'], isAlive: true },
                },
            },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        // The reversal (score/targets/assassins/isAlive, for every player
        // killPlayer.js's transaction touched) now happens entirely inside
        // the atomic undoKillPlayer Cloud Function — the client only needs
        // to trigger it and log the result
        // (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
        await waitFor(() => expect(undoKill).toHaveBeenCalledWith('room-a', 'photo-0'));
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            "Undo: alice's death by bob was reverted",
            'blue.200'
        );
        // updatePhotoStatusForRoom is only for the deny-undo path now —
        // undoKillPlayer's own transaction already resets status to
        // 'pending' for an approval-undo.
        expect(dbCalls.updatePhotoStatusForRoom).not.toHaveBeenCalled();
    });

    it('does nothing when there is no judged photo to undo', async () => {
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Undo'));

        expect(undoKill).not.toHaveBeenCalled();
        expect(dbCalls.updatePhotoStatusForRoom).not.toHaveBeenCalled();
    });

    it('reverts a denied judgment by resetting status to pending, without calling undoKill', async () => {
        mountWithSnapshot([
            { status: 'denied', target: 'alice', assassin: 'bob', originalPlayerData: null },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        await waitFor(() =>
            expect(dbCalls.updatePhotoStatusForRoom).toHaveBeenCalledWith(
                'room-a',
                'photo-0',
                'pending'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            "Undo: denial of bob's claim on alice was reverted.",
            'blue.200'
        );
        expect(undoKill).not.toHaveBeenCalled();
    });
});

describe('approving a photo persists the undo snapshot (improvements item 6)', () => {
    it('calls executeKill and persists its preKillSnapshot', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: {
                bob: {
                    score: 12,
                    targets: ['x'],
                    assassins: ['y'],
                    isAlive: true,
                    openSeason: false,
                },
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() => expect(executeKill).toHaveBeenCalledWith('alice', 'bob', 'room-a'));
        expect(dbCalls.approvePhotoForRoom).toHaveBeenCalledWith('room-a', 'photo-0', {
            bob: { score: 12, targets: ['x'], assassins: ['y'], isAlive: true, openSeason: false },
        });
    });

    it('passes remapLogs, addedTargets, and addedAssassins through to their handlers', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: { score: 0, targets: [], assassins: [] },
            addedTargets: { bob: ['carol'] },
            addedAssassins: { carol: ['bob'] },
            remapLogs: ['New target for bob: carol'],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(executionHandlers.handleRemapping).toHaveBeenCalledWith(
                'New target for bob: carol'
            )
        );
        expect(executionHandlers.handleAddNewTargets).toHaveBeenCalledWith({ bob: ['carol'] });
        expect(executionHandlers.handleAddNewAssassins).toHaveBeenCalledWith({
            carol: ['bob'],
        });
    });
});

describe('a photo approval executeKill rejects is not applied (improvements item 5)', () => {
    it('leaves the photo pending and shows an alert instead of killing anyway', async () => {
        // The bug this item fixes: photo approval used to kill
        // unconditionally, with no check that the assassin was actually
        // hunting the target.
        executeKill.mockRejectedValue(new Error('alice is not a valid target for bob'));
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        expect(await screen.findByText(/alice is not a valid target for bob/i)).toBeInTheDocument();
        expect(dbCalls.approvePhotoForRoom).not.toHaveBeenCalled();
    });
});
