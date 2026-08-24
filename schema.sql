CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,               -- e.g. "a9xZ2k" (alphanumeric short ID)
    hash TEXT NOT NULL UNIQUE,          -- SHA-256 hash for deduplication
    original_name TEXT,                 -- Original file name
    mime_type TEXT NOT NULL,            -- e.g. "image/webp", "image/png"
    size_bytes INTEGER NOT NULL,        -- File size in bytes
    delete_token TEXT NOT NULL,         -- UUID or secure token for deletion
    views INTEGER DEFAULT 0,            -- Access counter
    created_at INTEGER NOT NULL,        -- Unix timestamp (milliseconds)
    drive_file_id TEXT,                 -- Google Drive file ID
    uploader_ip TEXT,                   -- Hashed uploader IP
    uploader_ip_enc TEXT,               -- Encrypted IP
    pixeldrain_id TEXT,                 -- Pixeldrain file ID
    buzzheavier_id TEXT,                -- Buzzheavier file ID
    expires_at INTEGER,                 -- nullable unix ms; null = permanent
    locked_at INTEGER,                  -- DMCA lock timestamp ms; null = not locked (ponytail: retains R2, blocks serve until unlock)
    locked_reason TEXT                  -- optional reason for lock
);

CREATE INDEX IF NOT EXISTS idx_images_hash ON images(hash);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
CREATE INDEX IF NOT EXISTS idx_images_pixeldrain ON images(pixeldrain_id);
CREATE INDEX IF NOT EXISTS idx_images_buzzheavier ON images(buzzheavier_id);
CREATE INDEX IF NOT EXISTS idx_images_expires_at ON images(expires_at);
