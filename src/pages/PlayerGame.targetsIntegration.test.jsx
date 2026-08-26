/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Originally pinned a real bug found in final review (kill-photo-submission):
 * KillPhotoModal's target picker held stale selection state when its
 * `targets` prop arrived asynchronously after mount (exactly what happens
 * in PlayerGame.js, which renders MessageComposer before playerData has
 * loaded). The picker no longer exists — a player no longer names who they
 * killed, a moderator resolves it later in PhotosDisplay.js — so that
 * specific bug class can't recur. What's still real and worth protecting:
 * MessageComposer's photo button is disabled while `targets` is empty
 * (`disabled || targets.length === 0`), and must correctly become enabled
 * once a late-arriving `targets` prop lands, the same async-arrival timing
 * that caused the original bug.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from '../components/player_messages_components/MessageComposer';
import { compressImage } from '../utils/compressImage';
import { uploadKillPhoto } from '../components/firebase_calls/storageCalls';
import { submitKillPhoto } from '../components/submitKillPhoto';

jest.mock('../utils/compressImage', () => ({
    compressImage: jest.fn(),
}));
jest.mock('../components/firebase_calls/storageCalls', () => ({
    uploadKillPhoto: jest.fn(),
}));
jest.mock('../components/submitKillPhoto', () => ({
    submitKillPhoto: jest.fn(),
}));
// MessageComposer also imports submitChatMessage.js, which touches
// utils/firebase.js (and, transitively, firebase/functions) at module load
// time — not exercised by this file's target-arrival scenario, but it must
// still be mocked so importing MessageComposer doesn't pull in a real
// Firebase SDK call under jsdom, matching MessageComposer.test.jsx's own
// mock set.
jest.mock('../components/submitChatMessage', () => ({
    submitChatMessage: jest.fn(),
}));

const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });
const fakeFile = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

beforeEach(() => {
    jest.clearAllMocks();
    global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview');
    global.URL.revokeObjectURL = jest.fn();
    compressImage.mockResolvedValue(fakeBlob);
    uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    submitKillPhoto.mockResolvedValue(undefined);
});

describe('MessageComposer + KillPhotoModal, targets arriving after mount', () => {
    it('enables the photo button once targets load, and submits with no target named', async () => {
        const { rerender } = render(
            <ChakraProvider>
                <MessageComposer roomID="room-a" playerName="Alice" targets={[]} />
            </ChakraProvider>
        );

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();

        // Simulates PlayerGame.js's player-doc subscription delivering
        // real targets after the initial empty-state render.
        rerender(
            <ChakraProvider>
                <MessageComposer roomID="room-a" playerName="Alice" targets={['Bob']} />
            </ChakraProvider>
        );

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeEnabled();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() => expect(submitKillPhoto).toHaveBeenCalled());
        expect(submitKillPhoto).toHaveBeenCalledWith({
            roomId: 'room-a',
            url: 'https://example.com/photo.jpg',
        });
    });
});
