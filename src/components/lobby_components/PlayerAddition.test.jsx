/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the in-flight submit guard added alongside the addPlayerForRoom
 * transaction fix (docs/improvements.md item 34): a second submit while a
 * request is still pending must not call addPlayerForRoom again. This is
 * defense-in-depth, not the actual fix — see dbCalls.integration.test.js's
 * "does not create two players when two calls race on the same name" for
 * the real regression test, which exercises addPlayerForRoom directly
 * without a UI in the picture.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerAddition from './PlayerAddition';
import { addPlayerForRoom } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addPlayerForRoom: jest.fn(),
}));

const renderPlayerAddition = (props = {}) =>
    render(
        <ChakraProvider>
            <PlayerAddition roomID="room-a" {...props} />
        </ChakraProvider>
    );

beforeEach(() => {
    addPlayerForRoom.mockReset();
});

describe('PlayerAddition', () => {
    it('ignores a second submit while the first is still in flight', async () => {
        let resolveAdd;
        addPlayerForRoom.mockReturnValue(
            new Promise((resolve) => {
                resolveAdd = resolve;
            })
        );

        renderPlayerAddition();
        const input = screen.getByPlaceholderText('Enter Player Name');
        const enterButton = screen.getByAltText('Enter Image');

        userEvent.type(input, '123');
        userEvent.click(enterButton);

        // Wait for the first click's state update to actually land before
        // firing the second — this is what makes the assertion below mean
        // something (without it, both clicks can land in the same React
        // batch and the guard never gets a chance to see isSubmitting=true).
        await waitFor(() => expect(input).toBeDisabled());
        expect(addPlayerForRoom).toHaveBeenCalledTimes(1);

        userEvent.click(enterButton); // the "pressed Enter again while laggy" case
        expect(addPlayerForRoom).toHaveBeenCalledTimes(1);

        resolveAdd({ id: '123' });
        await waitFor(() => expect(input).not.toBeDisabled());
        expect(addPlayerForRoom).toHaveBeenCalledTimes(1);
    });

    it('re-enables the input and clears it after a successful add', async () => {
        addPlayerForRoom.mockResolvedValue({ id: 'bob' });

        renderPlayerAddition();
        const input = screen.getByPlaceholderText('Enter Player Name');

        userEvent.type(input, 'bob');
        userEvent.click(screen.getByAltText('Enter Image'));

        await waitFor(() => expect(input).toHaveValue(''));
        expect(input).not.toBeDisabled();
    });

    it('re-enables the input after a failed add so the user can retry', async () => {
        addPlayerForRoom.mockRejectedValue(new Error('Player already exists'));

        renderPlayerAddition();
        const input = screen.getByPlaceholderText('Enter Player Name');

        userEvent.type(input, 'dupe');
        userEvent.click(screen.getByAltText('Enter Image'));

        await waitFor(() => expect(input).not.toBeDisabled());
        // Unlike the success path, a failed add leaves the typed name in
        // place rather than clearing it — nothing to retry otherwise.
        expect(input).toHaveValue('dupe');
    });
});
