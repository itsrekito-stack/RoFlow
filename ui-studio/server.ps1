param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
$Address = [System.Net.IPAddress]::Parse("127.0.0.1")
$Listener = [System.Net.Sockets.TcpListener]::new($Address, $Port)

function Get-MimeType([string]$Path) {
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8"; break }
        ".css"  { "text/css; charset=utf-8"; break }
        ".js"   { "application/javascript; charset=utf-8"; break }
        ".json" { "application/json; charset=utf-8"; break }
        ".png"  { "image/png"; break }
        ".jpg"  { "image/jpeg"; break }
        ".jpeg" { "image/jpeg"; break }
        ".webp" { "image/webp"; break }
        ".svg"  { "image/svg+xml; charset=utf-8"; break }
        ".ico"  { "image/x-icon"; break }
        ".txt"  { "text/plain; charset=utf-8"; break }
        default { "application/octet-stream" }
    }
}

function Write-Response(
    [System.IO.Stream]$Stream,
    [int]$Status,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType,
    [bool]$HeadOnly = $false
) {
    if ($null -eq $Body) { $Body = [byte[]]::new(0) }
    $Header = @(
        "HTTP/1.1 $Status $StatusText"
        "Content-Type: $ContentType"
        "Content-Length: $($Body.Length)"
        "Cache-Control: no-store, no-cache, must-revalidate"
        "Pragma: no-cache"
        "Connection: close"
        ""
        ""
    ) -join "`r`n"

    $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Header)
    $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)

    if (-not $HeadOnly -and $Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
    $Stream.Flush()
}

try {
    $Listener.Start()
    Write-Host ""
    Write-Host "Bloom UI Studio server"
    Write-Host "Root: $Root"
    Write-Host "URL : http://127.0.0.1:$Port/tools/bloom-ui-editor/"
    Write-Host "Close this window to stop the server."
    Write-Host ""

    while ($true) {
        $Client = $Listener.AcceptTcpClient()
        try {
            $Stream = $Client.GetStream()
            $Reader = [System.IO.StreamReader]::new(
                $Stream,
                [System.Text.Encoding]::ASCII,
                $false,
                4096,
                $true
            )

            $RequestLine = $Reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($RequestLine)) {
                continue
            }

            do {
                $Line = $Reader.ReadLine()
            } while ($null -ne $Line -and $Line -ne "")

            $Parts = $RequestLine.Split(" ")
            if ($Parts.Length -lt 2) {
                Write-Response $Stream 400 "Bad Request" ([Text.Encoding]::UTF8.GetBytes("Bad request")) "text/plain; charset=utf-8"
                continue
            }

            $Method = $Parts[0].ToUpperInvariant()
            $HeadOnly = $Method -eq "HEAD"

            if ($Method -ne "GET" -and -not $HeadOnly) {
                Write-Response $Stream 405 "Method Not Allowed" ([Text.Encoding]::UTF8.GetBytes("Method not allowed")) "text/plain; charset=utf-8"
                continue
            }

            $UrlPath = $Parts[1].Split("?")[0]
            $Relative = [System.Uri]::UnescapeDataString($UrlPath).TrimStart("/")

            if ([string]::IsNullOrWhiteSpace($Relative)) {
                $Relative = "tools/bloom-ui-editor/index.html"
            }

            $Relative = $Relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
            $Candidate = Join-Path $Root $Relative

            if (Test-Path $Candidate -PathType Container) {
                $Candidate = Join-Path $Candidate "index.html"
            }

            $FullPath = [System.IO.Path]::GetFullPath($Candidate)
            $AllowedPrefix = $Root + [System.IO.Path]::DirectorySeparatorChar

            if (-not $FullPath.StartsWith($AllowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                Write-Response $Stream 403 "Forbidden" ([Text.Encoding]::UTF8.GetBytes("Forbidden")) "text/plain; charset=utf-8" $HeadOnly
                continue
            }

            if (-not (Test-Path $FullPath -PathType Leaf)) {
                Write-Response $Stream 404 "Not Found" ([Text.Encoding]::UTF8.GetBytes("Not found")) "text/plain; charset=utf-8" $HeadOnly
                continue
            }

            $Bytes = [System.IO.File]::ReadAllBytes($FullPath)
            Write-Response $Stream 200 "OK" $Bytes (Get-MimeType $FullPath) $HeadOnly
        }
        catch {
            try {
                $Message = [System.Text.Encoding]::UTF8.GetBytes("Server error")
                Write-Response $Stream 500 "Internal Server Error" $Message "text/plain; charset=utf-8"
            } catch {}
        }
        finally {
            if ($null -ne $Client) { $Client.Close() }
        }
    }
}
finally {
    $Listener.Stop()
}
