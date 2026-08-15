import React, { useState } from 'react';
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
    Radio,
    RadioGroup,
    Spinner,
    Stack,
    Text,
} from '@chakra-ui/react';

// A player submits a kill-photo claim against one of their assigned
// targets. Presentational only — MessageComposer.js owns capturing,
// compressing, and uploading/writing the photo (its camera button
// triggers a hidden file input directly, always mounted so it can be
// triggered before this modal has ever opened); this modal just renders
// whatever MessageComposer hands it and reports back which target the
// user picked
// (docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
const KillPhotoModal = ({
    isOpen,
    onClose,
    targets = [],
    previewUrl,
    error,
    isSubmitting,
    onSubmit,
}) => {
    const [selectedTarget, setSelectedTarget] = useState(targets[0] ?? '');
    // Derived, not state: `targets` can arrive asynchronously after mount
    // (PlayerGame.js renders MessageComposer before playerData has loaded),
    // and useState's initializer only runs once. Recomputing this on every
    // render means it self-corrects whenever `targets` changes, instead of
    // being stuck on whatever was true at mount time.
    const effectiveTarget = targets.includes(selectedTarget) ? selectedTarget : (targets[0] ?? '');

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Submit a Kill Photo</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    {targets.length > 1 && (
                        <RadioGroup value={effectiveTarget} onChange={setSelectedTarget} mb={4}>
                            <Stack>
                                {targets.map((target) => (
                                    <Radio key={target} value={target}>
                                        {target}
                                    </Radio>
                                ))}
                            </Stack>
                        </RadioGroup>
                    )}
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
                    <Button
                        colorScheme="teal"
                        onClick={() => onSubmit(effectiveTarget)}
                        isDisabled={!previewUrl || isSubmitting || !effectiveTarget}
                        isLoading={isSubmitting}
                    >
                        Submit
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default KillPhotoModal;
