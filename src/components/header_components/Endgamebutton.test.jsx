/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 10: `endGame` now throws on failure
 * rather than swallowing, and this button used to fire-and-forget the call
 * then navigate away unconditionally — a failure was invisible and the GM
 * would land on /dashboard believing the game had ended when it hadn't.
 *
 * Also covers a later bug report: ending the game used to navigate the GM
 * away to /dashboard on success too, which meant losing the room entirely
 * (no more chat feed, no more /whisper or /broadcast). It no longer
 * navigates anywhere — the GM stays on this room's GameMasterView.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Endgamebutton from './Endgamebutton';
import { gameContext } from '../Contexts';
import { fetchAllPlayersDataForRoom, addPlayerMessageForRoom } from '../firebase_calls/dbCalls';
import { endGame } from '../endGame';

jest.mock('../firebase_calls/dbCalls', () => ({
    fetchAllPlayersDataForRoom: jest.fn(),
    addPlayerMessageForRoom: jest.fn(),
}));
jest.mock('../endGame', () => ({
    endGame: jest.fn(),
}));

const mountEndgamebutton = () =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <Endgamebutton />
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    endGame.mockResolvedValue(undefined);
    fetchAllPlayersDataForRoom.mockResolvedValue([
        { name: 'Alice', score: 20, isAlive: true },
        { name: 'Bob', score: 30, isAlive: false },
    ]);
    addPlayerMessageForRoom.mockResolvedValue(undefined);
});

const confirmEndGame = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'End Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm End Game' }));
};

describe('Endgamebutton (improvements item 10)', () => {
    it('calls endGame and stays on this room (bug report: ending the game used to kick the GM out)', async () => {
        mountEndgamebutton();

        await confirmEndGame();

        expect(endGame).toHaveBeenCalledWith('room-a');
        // Still here once the broadcasts are sent — no navigation of any
        // kind happens on success, confirmed by the GM-still-sees-everything
        // assertion below rather than a mocked navigate call.
        await waitFor(() => expect(addPlayerMessageForRoom).toHaveBeenCalledTimes(2));
        expect(screen.getByRole('button', { name: 'End Game' })).toBeInTheDocument();
    });

    it('shows an alert and does not post broadcasts when endGame rejects', async () => {
        endGame.mockRejectedValue(new Error('network down'));
        mountEndgamebutton();

        await confirmEndGame();

        expect(await screen.findByText(/network down/i)).toBeInTheDocument();
        expect(addPlayerMessageForRoom).not.toHaveBeenCalled();
    });
});

describe('game-end broadcasts (pinned come-back message + top-3 leaderboard)', () => {
    it('posts the pinned come-back message and the leaderboard broadcast, in that order', async () => {
        mountEndgamebutton();

        await confirmEndGame();

        await waitFor(() => expect(addPlayerMessageForRoom).toHaveBeenCalledTimes(2));
        expect(addPlayerMessageForRoom).toHaveBeenNthCalledWith(
            1,
            {
                type: 'gameEnded',
                recipient: null,
                text: 'Please head back to the starting area.',
                standings: null,
            },
            'room-a'
        );
        expect(addPlayerMessageForRoom).toHaveBeenNthCalledWith(
            2,
            {
                type: 'gameEndedLeaderboard',
                recipient: null,
                text: null,
                standings: [
                    { name: 'Bob', score: 30, isAlive: false },
                    { name: 'Alice', score: 20, isAlive: true },
                ],
            },
            'room-a'
        );
    });

    it('still shows a toast rather than crashing if posting the broadcasts fails, since the game already ended', async () => {
        fetchAllPlayersDataForRoom.mockRejectedValue(new Error('network error'));
        mountEndgamebutton();

        await confirmEndGame();

        expect(
            await screen.findByText(/broadcast to players may not have gone out/i)
        ).toBeInTheDocument();
    });
});
