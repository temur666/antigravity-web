# Changelog: True Pill Input UI and Route Switching

## Changes
- Addressed the false "left-to-right gradient" visual issue by completely removing the opaque background from the `.input-box` wrapper.
- Transformed `.input-box-inner-row` into a true floating pill component utilizing `width: 100%` inside a `padding: 0 12px` parent container, bringing true 12px spacing from both horizontal screen edges.
- Adjusted margin mappings so the input box rests closely against the bottom navigation.
- Added a `.chat-panel-fade` background mask (`linear-gradient(var(--color-bg-base), transparent)`) behind the new floating pill to fade out chat messages smoothly before they reach the bottom of the screen.
- Emphasized that the keyboard auto-popup (`inputRef.current?.focus()`) issue upon route change (Notes -> Chat) was successfully eliminated strictly in the prior commit `style: fix bottom-nav gaps, cancel keyboard auto-focus, flat bg theme` by the complete removal of the `isSnapped` / `focus()` listener hook in `InputBox.tsx`.
