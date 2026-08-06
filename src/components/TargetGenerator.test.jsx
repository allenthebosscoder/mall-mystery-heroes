/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * No test file existed for this component before now; it's exercised here
 * only because docs/improvements.md item 23 added a new addLogForRoom call
 * to onYesClose (seeding a real "Game has begun!" log at the moment the
 * game actually starts, replacing Log.js's hardcoded phantom entry).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TargetGenerator from './TargetGenerator';
import {
    addLogForRoom,
    updateAssassinsForPlayer,
    updateTargetsForPlayer,
} from './firebase_calls/dbCalls';

jest.mock('./firebase_calls/dbCalls', () => ({
    addLogForRoom: jest.fn(),
    updateAssassinsForPlayer: jest.fn(),
    updateTargetsForPlayer: jest.fn(),
}));

const handleLobbyRoom = jest.fn();

const mountTargetGenerator = (arrayOfPlayers = ['Alice', 'Bob', 'Carol']) =>
    render(
        <ChakraProvider>
            <TargetGenerator
                arrayOfPlayers={arrayOfPlayers}
                roomID="room-a"
                handleLobbyRoom={handleLobbyRoom}
            />
        </ChakraProvider>
    );

const beginGame = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Begin Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and Begin Game' }));
};

beforeEach(() => {
    jest.clearAllMocks();
    updateTargetsForPlayer.mockResolvedValue(undefined);
    updateAssassinsForPlayer.mockResolvedValue(undefined);
    addLogForRoom.mockResolvedValue(undefined);
});

describe('Begin Game confirmation', () => {
    it('shows a table of the generated targets before committing anything', async () => {
        mountTargetGenerator();

        await userEvent.click(screen.getByRole('button', { name: 'Begin Game' }));

        expect(screen.getByText('Generate Targets')).toBeInTheDocument();
        expect(updateTargetsForPlayer).not.toHaveBeenCalled();
    });
});

describe('confirming writes targets, logs the start, and hands off to the lobby (improvements item 23)', () => {
    it('writes targets and assassins for every player', async () => {
        mountTargetGenerator();

        await beginGame();

        await waitFor(() =>
            expect(updateAssassinsForPlayer).toHaveBeenCalledWith(
                'Carol',
                expect.any(Array),
                'room-a'
            )
        );
        expect(updateTargetsForPlayer).toHaveBeenCalledWith('Alice', expect.any(Array), 'room-a');
        expect(updateTargetsForPlayer).toHaveBeenCalledWith('Bob', expect.any(Array), 'room-a');
        expect(updateTargetsForPlayer).toHaveBeenCalledWith('Carol', expect.any(Array), 'room-a');
        expect(updateAssassinsForPlayer).toHaveBeenCalledWith('Alice', expect.any(Array), 'room-a');
        expect(updateAssassinsForPlayer).toHaveBeenCalledWith('Bob', expect.any(Array), 'room-a');
    });

    it('logs a real "Game has begun!" entry, not the old hardcoded placeholder', async () => {
        mountTargetGenerator();

        await beginGame();

        await waitFor(() =>
            expect(addLogForRoom).toHaveBeenCalledWith('Game has begun!', 'gray.400', 'room-a')
        );
    });

    it('hands off to the lobby callback after the writes and the log', async () => {
        mountTargetGenerator();

        await beginGame();

        await waitFor(() => expect(handleLobbyRoom).toHaveBeenCalled());
    });
});

describe('a rejected target write shows an error instead of failing silently (improvements item 10)', () => {
    it('surfaces the error via a toast', async () => {
        updateTargetsForPlayer.mockRejectedValue(new Error('network down'));
        mountTargetGenerator();

        await beginGame();

        expect(await screen.findByText('network down')).toBeInTheDocument();
    });
});
