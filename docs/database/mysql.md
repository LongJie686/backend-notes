# MySQL

## Index

### B+ Tree

- InnoDB default index structure
- All data in leaf nodes, connected by doubly linked list
- Non-leaf nodes store only keys for routing

### Index Types

- Primary Key Index (clustered index)
- Secondary Index (non-clustered)
- Joint Index (leftmost prefix rule)
- Covering Index (index contains all queried columns)

### EXPLAIN

Key fields to check:

| Field | Meaning |
|-------|---------|
| type | Access type (ALL < index < range < ref < eq_ref < const) |
| key | Actually used index |
| rows | Estimated rows scanned |
| Extra | Using index = covering index |

## Transaction

### ACID

- **A**tomicity: undo log
- **C**onsistency: application level guarantee
- **I**solation: MVCC + lock
- **D**urability: redo log

### Isolation Levels

| Level | Dirty Read | Non-repeatable Read | Phantom Read |
|-------|-----------|-------------------|-------------|
| READ UNCOMMITTED | Yes | Yes | Yes |
| READ COMMITTED | No | Yes | Yes |
| REPEATABLE READ | No | No | Partially* |
| SERIALIZABLE | No | No | No |

*InnoDB uses Next-Key Lock to prevent phantom reads under RR.

## MVCC

- Each row has hidden columns: `DB_TRX_ID`, `DB_ROLL_PTR`
- Undo log forms version chain
- Read View determines visibility
