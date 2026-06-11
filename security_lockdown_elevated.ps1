$ErrorActionPreference = 'Stop'

function Backup-File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$BackupDir
    )

    $leaf = Split-Path -Leaf $Path
    $backupPath = Join-Path $BackupDir ($leaf + '.pre-lockdown.bak')
    if (-not (Test-Path -LiteralPath $backupPath)) {
        Copy-Item -LiteralPath $Path -Destination $backupPath -Force
    }
    return $backupPath
}

function Set-FileContentSafe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$resultPath = Join-Path $PSScriptRoot 'security_lockdown_result.json'
$backupDir = Join-Path $PSScriptRoot 'security-backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$apacheConf = 'C:\Program Files\edb\pem\httpd\apache\conf\httpd.conf'
$postgresConf = 'C:\Program Files\PostgreSQL\16\data\postgresql.conf'
$remoteAssistanceKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Remote Assistance'
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1 -ExpandProperty IPAddress
$remoteAssistanceOriginal = $null
$apacheOriginal = $null
$postgresOriginal = $null

$result = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    remoteAssistance = [ordered]@{}
    apache = [ordered]@{}
    postgres = [ordered]@{}
    verification = [ordered]@{}
}

try {
    $apacheBackup = Backup-File -Path $apacheConf -BackupDir $backupDir
    $postgresBackup = Backup-File -Path $postgresConf -BackupDir $backupDir

    $apacheOriginal = Get-Content -LiteralPath $apacheConf -Raw
    $postgresOriginal = Get-Content -LiteralPath $postgresConf -Raw
    $remoteAssistanceOriginal = Get-ItemProperty -Path $remoteAssistanceKey

    $updatedApache = [regex]::Replace(
        $apacheOriginal,
        '(?m)^\s*Listen\s+.+:8080\s*$',
        'Listen 127.0.0.1:8080',
        1
    )
    if ($updatedApache -eq $apacheOriginal -and $updatedApache -notmatch '(?m)^\s*Listen\s+127\.0\.0\.1:8080\s*$') {
        throw 'Could not find the Apache Listen directive for port 8080.'
    }
    if ($updatedApache -ne $apacheOriginal) {
        Set-FileContentSafe -Path $apacheConf -Content $updatedApache
        $result.apache.configChanged = $true
    } else {
        $result.apache.configChanged = $false
    }
    $result.apache.backup = $apacheBackup

    $updatedPostgres = [regex]::Replace(
        $postgresOriginal,
        "(?m)^listen_addresses\s*=\s*.*$",
        "listen_addresses = 'localhost'        # what IP address(es) to listen on;",
        1
    )
    if ($updatedPostgres -eq $postgresOriginal -and $updatedPostgres -notmatch "(?m)^listen_addresses\s*=\s*'localhost'") {
        throw 'Could not find the PostgreSQL listen_addresses directive.'
    }
    if ($updatedPostgres -ne $postgresOriginal) {
        Set-FileContentSafe -Path $postgresConf -Content $updatedPostgres
        $result.postgres.configChanged = $true
    } else {
        $result.postgres.configChanged = $false
    }
    $result.postgres.backup = $postgresBackup

    Set-ItemProperty -Path $remoteAssistanceKey -Name fAllowToGetHelp -Value 0
    Set-ItemProperty -Path $remoteAssistanceKey -Name fAllowFullControl -Value 0
    Set-ItemProperty -Path $remoteAssistanceKey -Name fEnableChatControl -Value 0
    $result.remoteAssistance.disabled = $true

    Restart-Service -Name PEMHTTPD-x64 -Force
    Restart-Service -Name postgresql-x64-16 -Force
    Start-Sleep -Seconds 3

    $result.apache.serviceStatus = (Get-Service -Name PEMHTTPD-x64).Status.ToString()
    $result.postgres.serviceStatus = (Get-Service -Name postgresql-x64-16).Status.ToString()
    $result.remoteAssistance.fAllowToGetHelp = (Get-ItemProperty -Path $remoteAssistanceKey -Name fAllowToGetHelp).fAllowToGetHelp

    $result.verification.apacheLocalListen = @(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort)
    $result.verification.postgresLocalListen = @(Get-NetTCPConnection -State Listen -LocalPort 5432 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort)
    $result.verification.lanIp = $lanIp
    if ($lanIp) {
        $result.verification.apacheLan8080 = [bool](Test-NetConnection -ComputerName $lanIp -Port 8080 -WarningAction SilentlyContinue).TcpTestSucceeded
        $result.verification.postgresLan5432 = [bool](Test-NetConnection -ComputerName $lanIp -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded
    }
    $result.verification.apacheLoopback8080 = [bool](Test-NetConnection -ComputerName 127.0.0.1 -Port 8080 -WarningAction SilentlyContinue).TcpTestSucceeded
    $result.verification.postgresLoopback5432 = [bool](Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded

    ($result | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $resultPath
    exit 0
}
catch {
    $result.error = $_.Exception.Message

    try {
        if ($apacheOriginal) {
            Set-FileContentSafe -Path $apacheConf -Content $apacheOriginal
        }
    }
    catch {
        $result.apacheRollbackError = $_.Exception.Message
    }

    try {
        if ($postgresOriginal) {
            Set-FileContentSafe -Path $postgresConf -Content $postgresOriginal
        }
    }
    catch {
        $result.postgresRollbackError = $_.Exception.Message
    }

    try {
        if ($remoteAssistanceOriginal) {
            Set-ItemProperty -Path $remoteAssistanceKey -Name fAllowToGetHelp -Value $remoteAssistanceOriginal.fAllowToGetHelp
            Set-ItemProperty -Path $remoteAssistanceKey -Name fAllowFullControl -Value $remoteAssistanceOriginal.fAllowFullControl
            Set-ItemProperty -Path $remoteAssistanceKey -Name fEnableChatControl -Value $remoteAssistanceOriginal.fEnableChatControl
        }
    }
    catch {
        $result.remoteAssistanceRollbackError = $_.Exception.Message
    }

    try {
        Restart-Service -Name PEMHTTPD-x64 -Force -ErrorAction SilentlyContinue
    }
    catch {
        $result.apacheServiceRecoveryError = $_.Exception.Message
    }

    try {
        Restart-Service -Name postgresql-x64-16 -Force -ErrorAction SilentlyContinue
    }
    catch {
        $result.postgresServiceRecoveryError = $_.Exception.Message
    }

    ($result | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $resultPath
    exit 1
}
