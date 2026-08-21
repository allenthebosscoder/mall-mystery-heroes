import React, { useState } from 'react';
import {
    Alert,
    AlertIcon,
    Button,
    Flex,
    FormLabel,
    Input,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    NumberDecrementStepper,
    NumberIncrementStepper,
    NumberInput,
    NumberInputField,
    NumberInputStepper,
    Select,
    Text,
} from '@chakra-ui/react';
import CreateAlert from '../CreateAlert';
import { updatePointsForPlayer, updateTaskForRoom } from '../firebase_calls/dbCalls';
import { planScoreAdjustment } from '../../game/missionEdit';

// Self-contained: owns both the Modal chrome and the form fields, unlike
// TaskCreationModal/TaskCreation's split — editing's field set is small
// enough not to warrant a separate presentational component. Not a reuse
// of TaskCreation.js: no dupe-check, no new taskIndex, isComplete/
// completedBy are preserved untouched
// (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
//
// Errors surface only through CreateAlert's toast, matching
// TaskCreation.js/ResetTargetsButton.js's existing convention — no
// separate persistent inline error box, which would otherwise render the
// same message text twice (toast description + inline box) and break a
// single-match `findByText` lookup.
const TaskEditModal = ({ isOpen, onClose, task, roomID }) => {
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description);
    const [taskType, setTaskType] = useState(task.taskType);
    const [pointValue, setPointValue] = useState(String(task.pointValue));
    const [maxCompletions, setMaxCompletions] = useState(
        task.maxCompletions === null || task.maxCompletions === undefined
            ? ''
            : String(task.maxCompletions)
    );
    // Set only between "Save" (when planScoreAdjustment finds a non-null
    // adjustment) and the GM's explicit "Confirm" — a distinct step, not
    // an automatic silent recompute of players' scores
    // (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
    const [pendingAdjustment, setPendingAdjustment] = useState(null);
    const createAlert = CreateAlert();
    // Changing Task <-> Revival Mission after anyone has completed the
    // mission is blocked — a Task completion awards points, a Revival
    // Mission completion revives a player, and retroactively undoing
    // either is out of scope (see the design doc's Decisions section).
    const hasCompletions = task.completedBy.length > 0;

    const buildUpdates = () => ({
        title,
        description,
        taskType,
        pointValue: Number(pointValue),
        maxCompletions: maxCompletions === '' ? null : Number(maxCompletions),
    });

    // Sequential, not Promise.all — matches ResetTargetsButton.js's
    // UpdateDatabase, this repo's established convention for a
    // multi-player write loop.
    const applyUpdate = async (updates, adjustment) => {
        try {
            await updateTaskForRoom(task.taskIndex, updates, roomID);
            if (adjustment) {
                for (const player of adjustment.players) {
                    await updatePointsForPlayer(player, adjustment.delta, roomID);
                }
            }
            createAlert('success', 'Task Updated', 'Your mission has been updated', 1500);
            setPendingAdjustment(null);
            onClose();
        } catch (submitError) {
            // updateTaskForRoom/updatePointsForPlayer both throw on
            // failure rather than swallowing (docs/improvements.md item
            // 10). A failure partway through the score-adjustment loop is
            // a real, accepted risk here, not a transaction — surfaced as
            // an error, not silently retried (see the design doc's Error
            // handling section). pendingAdjustment is intentionally left
            // set on failure so a GM retrying via "Confirm" doesn't have
            // to re-trigger the notice.
            console.error('Error saving mission edit:', submitError);
            createAlert('error', 'Error saving mission', submitError.message, 1500);
        }
    };

    const handleSave = () => {
        const updates = buildUpdates();
        const adjustment = planScoreAdjustment(task, updates);
        if (adjustment) {
            setPendingAdjustment({ updates, adjustment });
            return;
        }
        applyUpdate(updates, null);
    };

    const handleConfirmAdjustment = () => {
        applyUpdate(pendingAdjustment.updates, pendingAdjustment.adjustment);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Edit Mission</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <Flex direction="column" gap={2}>
                        <Input
                            placeholder="Task Title"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                        <Input
                            placeholder="Description"
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                        <Select
                            value={taskType}
                            onChange={(event) => setTaskType(event.target.value)}
                            isDisabled={hasCompletions}
                        >
                            <option value="Task">Task</option>
                            <option value="Revival Mission">Revival Mission</option>
                        </Select>
                        <FormLabel htmlFor="edit-point-value" color="#ffffff" mb={0}>
                            Point Value
                        </FormLabel>
                        <NumberInput
                            id="edit-point-value"
                            value={pointValue}
                            onChange={setPointValue}
                        >
                            <NumberInputField />
                            <NumberInputStepper>
                                <NumberIncrementStepper color="white" />
                                <NumberDecrementStepper color="white" />
                            </NumberInputStepper>
                        </NumberInput>
                        <NumberInput value={maxCompletions} onChange={setMaxCompletions} min={0}>
                            <NumberInputField placeholder="Max completions" />
                            <NumberInputStepper>
                                <NumberIncrementStepper color="white" />
                                <NumberDecrementStepper color="white" />
                            </NumberInputStepper>
                        </NumberInput>
                        {pendingAdjustment && (
                            <Alert status="warning">
                                <AlertIcon />
                                <Text>
                                    This will adjust {pendingAdjustment.adjustment.players.length}{' '}
                                    player
                                    {pendingAdjustment.adjustment.players.length === 1 ? '' : 's'}
                                    &apos; scores by{' '}
                                    {pendingAdjustment.adjustment.delta > 0 ? '+' : ''}
                                    {pendingAdjustment.adjustment.delta} each.
                                </Text>
                            </Alert>
                        )}
                    </Flex>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose} mr={2}>
                        Close
                    </Button>
                    {pendingAdjustment ? (
                        <Button colorScheme="green" onClick={handleConfirmAdjustment}>
                            Confirm
                        </Button>
                    ) : (
                        <Button colorScheme="blue" onClick={handleSave}>
                            Save
                        </Button>
                    )}
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskEditModal;
