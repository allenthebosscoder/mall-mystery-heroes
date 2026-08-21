/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskEditModal edits an existing mission and, when its pointValue
 * changes on a Task with existing completions, retroactively adjusts
 * those players' scores by the delta
 * (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
 * Explicit dbCalls mock factory, not auto-mock — see ChatInput.test.jsx
 * for why.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskEditModal from './TaskEditModal';
import { updateTaskForRoom, updatePointsForPlayer } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    updateTaskForRoom: jest.fn(),
    updatePointsForPlayer: jest.fn(),
}));

const onClose = jest.fn();

const baseTask = {
    taskIndex: 1,
    title: 'Find the clue',
    description: 'Look around',
    taskType: 'Task',
    pointValue: 10,
    maxCompletions: null,
    completedBy: [],
};

const mountModal = (task = baseTask) =>
    render(
        <ChakraProvider>
            <TaskEditModal isOpen onClose={onClose} task={task} roomID="room-a" />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    updateTaskForRoom.mockResolvedValue(undefined);
    updatePointsForPlayer.mockResolvedValue(undefined);
});

describe('TaskEditModal', () => {
    it('submits updateTaskForRoom with the edited field values', async () => {
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('Find the clue'));
        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Find the second clue');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ title: 'Find the second clue' }),
            'room-a'
        );
        expect(onClose).toHaveBeenCalled();
    });

    it('does not show a score-adjustment notice when pointValue is unchanged', async () => {
        mountModal({ ...baseTask, completedBy: ['alice', 'bob'] });

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.queryByText(/adjust/i)).not.toBeInTheDocument();
        expect(updatePointsForPlayer).not.toHaveBeenCalled();
    });

    it('shows a score-adjustment notice and applies it to every completing player when pointValue changes', async () => {
        mountModal({ ...baseTask, pointValue: 10, completedBy: ['alice', 'bob'] });

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '15');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(
            await screen.findByText(/adjust 2 players. scores by \+5 each/i)
        ).toBeInTheDocument();
        // The write must not have happened yet — the notice is a distinct
        // confirmation step, not an automatic silent recompute.
        expect(updateTaskForRoom).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ pointValue: 15 }),
            'room-a'
        );
        expect(updatePointsForPlayer).toHaveBeenCalledWith('alice', 5, 'room-a');
        expect(updatePointsForPlayer).toHaveBeenCalledWith('bob', 5, 'room-a');
        expect(onClose).toHaveBeenCalled();
    });

    it('disables the task type select once anyone has completed the mission', () => {
        mountModal({ ...baseTask, completedBy: ['alice'] });

        expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('does not disable the task type select when nobody has completed the mission yet', () => {
        mountModal({ ...baseTask, completedBy: [] });

        expect(screen.getByRole('combobox')).toBeEnabled();
    });

    it('shows an error and keeps the modal open when updateTaskForRoom rejects', async () => {
        updateTaskForRoom.mockRejectedValue(new Error('network down'));
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/network down/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows an error and keeps the modal open when a mid-loop updatePointsForPlayer rejects', async () => {
        updatePointsForPlayer.mockRejectedValueOnce(new Error('player not found'));
        mountModal({ ...baseTask, pointValue: 10, completedBy: ['alice', 'bob'] });

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '15');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText(/adjust 2 players. scores by \+5 each/i);
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByText(/player not found/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});
