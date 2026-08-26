import React from 'react';
import {
    Alert,
    AlertIcon,
    Box,
    Button,
    Flex,
    Image,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Spinner,
    Text,
} from '@chakra-ui/react';

// A player submits a kill-photo claim. Presentational only —
// MessageComposer.js owns capturing, compressing, and uploading/writing
// the photo (its camera button triggers a hidden file input directly,
// always mounted so it can be triggered before this modal has ever
// opened); this modal just renders whatever MessageComposer hands it and
// reports back that the player is ready to submit
// (docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
//
// No target picker: the player no longer names who they killed — a
// moderator resolves that later, when reviewing the photo in
// PhotosDisplay.js.
const KillPhotoModal = ({ isOpen, onClose, previewUrl, error, onSubmit }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Submit a Kill Photo</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    {previewUrl && (
                        <Box mb={4}>
                            <Image src={previewUrl} alt="Kill photo preview" maxH="200px" />
                        </Box>
                    )}
                    {error && (
                        <Alert status="error" mb={4}>
                            <AlertIcon />
                            {error}
                        </Alert>
                    )}
                    {!previewUrl && !error && (
                        <Flex align="center" mb={4}>
                            <Spinner size="sm" mr={2} />
                            <Text>Processing photo…</Text>
                        </Flex>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose} mr={2}>
                        Close
                    </Button>
                    <Button colorScheme="teal" onClick={() => onSubmit()} isDisabled={!previewUrl}>
                        Submit
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default KillPhotoModal;
