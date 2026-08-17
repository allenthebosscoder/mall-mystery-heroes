/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer sends player-authored group-chat messages and now also
 * owns capturing, compressing, and submitting a kill-photo claim — the
 * camera button triggers a hidden file input directly, and KillPhotoModal
 * (rendered for real here, not stubbed — it has no Firebase imports of
 * its own since the 2026-08-15 one-tap-kill-photo-capture redesign) only
 * appears once a photo has been captured
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
 * docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md,
 * docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
 *
 * Explicit mock factory for dbCalls.js, not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 *
 * Interactions that trigger `handleSend` (async — it `await`s
 * `addChatMessageForRoom`) are followed by a `waitFor` on their resulting
 * assertion, not a manual `act(async () => { ... })` wrapper around the
 * `userEvent` call: `userEvent`'s methods already wrap themselves in `act`
 * internally, and wrapping them again is the exact anti-pattern
 * `testing-library/no-unnecessary-act` exists to flag.
 *
 * This file's `userEvent.type` calls do still print "not wrapped in
 * act(...)" warnings during typing — investigated (final review,
 * chat-send-and-efficiency, fix round 2) and found to be a pre-existing,
 * repo-wide characteristic of `@testing-library/user-event@13.5.0`
 * (package.json) under React 18, not something this file's tests trigger
 * uniquely or incorrectly: `ChatInput.test.jsx`, untouched by this
 * feature, prints over a thousand of the identical warning from its own
 * `userEvent.type` calls. Manually re-wrapping `userEvent` in `act()`
 * silences the symptom but is the anti-pattern the lint rule above exists
 * to catch, and isn't this codebase's existing convention (ChatInput
 * doesn't do it either) — fixing the root cause would mean upgrading
 * `@testing-library/user-event` to v14 across the whole suite, out of
 * scope for this feature. Tests here still pass deterministically.
 *
 * jsdom's simulated file-input `change` events do not reproduce a real
 * browser's refusal to re-fire `change` for an identical file, whether
 * driven via `userEvent.upload` or `fireEvent.change` (confirmed by
 * direct experiment while planning this feature) — so the reset test
 * below asserts the input's `.value` directly rather than asserting a
 * second `change` event fires.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from './MessageComposer';
import { addChatMessageForRoom, addPhotoForRoom } from '../firebase_calls/dbCalls';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addChatMessageForRoom: jest.fn(),
    addPhotoForRoom: jest.fn(),
}));
jest.mock('../../utils/compressImage', () => ({
    compressImage: jest.fn(),
}));
jest.mock('../firebase_calls/storageCalls', () => ({
    uploadKillPhoto: jest.fn(),
}));

const mountComposer = (playerName = 'Alice', targets = ['bob']) =>
    render(
        <ChakraProvider>
            <MessageComposer roomID="room-a" playerName={playerName} targets={targets} />
        </ChakraProvider>
    );

const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });
const fakeFile = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });
const fakeFile2 = new File(['fake2'], 'photo2.jpg', { type: 'image/jpeg' });

beforeEach(() => {
    jest.clearAllMocks();
    addChatMessageForRoom.mockResolvedValue(undefined);
    global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview');
    global.URL.revokeObjectURL = jest.fn();
    compressImage.mockResolvedValue(fakeBlob);
    uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    addPhotoForRoom.mockResolvedValue(undefined);
});

