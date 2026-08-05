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
import TaskCreation from './TaskCreation';
import { taskContext } from '../Contexts';

const TaskCreationModal = ({ isOpen, onClose, handleNewTaskAdded }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Create a Mission</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <taskContext.Provider value={{ handleNewTaskAdded }}>
                        <TaskCreation />
                    </taskContext.Provider>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskCreationModal;
