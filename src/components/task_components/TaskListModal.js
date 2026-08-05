import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
} from '@chakra-ui/react';
import React from 'react';
import TaskList from './TaskList';

const TaskListModal = ({ isOpen, onClose }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} size="xl">
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Missions</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <TaskList />
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskListModal;
