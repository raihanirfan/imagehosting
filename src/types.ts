export interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    UPLOAD_SECRET?: string;
    TURNSTILE_SECRET_KEY?: string;
    ENVIRONMENT?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REFRESH_TOKEN?: string;
    GOOGLE_FOLDER_ID?: string;
    PIXELDRAIN_API_KEY?: string;
    BUZZHEAVIER_API_KEY?: string;
    BLOCKED_IPS?: string;
    ALLOWED_IPS?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
}

export interface ImageRecord {
    id: string;
    hash: string;
    original_name: string | null;
    mime_type: string;
    size_bytes: number;
    delete_token: string;
    views: number;
    created_at: number;
    drive_file_id?: string | null;
    pixeldrain_id?: string | null;
    buzzheavier_id?: string | null;
    uploader_ip?: string | null;
    uploader_ip_enc?: string | null;
    expires_at?: number | null;
    locked_at?: number | null;
    locked_reason?: string | null;
}
