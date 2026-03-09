# Collapsible Cards Reference

**Date**: 2026-03-09
**Feature**: Checkpoint, ErrorMessage & Knowledge Artifacts UI

## Overview
Replaced the static and blunt rendering of three `Step` types with an elegant, `.thinking-block`-based collapsible card system. This reduces cognitive load on the user and converts technical blockers into actionable interventions (`Brocade`/锦囊) by hiding heavy details away while exposing clear actions.

## Modifications
1. **ErrorMessageStep**: Refactored to fold `503` / `Service Unavailable` logs into a warning-colored (`amber-500`) collapsible block. Provides `[降级至轻量模型]` and `[立即重试]` mockup actions.
2. **CheckpointStep**: Refactored to fold into an indigo-colored collapsible block, clarifying that it's a structural pending state awaiting `[注入锦囊]`.
3. **KnowledgeArtifactsStep**: Separated from `SystemStep` and given its own component, rendering as an emerald-colored collapsible block for new knowledge generation, with a `[✅ 一键归档]` mockup action.
4. **StepRenderer & SystemStep**: Shifted `CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS` to use the new exact component.
5. **Steps.css**: Added `.variant-error`, `.variant-checkpoint`, `.variant-knowledge` block overrides seamlessly.

## Testing
- ✅ Linter passed completely.
- ✅ TypeScript / Vite build passed completely.
