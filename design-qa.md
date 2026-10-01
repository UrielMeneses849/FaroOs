# Needs — visual QA

- Source visual truth: user-selected “Despensa y reposición” Image Gen result from this conversation.
- Implementation screenshot: unavailable.
- Intended viewport: 390 × 844 CSS px, mobile dark mode.
- State to compare: populated shopping list with grouped pending items and visible replenishment routines.
- Source / implementation pixel normalization: blocked because no browser-control surface is available in this session to capture the implementation.

## Findings

- [P1] Visual comparison blocked
  - Location: Needs mobile route.
  - Evidence: the selected design source is available, but the in-app browser runtime is not exposed in this session, so no implementation screenshot can be captured or placed beside it.
  - Impact: typography, spacing, responsive overflow and native mobile affordances cannot be truthfully signed off visually.
  - Fix: open FARO on a 390 px mobile viewport, capture the populated Needs view, then compare it side-by-side with the selected source and resolve any P1/P2 differences.

## Open questions

- None for product behavior. The new model treats “Comprar” and “Rutina” as two states of one record, preventing duplicate items or finance charges.

## Implementation checklist

- [x] Add an optional, no-date shopping-list state to a need.
- [x] Group current purchases by where they are bought.
- [x] Allow a completed purchase to return to its optional replenishment routine.
- [x] Keep the financial transaction separate from this list.
- [ ] Perform visual comparison in a browser-capable session.

## Follow-up polish

- Test the row check interaction and long labels on a real phone.

final result: blocked
