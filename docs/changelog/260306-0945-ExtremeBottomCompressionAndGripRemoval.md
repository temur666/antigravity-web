# Changelog: Extreme Bottom Compression and Grip Removal

## Changes
- Identified the source of the lingering vertical space above the input box: the `.input-box-grip` component. Since the user prefers a clean gapless UI with no extra lines, the grip bar is now set to `display: none;`, instantly liberating ~12px of internal height overhead.
- Further jammed the `.input-box` container down into the routing area by assigning `bottom: -14px;` (from the previous `-4px`).
- The 12px logical left/right margin gap remains 100% accurate, taking zero structural damage.
- Result: the input text area wrapper (`.input-box-inner-row`) now practically hugs the `.bottom-nav` tightly, delivering precisely the target Spotify/网易云 lyric-like pill proximity as requested by the user's uploaded snapshot.
