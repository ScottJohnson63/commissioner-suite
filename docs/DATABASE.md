# Database Update Instructions

## When to use this

Any time you add, remove, or modify a model in `nextjs/prisma/schema.prisma`, you need to manually push the changes to Turso. Prisma migrations do **not** automatically apply to Turso in this setup.

---

## Steps

### 1. Update `prisma/schema.prisma`
Make your model changes as normal.

### 2. Generate the diff SQL
Run this from the `nextjs/` directory:

```bash
npx dotenv -e .env.local -- npx prisma migrate diff \
  --from-url "$TURSO_DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > schema.sql
```

This compares your live Turso database against your updated schema and outputs only the missing changes.

### 3. Add `IF NOT EXISTS` manually
Open the generated `schema.sql` and update any `CREATE TABLE` statements:

```sql
-- Change this:
CREATE TABLE "YourTable" (

-- To this:
CREATE TABLE IF NOT EXISTS "YourTable" (
```

> **Why:** Prisma's diff tool does not generate `IF NOT EXISTS` clauses. Without it, pushing to a database that already has the table will throw an error.

### 4. Push to Turso

```bash
turso db shell commissioner-suite < schema.sql
```

### 5. Verify

```bash
turso db shell commissioner-suite ".tables"
```

---

## Notes

- `schema.sql` is gitignored — never commit it as it may contain connection details
- Always run the diff against the **live** Turso URL, not `--from-empty`, to avoid recreating existing tables
- If you're adding a column to an existing table, the diff will generate `ALTER TABLE` statements which don't need `IF NOT EXISTS`
- After pushing, regenerate the Prisma client: `npx prisma generate`