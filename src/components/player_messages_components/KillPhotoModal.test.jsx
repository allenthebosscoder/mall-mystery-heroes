/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Explicit mock factories for compressImage, uploadKillPhoto, and
 * addPhotoForRoom — not auto-mocked, matching this codebase's established
 * convention for dbCalls.js/firebase-adjacent modules (see
 * ChatInput.test.jsx for the underlying reasoning).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KillPhotoModal from './KillPhotoModal';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';
import { addPhotoForRoom } from '../firebase_calls/dbCalls';

jest.mock('../../utils/compressImage', () => ({
    compressImage: jest.fn(),
}));
jest.mock('../firebase_calls/storageCalls', () => ({
    uploadKillPhoto: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    addPhotoForRoom: jest.fn(),
}));

const onClose = jest.fn();

const mountModal = (targets = ['bob']) =>
    render(
        <ChakraProvider>
            <KillPhotoModal
                isOpen
                onClose={onClose}
                roomID="room-a"
                playerName="alice"
                targets={targets}
            />
        </ChakraProvider>
    );

const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });
const fakeFile = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

beforeEach(() => {
    jest.clearAllMocks();
    global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview');
    compressImage.mockResolvedValue(fakeBlob);
    uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    addPhotoForRoom.mockResolvedValue(undefined);
});

describe('KillPhotoModal', () => {
    it('auto-selects the only target and shows no picker when there is exactly one', () => {
        mountModal(['bob']);

        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('shows a picker when there is more than one target', () => {
        mountModal(['bob', 'carol']);

        expect(screen.getByRole('radio', { name: 'bob' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'carol' })).toBeInTheDocument();
    });

    it('calls compressImage, uploadKillPhoto, then addPhotoForRoom in order, then closes', async () => {
        mountModal(['bob']);

        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(uploadKillPhoto).toHaveBeenCalledWith('room-a', fakeBlob);
        expect(addPhotoForRoom).toHaveBeenCalledWith(
            'room-a',
            'alice',
            'bob',
            'https://example.com/photo.jpg'
        );
        // The order genuinely matters: the photo must be uploaded (so `url`
        // is valid) before the Firestore doc referencing that url is
        // written.
        expect(compressImage.mock.invocationCallOrder[0]).toBeLessThan(
            uploadKillPhoto.mock.invocationCallOrder[0]
        );
        expect(uploadKillPhoto.mock.invocationCallOrder[0]).toBeLessThan(
            addPhotoForRoom.mock.invocationCallOrder[0]
        );
    });

    it('keeps the modal open and shows an error when the upload fails, with Submit still clickable', async () => {
        uploadKillPhoto.mockRejectedValue(new Error('network error'));
        mountModal(['bob']);

        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(
            await screen.findByText(
                'Could not submit the photo. Check your connection and try again.'
            )
        ).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });
});
