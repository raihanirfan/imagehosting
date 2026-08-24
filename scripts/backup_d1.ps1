# ==============================================================================
# Cloudflare D1 Automated Database Backup Script (PowerShell)
# ==============================================================================

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $ProjectDir "backups"

# Ensure backup directory exists
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$OutputFile = Join-Path $BackupDir "d1_backup_$Timestamp.sql"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "🚀 Starting Cloudflare D1 Remote Backup..." -ForegroundColor Cyan
Write-Host "📅 Timestamp: $Timestamp" -ForegroundColor Gray
Write-Host "📁 Target: $OutputFile" -ForegroundColor Gray
Write-Host "=================================================" -ForegroundColor Cyan

try {
    # Execute D1 Export
    Push-Location $ProjectDir
    npx wrangler d1 export image_db --remote --output $OutputFile

    if (Test-Path $OutputFile) {
        $FileSize = (Get-Item $OutputFile).Length
        $FileSizeKB = [math]::Round($FileSize / 1024, 2)
        
        Write-Host ""
        Write-Host "✅ Backup SUCCESSFUL!" -ForegroundColor Green
        Write-Host "📦 File: $OutputFile" -ForegroundColor Green
        Write-Host "📊 Size: $FileSizeKB KB ($FileSize bytes)" -ForegroundColor Green
        
        # Retention: Keep only the latest 15 backups to save disk space
        $AllBackups = Get-ChildItem -Path $BackupDir -Filter "d1_backup_*.sql" | Sort-Object CreationTime -Descending
        if ($AllBackups.Count -gt 15) {
            $AllBackups | Select-Object -Skip 15 | ForEach-Object {
                Write-Host "🧹 Pruning old backup: $($_.Name)" -ForegroundColor Yellow
                Remove-Item $_.FullName -Force
            }
        }
    } else {
        throw "Backup file was not created."
    }
}
catch {
    Write-Host ""
    Write-Host "❌ Backup FAILED: $_" -ForegroundColor Red
}
finally {
    Pop-Location
}
