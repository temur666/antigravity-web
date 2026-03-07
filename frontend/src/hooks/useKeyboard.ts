import { useState, useEffect } from 'react';

const KEYBOARD_THRESHOLD = 150;

export function useKeyboard(): boolean {
    const [keyboardVisible, setKeyboardVisible] = useState(false);

    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        let fullHeight = window.innerHeight;

        const handleResize = () => {
            const currentHeight = vv.height;
            const diff = fullHeight - currentHeight;
            setKeyboardVisible(diff > KEYBOARD_THRESHOLD);
        };

        const handleWindowResize = () => {
            if (vv.height >= window.innerHeight - 50) {
                fullHeight = window.innerHeight;
            }
        };

        vv.addEventListener('resize', handleResize);
        window.addEventListener('resize', handleWindowResize);

        return () => {
            vv.removeEventListener('resize', handleResize);
            window.removeEventListener('resize', handleWindowResize);
        };
    }, []);

    return keyboardVisible;
}
