/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer sends player-authored group-chat messages and opens the
 * kill-photo submission modal
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
 * docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
 *
 * KillPhotoModal has its own thorough test file (KillPhotoModal.test.jsx)
 * — stubbed here so this file stays focused on MessageComposer's own
 * wiring logic (the photo button's enable/disable condition, and that it
 * opens the modal with the right props), same reasoning
 * GameMasterView.test.jsx stubs ChatInput.
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
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from './MessageComposer';
import { addChatMessageForRoom } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addChatMessageForRoom: jest.fn(),
}));
jest.mock('./KillPhotoModal', () => (props) => (
    <div>{`kill-photo-modal-stub isOpen=${props.isOpen} roomID=${props.roomID} playerName=${props.playerName} targets=${JSON.stringify(props.targets)}`}</div>
));

const mountComposer = (playerName = 'Alice', targets = ['bob']) =>
    render(
        <ChakraProvider>
            <MessageComposer roomID="room-a" playerName={playerName} targets={targets} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    addChatMessageForRoom.mockResolvedValue(undefined);
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

    it('opens KillPhotoModal with the right props when the photo button is clicked', async () => {
        mountComposer('Alice', ['bob']);

        expect(
            screen.getByText(
                'kill-photo-modal-stub isOpen=false roomID=room-a playerName=Alice targets=["bob"]'
            )
        ).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));

        expect(
            screen.getByText(
                'kill-photo-modal-stub isOpen=true roomID=room-a playerName=Alice targets=["bob"]'
            )
        ).toBeInTheDocument();
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
});
