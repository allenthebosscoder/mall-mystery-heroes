/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Pins a real bug found in final review (kill-photo-submission): at the
 * time, every other test stubbed either MessageComposer or KillPhotoModal,
 * so nothing exercised the actual seam between them — specifically, that
 * KillPhotoModal's target selection must stay correct when its `targets`
 * prop arrives asynchronously after mount (exactly what happens in
 * PlayerGame.js, which renders MessageComposer before playerData has
 * loaded). This test renders both components for real, replaying that
 * exact sequence.
 *
 * MessageComposer.test.jsx also renders the real KillPhotoModal now (since
 * the 2026-08-15 one-tap-kill-photo-capture redesign made KillPhotoModal
 * presentational, with no Firebase imports of its own left to stub), so
 * this file is no longer the only place both render un-stubbed together.
 * What's still unique here is the async-arrival rerender sequence itself
 * — mounting with `targets={[]}` and then re-rendering with
 * `targets={['Bob']}` — which MessageComposer.test.jsx does not cover.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from '../components/player_messages_components/MessageComposer';
import { compressImage } from '../utils/compressImage';
import { uploadKillPhoto } from '../components/firebase_calls/storageCalls';
import { addPhotoForRoom } from '../components/firebase_calls/dbCalls';

jest.mock('../utils/compressImage', () => ({
    compressImage: jest.fn(),
}));
jest.mock('../components/firebase_calls/storageCalls', () => ({
    uploadKillPhoto: jest.fn(),
}));
jest.mock('../components/firebase_calls/dbCalls', () => ({
    addChatMessageForRoom: jest.fn(),
    addPhotoForRoom: jest.fn(),
}));

const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });
const fakeFile = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

beforeEach(() => {
    jest.clearAllMocks();
    global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview');
    global.URL.revokeObjectURL = jest.fn();
    compressImage.mockResolvedValue(fakeBlob);
    uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    addPhotoForRoom.mockResolvedValue(undefined);
});

describe('MessageComposer + KillPhotoModal, targets arriving after mount', () => {
    it('submits the real target once it loads, not the empty initial value', async () => {
        const { rerender } = render(
            <ChakraProvider>
                <MessageComposer roomID="room-a" playerName="Alice" targets={[]} />
            </ChakraProvider>
        );

        // Simulates PlayerGame.js's player-doc subscription delivering
        // real targets after the initial empty-state render.
        rerender(
            <ChakraProvider>
                <MessageComposer roomID="room-a" playerName="Alice" targets={['Bob']} />
            </ChakraProvider>
        );

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() => expect(addPhotoForRoom).toHaveBeenCalled());
        expect(addPhotoForRoom).toHaveBeenCalledWith(
            'room-a',
            'Alice',
            'Bob',
            'https://example.com/photo.jpg'
        );
    });
});
