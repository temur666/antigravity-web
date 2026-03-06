# Changelog: Bottom UI Spacing and Auto-Focus Fixes

## Changes
- Removed the `radial-gradient` that mimicked a vinyl player glow from `.main-area` base styling. With this removed, the `.input-box` and `.bottom-nav` integrate completely flawlessly with their background, fixing the "left-to-right gradient" visual split.
- Ensured `.input-box-inner-row` retains exactly 12px margins aligned with both the left and right sides of the screen by utilizing `width: calc(100% - 24px)`.
- Replaced the hardcoded `.input-box-inner-row` bottom margin with a tighter layout, drawing the input box significantly closer to the bottom nav.
- Fixed a bug in `InputBox.tsx` where switching route tabs would cause an annoying keyboard popup because the component was applying `.focus()` to the `inputRef` upon mounting in a snapped position. Removed the aggressive auto-focus effect completely.
