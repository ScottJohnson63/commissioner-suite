-- CreateTable
CREATE TABLE "ErrorLog" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "message"   TEXT     NOT NULL,
    "stack"     TEXT,
    "username"  TEXT,
    "url"       TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");
