# Changelog: Enhance Bottom UI Compactness and Colors

## Changes
- Updated CSS variables `var(--color-bg-base)`, `var(--color-bg-surface)` and `var(--color-bg-elevated)` globally to reflect a darker gray theme similar to the target design (#292828 / #302f2f / #3d3d3d).
- Gave `.input-box-inner-row` a distinct semi-transparent light background (`rgba(255, 255, 255, 0.08)`) with `border-radius: var(--radius-lg)` to match the lyrics highlight block, and significantly reduced its bottom margin layout to appear denser.
- Added textual labels 'Chat' and 'Notes' under `.bottom-nav-item` icons, switching layout to `flex-direction: column` to match the native route tab feel perfectly.
