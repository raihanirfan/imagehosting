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
    uploader_ip TEXT,                   -- Hashed/recorded uploader IP
    pixeldrain_id TEXT,                 -- Pixeldrain backup file ID
    buzzheavier_id TEXT                 -- Buzzheavier backup file ID
);

CREATE INDEX IF NOT EXISTS idx_images_hash ON images(hash);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
CREATE INDEX IF NOT EXISTS idx_images_pixeldrain ON images(pixeldrain_id);
CREATE INDEX IF NOT EXISTS idx_images_buzzheavier ON images(buzzheavier_id);
