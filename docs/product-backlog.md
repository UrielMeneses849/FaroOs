# Product backlog

## Budget-linked Shopping Lists / Consumption Lists

Post-hot-fix evolution. This is intentionally not implemented in the Desktop
30 Aug 2026 hot fix.

- `ShoppingList`: name, optional `budget_id`, optional period, items.
- `ShoppingItem`: name, quantity, estimated price, actual price, status.

It is distinct from financial goals. No tables, migrations, or UI are included
until this evolution is separately scoped.
