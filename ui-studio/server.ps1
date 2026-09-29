param(
    [string]$Project = "",
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$Server = Join-Path $PSScriptRoot "server.py"

$ArgsList = @($Server, "--port", $Port)
if (-not [string]::IsNullOrWhiteSpace($Project)) {
    $ArgsList += @("--project", $Project)
}

python @ArgsList