describe('MessageComposer', () => {
    it('renders an enabled message input and Send button', () => {
        mountComposer();

        expect(screen.getByPlaceholderText('Type a message...')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('enables the photo button when playerName and targets are both set', () => {
        mountComposer('Alice', ['bob']);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeEnabled();
    });

    it('disables the photo button when targets is empty, even if playerName is set', () => {
        mountComposer('Alice', []);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });

    it('disables the photo button when playerName is empty, even if targets is set', () => {
        mountComposer('', ['bob']);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });

    it('sends the typed message when Send is clicked', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hey where are you');
        await userEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() =>
            expect(addChatMessageForRoom).toHaveBeenCalledWith(
                'hey where are you',
                'Alice',
                'room-a'
            )
        );
    });

    it('sends the typed message when Enter is pressed', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi{Enter}');

        await waitFor(() =>
            expect(addChatMessageForRoom).toHaveBeenCalledWith('hi', 'Alice', 'room-a')
        );
    });

    it('does not send on Shift+Enter, so a future multiline input could still get a newline', async () => {
        mountComposer();

        await userEvent.type(
            screen.getByPlaceholderText('Type a message...'),
            'hi{Shift>}{Enter}{/Shift}'
        );

        expect(addChatMessageForRoom).not.toHaveBeenCalled();
    });

    it('clears the input after sending', async () => {
        mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await userEvent.type(input, 'hi{Enter}');

        await waitFor(() => expect(addChatMessageForRoom).toHaveBeenCalled());
        expect(input).toHaveValue('');
    });

    it('does not send a blank or whitespace-only message', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), '   {Enter}');

        expect(addChatMessageForRoom).not.toHaveBeenCalled();
    });

    it('restores the typed text if the send fails, instead of losing it', async () => {
        addChatMessageForRoom.mockRejectedValue(new Error('network error'));
        mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await userEvent.type(input, 'hi{Enter}');

        await waitFor(() => expect(input).toHaveValue('hi'));
    });

    it('disables the input and Send button when playerName is empty', () => {
        mountComposer('');

        expect(screen.getByPlaceholderText('Type a message...')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('selecting a photo compresses it and opens the modal with the preview', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        await waitFor(() => expect(compressImage).toHaveBeenCalledWith(fakeFile));
        expect(await screen.findByAltText('Kill photo preview')).toHaveAttribute(
            'src',
            'blob:fake-preview'
        );
    });

    it('opens the modal with an error, not a preview, when compression fails', async () => {
        compressImage.mockRejectedValue(new Error('bad file'));
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        expect(
            await screen.findByText('Could not read that photo. Try taking it again.')
        ).toBeInTheDocument();
        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();
    });

    it('calls compressImage, uploadKillPhoto, then addPhotoForRoom in order, then closes the modal', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
        );
        expect(uploadKillPhoto).toHaveBeenCalledWith('room-a', fakeBlob);
        expect(addPhotoForRoom).toHaveBeenCalledWith(
            'room-a',
            'Alice',
            'bob',
            'https://example.com/photo.jpg'
        );
        // The order genuinely matters: the photo must be uploaded (so
        // `url` is valid) before the Firestore doc referencing that url
        // is written.
        expect(compressImage.mock.invocationCallOrder[0]).toBeLessThan(
            uploadKillPhoto.mock.invocationCallOrder[0]
        );
        expect(uploadKillPhoto.mock.invocationCallOrder[0]).toBeLessThan(
            addPhotoForRoom.mock.invocationCallOrder[0]
        );
    });

    it('keeps the modal open and shows an error when the upload fails, with Submit still clickable', async () => {
        uploadKillPhoto.mockRejectedValue(new Error('network error'));
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(
            await screen.findByText(
                'Could not submit the photo. Check your connection and try again.'
            )
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });

    it('resets the file input value after each selection, so the same photo can be selected again', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        const fileInput = screen.getByLabelText('Take Photo');
        await userEvent.upload(fileInput, fakeFile);

        await waitFor(() => expect(compressImage).toHaveBeenCalled());
        expect(fileInput.value).toBe('');
    });

    it('clicking the photo button clicks the hidden file input', async () => {
        const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));

        expect(clickSpy).toHaveBeenCalled();
        clickSpy.mockRestore();
    });

    // The photo button's own isDisabled guard (disabled || targets.length
    // === 0) has no effect on the hidden file input it drives unless the
    // native input carries the same guard: VisuallyHidden keeps the input
    // focusable and in the tab order by design, so a keyboard/screen-reader
    // user (or anything driving the DOM directly) can otherwise reach it and
    // run the whole capture flow even when the button is disabled.
    it('does not let a file selection through the hidden input when targets is empty', async () => {
        mountComposer('Alice', []);

        const fileInput = screen.getByLabelText('Take Photo');
        await userEvent.upload(fileInput, fakeFile);

        expect(compressImage).not.toHaveBeenCalled();
    });

    it('does not let a file selection through the hidden input when playerName is empty', async () => {
        mountComposer('', ['bob']);

        const fileInput = screen.getByLabelText('Take Photo');
        await userEvent.upload(fileInput, fakeFile);

        expect(compressImage).not.toHaveBeenCalled();
    });

    it('shows a processing indicator immediately after capture, before compression resolves', async () => {
        let resolveCompress;
        compressImage.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveCompress = resolve;
                })
        );
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        expect(await screen.findByText('Processing photo…')).toBeInTheDocument();
        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();

        resolveCompress(fakeBlob);

        expect(await screen.findByAltText('Kill photo preview')).toHaveAttribute(
            'src',
            'blob:fake-preview'
        );
        expect(screen.queryByText('Processing photo…')).not.toBeInTheDocument();
    });

    it('revokes the preview URL on unmount', async () => {
        const { unmount } = mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await screen.findByAltText('Kill photo preview');

        unmount();

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-preview');
    });

    it('revokes the previous preview URL when a second capture fails to compress', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await screen.findByAltText('Kill photo preview');
        URL.revokeObjectURL.mockClear();

        compressImage.mockRejectedValueOnce(new Error('bad file'));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile2);

        await screen.findByText('Could not read that photo. Try taking it again.');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-preview');
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    });

    it('limits the chat message input to 500 characters', () => {
        mountComposer();

        expect(screen.getByPlaceholderText('Type a message...')).toHaveAttribute(
            'maxlength',
            '500'
        );
    });
});
