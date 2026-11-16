import { useCallback } from 'react';
import { useToast } from '@chakra-ui/react';
const CreateAlert = () => {
    const toast = useToast();

    // useToast()'s own `toast` function is already stable across renders —
    // wrapping showToast in useCallback (keyed on it) makes CreateAlert()'s
    // return value stable too, instead of a brand new function identity on
    // every call. Every component that calls CreateAlert() once per render
    // and hands the result into a dependency array or a memoized context
    // value relies on this; without it, that memoization is defeated by
    // createAlert changing every render regardless of anything else.
    const showToast = useCallback(
        (status, title, description, duration) => {
            toast({
                title: title,
                description: description,
                status: status,
                duration: duration,
                isClosable: true,
            });
        },
        [toast]
    );
    return showToast;
};

export default CreateAlert;
